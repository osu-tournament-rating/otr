import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import {
  type JournalEntry,
  journalProblems,
  readJournal,
  unrecordedMigrations,
} from '../migrations';

const entry = (idx: number, when: number): JournalEntry => ({
  idx,
  when,
  tag: `000${idx}_fixture`,
});

describe('journalProblems', () => {
  it.each([
    ['older than the one before it', 999, 1],
    // The migrator applies only a strictly newer timestamp.
    ['the same as the one before it', 1000, 1],
    ['newer than the one before it', 1001, 0],
  ])('a timestamp %s', (_name, when, problems) => {
    const entries = [entry(0, 1000), entry(1, when)];
    expect(
      journalProblems(entries, ['0000_fixture.sql', '0001_fixture.sql'])
    ).toHaveLength(problems);
  });

  it('flags a .sql file the journal does not list', () => {
    const problems = journalProblems(
      [entry(0, 1000)],
      ['0000_fixture.sql', '0001_lost_in_a_merge.sql']
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith('0001_lost_in_a_merge.sql ');
  });
});

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

describe.skipIf(!url)('unrecordedMigrations', () => {
  const pool = new Pool({ connectionString: url });
  const schemas: string[] = [];
  const folders: string[] = [];

  afterAll(async () => {
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await pool.end();
    for (const folder of folders) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  // A migrations folder whose migrations, and the migrator's records of
  // them, live in a schema of their own, so nothing touches the test
  // database's real ones. `write` replaces the journal.
  const migrations = () => {
    const schema = `otr_migrations_test_${crypto.randomUUID().slice(0, 8)}`;
    const folder = mkdtempSync(join(tmpdir(), 'otr-migrations-'));
    schemas.push(schema);
    folders.push(folder);
    mkdirSync(join(folder, 'meta'));

    return {
      write(entries: [tag: string, when: number][]) {
        for (const [tag] of entries) {
          writeFileSync(
            join(folder, `${tag}.sql`),
            `CREATE TABLE "${schema}"."${tag}" (id integer);`
          );
        }
        writeFileSync(
          join(folder, 'meta', '_journal.json'),
          JSON.stringify({
            version: '7',
            dialect: 'postgresql',
            entries: entries.map(([tag, when], idx) => ({
              idx,
              version: '7',
              when,
              tag,
              breakpoints: true,
            })),
          })
        );
      },
      migrate: () =>
        migrate(drizzle(pool), {
          migrationsFolder: folder,
          migrationsSchema: schema,
        }),
      unrecorded: async () =>
        (await unrecordedMigrations(pool, readJournal(folder), schema)).map(
          (unrecorded) => unrecorded.tag
        ),
    };
  };

  it('finds a migration the migrator skipped for its older timestamp', async () => {
    const m = migrations();
    // Master's newest migration is applied, then a pull request rebased onto
    // it merges with the timestamp it was generated with.
    m.write([['0001_master', 2000]]);
    await m.migrate();
    m.write([
      ['0001_master', 2000],
      ['0002_rebased', 1000],
    ]);
    await m.migrate();

    expect(await m.unrecorded()).toEqual(['0002_rebased']);
  });

  it('finds nothing when every migration was applied', async () => {
    const m = migrations();
    m.write([['0001_master', 1000]]);
    await m.migrate();
    m.write([
      ['0001_master', 1000],
      ['0002_newer', 2000],
    ]);
    await m.migrate();

    expect(await m.unrecorded()).toEqual([]);
  });
});
