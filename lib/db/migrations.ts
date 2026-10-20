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

/** Every problem `lint:migrations` reports for the migrations in `folder`. */
export function checkMigrations(folder: string): string[] {
  const sqlFiles = readdirSync(folder).filter((file) => file.endsWith('.sql'));
  return journalProblems(readJournal(folder), sqlFiles);
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
