import { afterAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import {
  destructiveLines,
  type JournalEntry,
  journalProblems,
  LAST_UNCHECKED_MIGRATION,
  MIGRATIONS_FOLDER,
  readJournal,
  rollbackProblems,
  unrecordedMigrations,
} from '../migrations';

const entry = (idx: number, when: number): JournalEntry => ({
  idx,
  when,
  tag: `000${idx}_fixture`,
});

const merged = (tag: string) =>
  readFileSync(
    join(import.meta.dir, '..', '..', '..', MIGRATIONS_FOLDER, `${tag}.sql`),
    'utf8'
  );

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

describe('destructiveLines', () => {
  // Merged migrations never change, so they serve as fixtures.
  it.each([
    ['0008_sloppy_spacker_dave', 'a column rename'],
    ['0031_drop_logs', 'a table drop'],
    ['0036_drop_auth_admin_columns', 'column drops'],
  ])('flags %s, which has %s', (tag) => {
    expect(destructiveLines(merged(tag))).not.toEqual([]);
  });

  it.each([
    ['0010_wet_mariko_yashida', 'index drops'],
    ['0012_futuristic_ultron', 'constraint and NOT NULL drops'],
    [
      '0019_restore-cleared-tournament-submitters',
      'ON COMMIT DROP temp tables',
    ],
    ['0029_verification_inheritance', 'trigger drops'],
  ])('passes %s, which has only %s', (tag) => {
    expect(destructiveLines(merged(tag))).toEqual([]);
  });

  it('ignores comments, strings, and quoted identifiers', () => {
    const sql = [
      '-- drop table "logs" once nothing reads it',
      `/* rename column later */ SELECT 'DROP TABLE logs';`,
      'ALTER TABLE "players" ADD COLUMN "rename" integer;',
    ].join('\n');
    expect(destructiveLines(sql)).toEqual([]);
  });

  it('names the line each statement is on', () => {
    const sql = [
      'ALTER TABLE "players" ADD COLUMN "ruleset" integer;--> statement-breakpoint',
      'ALTER TABLE "players"',
      '  DROP COLUMN "default_ruleset";',
    ].join('\n');
    expect(destructiveLines(sql)).toEqual([
      'line 3: DROP COLUMN "default_ruleset";',
    ]);
  });
});

describe('rollbackProblems', () => {
  const drop = 'ALTER TABLE "players" DROP COLUMN "default_ruleset";';
  const entries = [
    { idx: 42, when: 1000, tag: LAST_UNCHECKED_MIGRATION },
    { idx: 43, when: 2000, tag: '0043_new' },
  ];

  it('flags a new migration that drops a column and says nothing about rollback', () => {
    const problems = rollbackProblems(entries, () => drop);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith('0043_new.sql ');
  });

  it('passes it once a comment says why rolling back past it is safe', () => {
    const sql = `-- rollback: no release since 2026.10.14 reads players.default_ruleset\n${drop}`;
    expect(rollbackProblems(entries, () => sql)).toEqual([]);
  });

  it(`leaves ${LAST_UNCHECKED_MIGRATION} and the migrations before it alone`, () => {
    const sql = (tag: string) =>
      tag === '0043_new' ? 'SELECT 1;' : 'DROP TABLE "logs";';
    expect(rollbackProblems(entries, sql)).toEqual([]);
  });

  it(`fails when the journal has no ${LAST_UNCHECKED_MIGRATION} to start after`, () => {
    expect(rollbackProblems(entries.slice(1), () => 'SELECT 1;')).toHaveLength(
      1
    );
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
