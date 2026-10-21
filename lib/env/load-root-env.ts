import { config as loadEnv } from 'dotenv';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
let envLoaded = false;

/**
 * How the block that `apps/scripts/otr up` writes into a worktree's `.env`
 * begins (`BEGIN` in apps/scripts/src/lib/stack/envfile.py).
 */
export const STACK_BLOCK_START = '# >>> otr stack';

/**
 * The database a linked worktree with no stack connects to: a socket
 * directory that does not exist. Every connection fails at once without
 * reaching a server, and the error names the step that was missed.
 */
export const NO_STACK_DATABASE_URL =
  'postgresql://%2Fno-stack-run-apps-scripts-otr-up/no_stack';

export function loadRootEnv(): void {
  if (envLoaded) return;

  loadCheckoutEnv(projectRoot);
  envLoaded = true;
}

/**
 * Loads `<root>/.env` into `env`, leaving variables that are already set.
 *
 * A new linked worktree starts with a copy of the main checkout's `.env`,
 * whose DATABASE_URL is the developer's own database. Until `otr up` writes
 * the stack's block, that DATABASE_URL is swapped for one that reaches no
 * database, so migrations, the dev server, and the worker fail instead of
 * changing the developer's data. A DATABASE_URL set in the shell is used as
 * given, and the main checkout is left alone.
 */
export function loadCheckoutEnv(
  root: string,
  env: Record<string, string | undefined> = process.env
): void {
  const path = join(root, '.env');
  const { parsed } = loadEnv({ path, processEnv: env, quiet: true });

  // Bun loads the same file into the environment before any code runs, so
  // a value equal to the file's came from the file, not from the shell.
  const fromFile = parsed?.DATABASE_URL;
  if (
    fromFile !== undefined &&
    env.DATABASE_URL === fromFile &&
    isLinkedWorktree(root) &&
    !hasStackBlock(path)
  ) {
    env.DATABASE_URL = NO_STACK_DATABASE_URL;
  }
}

/** A linked worktree has a `.git` file pointing at the main checkout's. */
function isLinkedWorktree(root: string): boolean {
  return (
    statSync(join(root, '.git'), { throwIfNoEntry: false })?.isFile() ?? false
  );
}

function hasStackBlock(envPath: string): boolean {
  return readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(STACK_BLOCK_START));
}
