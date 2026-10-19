import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { ensureGrafanaRoleLogin, GRAFANA_ROLE } from '../lib/db/grafana-role';
import { loadRootEnv } from '../lib/env/load-root-env';

loadRootEnv();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set; aborting migrations.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

(async () => {
  try {
    await migrate(db, { migrationsFolder: './apps/web/drizzle' });
    console.log('Database migrations applied successfully.');

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
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
