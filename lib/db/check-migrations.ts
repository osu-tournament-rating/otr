import { join } from 'node:path';
import { checkMigrations, MIGRATIONS_FOLDER } from './migrations';

// Run by `bun run lint`, so pre-commit and CI's lint check refuse a
// migration that a deploy would skip without an error.
if (import.meta.main) {
  const problems = checkMigrations(
    join(import.meta.dir, '..', '..', MIGRATIONS_FOLDER)
  );

  if (problems.length > 0) {
    for (const problem of problems) console.error(`${problem}\n`);
    console.error(`Fix the migrations in ${MIGRATIONS_FOLDER}.`);
    process.exit(1);
  }
}
