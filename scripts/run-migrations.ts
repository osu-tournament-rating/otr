import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { ensureGrafanaRoleLogin, GRAFANA_ROLE } from '../lib/db/grafana-role';
import {
  migrationTimeouts,
  MIGRATIONS_FOLDER,
  readJournal,
  timeoutHint,
  unrecordedMigrations,
} from '../lib/db/migrations';
import { loadRootEnv } from '../lib/env/load-root-env';

loadRootEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set; aborting migrations.');
  process.exit(1);
}

let timeouts: ReturnType<typeof migrationTimeouts>;
try {
  timeouts = migrationTimeouts(process.env);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ...timeouts });
const db = drizzle(pool);

(async () => {
  try {
    await migrate(db, { migrationsFolder: `./${MIGRATIONS_FOLDER}` });

    // The migrator skips a migration older than the newest one the database
    // has without an error, so a run that applied nothing is not proof.
    const unrecorded = await unrecordedMigrations(
      pool,
      readJournal(`./${MIGRATIONS_FOLDER}`)
    );
    if (unrecorded.length > 0) {
      console.error(
        `The database has no record of ${unrecorded.map((entry) => entry.tag).join(', ')}, ` +
          'which the migrator skips without an error once the database has a newer migration.'
      );
      process.exitCode = 1;
    } else {
      console.log('Database migrations applied successfully.');
    }

    const grafanaPassword = process.env.GRAFANA_SECRET_KEY?.trim();
    if (!grafanaPassword) {
      console.warn(
        `GRAFANA_SECRET_KEY is not set, so ${GRAFANA_ROLE} cannot log in.`
      );
    } else if (await ensureGrafanaRoleLogin(pool, grafanaPassword)) {
      console.log(`${GRAFANA_ROLE} can log in.`);
    } else {
      console.warn(`${GRAFANA_ROLE} does not exist, so it cannot log in.`);
    }
  } catch (error) {
    console.error('Failed to run database migrations.');
    const hint = timeoutHint(error, timeouts);
    if (hint) console.error(hint);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
