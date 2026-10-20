import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Where drizzle-kit generates the migrations, relative to the repository root. */
export const MIGRATIONS_FOLDER = 'apps/web/drizzle';

export interface JournalEntry {
  idx: number;
  /** Milliseconds since the epoch. The migrator records it as `created_at`. */
  when: number;
  tag: string;
}

/** The migrations in `folder`'s journal, in the order the migrator applies them. */
export function readJournal(folder: string): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

/**
 * Problems with the journal that would make the migrator skip a migration
 * without an error.
 *
 * Drizzle's migrator applies a migration only when its `when` is newer than
 * the newest `created_at` the database has recorded. A migration timestamped
 * before the one listed ahead of it, as when a pull request is rebased onto a
 * newer migration and keeps its own timestamp, is never applied to a database
 * that already has the newer one. A .sql file missing from the journal, as
 * when a merge conflict in the journal drops its entry, is never applied
 * anywhere.
 */
export function journalProblems(
  entries: JournalEntry[],
  sqlFiles: string[]
): string[] {
  const problems: string[] = [];

  for (let i = 1; i < entries.length; i++) {
    const previous = entries[i - 1]!;
    const entry = entries[i]!;
    if (entry.when <= previous.when) {
      problems.push(
        `${entry.tag} is timestamped ${entry.when}, which is not after ${previous.tag} (${previous.when}). ` +
          `The migrator applies only migrations newer than the newest one a database has, so it would skip ${entry.tag} without an error. ` +
          `Set its "when" in meta/_journal.json to a later time, such as Date.now().`
      );
    }
  }

  const listed = new Set(entries.map((entry) => `${entry.tag}.sql`));
  for (const file of sqlFiles) {
    if (!listed.has(file)) {
      problems.push(
        `${file} is not in meta/_journal.json, so the migrator never applies it. Restore its journal entry or delete the file.`
      );
    }
  }

  return problems;
}

/**
 * The last migration merged before `rollbackProblems` existed. Merged
 * migrations are immutable, so it checks only the ones after this.
 */
export const LAST_UNCHECKED_MIGRATION = '0042_user_activity_daily';

/** Any rename, and dropping anything an older release's queries can name. */
const DESTRUCTIVE =
  /\b(?:RENAME|DROP\s+(?:COLUMN|TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|SCHEMA))\b/gi;

/** A comment saying why rolling back past the migration is still safe. */
const ROLLBACK_NOTE = /^[ \t]*--[ \t]*rollback:[ \t]*\S/im;

/**
 * `sql` with its comments, strings, and quoted identifiers blanked out, so a
 * match in the result is SQL that runs, at the same offset as in `sql`.
 */
function blankNonCode(sql: string): string {
  return sql.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"/g,
    (text) => text.replace(/[^\n]/g, ' ')
  );
}

/** The lines of `sql` that rename or drop something, as `line N: <text>`. */
export function destructiveLines(sql: string): string[] {
  const lines = sql.split('\n');
  const found = new Set<number>();
  for (const match of blankNonCode(sql).matchAll(DESTRUCTIVE)) {
    found.add(sql.slice(0, match.index).split('\n').length);
  }
  return [...found].map((line) => `line ${line}: ${lines[line - 1]!.trim()}`);
}

/**
 * Migrations after LAST_UNCHECKED_MIGRATION that rename or drop something
 * and have no `-- rollback:` comment.
 *
 * A bad release is rolled back by redeploying an older one, which leaves the
 * migrations in place. After a migration renames or drops a column or table,
 * an older release queries one that no longer exists. Such a change belongs
 * in two releases: one adds the new column or table and moves the code to
 * it, and a later one drops the old one. The comment records why rolling back
 * past the migration is safe.
 */
export function rollbackProblems(
  entries: JournalEntry[],
  readSql: (tag: string) => string
): string[] {
  const start = entries.findIndex(
    (entry) => entry.tag === LAST_UNCHECKED_MIGRATION
  );
  if (start === -1) {
    return [
      `${LAST_UNCHECKED_MIGRATION} is not in meta/_journal.json, so the rollback check cannot tell which migrations are new.`,
    ];
  }

  const problems: string[] = [];
  for (const entry of entries.slice(start + 1)) {
    const sql = readSql(entry.tag);
    const lines = destructiveLines(sql);
    if (lines.length === 0 || ROLLBACK_NOTE.test(sql)) continue;

    problems.push(
      [
        `${entry.tag}.sql renames or drops something an older release may still read:`,
        ...lines.map((line) => `  ${line}`),
        'A rollback redeploys an older release and leaves the migrations in place.',
        'Add the new column or table in one release, and drop the old one in a later release, once no release you might roll back to reads it.',
        'Then add a comment to the migration that says why rolling back past it is safe, such as:',
        '  -- rollback: no release since 2026.10.14 reads players.default_ruleset',
      ].join('\n')
    );
  }
  return problems;
}

/** Every problem `lint:migrations` reports for the migrations in `folder`. */
export function checkMigrations(folder: string): string[] {
  const entries = readJournal(folder);
  const sqlFiles = readdirSync(folder).filter((file) => file.endsWith('.sql'));
  return [
    ...journalProblems(entries, sqlFiles),
    ...rollbackProblems(entries, (tag) =>
      readFileSync(join(folder, `${tag}.sql`), 'utf8')
    ),
  ];
}

/**
 * The journal entries `pool`'s database has no record of. Run after the
 * migrator, it finds a migration the migrator skipped without an error.
 */
export async function unrecordedMigrations(
  pool: Pool,
  entries: JournalEntry[],
  migrationsSchema = 'drizzle'
): Promise<JournalEntry[]> {
  const { rows } = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM "${migrationsSchema.replace(/"/g, '""')}".__drizzle_migrations`
  );
  const recorded = new Set(rows.map((row) => Number(row.created_at)));
  return entries.filter((entry) => !recorded.has(entry.when));
}
