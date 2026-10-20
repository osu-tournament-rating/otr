import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

import {
  loadCheckoutEnv,
  loadRootEnv,
  NO_STACK_DATABASE_URL,
  STACK_BLOCK_START,
} from '../load-root-env';

test('loadRootEnv does not print a dotenv banner', () => {
  const log = spyOn(console, 'log');
  const error = spyOn(console, 'error');

  try {
    loadRootEnv();

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});

/** The first line of the block `otr up` writes, as apps/scripts defines it. */
const stackBlockBegin = () => {
  const envfile = readFileSync(
    fileURLToPath(
      new URL('../../../apps/scripts/src/lib/stack/envfile.py', import.meta.url)
    ),
    'utf8'
  );
  const begin = envfile.match(/^BEGIN = "(.+)"$/m)?.[1];
  expect(begin).toStartWith(STACK_BLOCK_START);
  return begin!;
};

describe('loadCheckoutEnv', () => {
  const developerDatabase =
    'postgresql://postgres:password@localhost:5432/postgres';
  const stackDatabase =
    'postgresql://postgres:password@127.0.0.1:20011/postgres';
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'otr-env-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const linkedWorktree = (envText: string) => {
    writeFileSync(join(root, '.git'), 'gitdir: /checkout/.git/worktrees/a\n');
    writeFileSync(join(root, '.env'), envText);
  };

  test('points a worktree with no stack at no database, keeping the rest of the copied .env', () => {
    linkedWorktree(`DATABASE_URL=${developerDatabase}\nWEB_OSU_CLIENT_ID=1\n`);
    const env: Record<string, string | undefined> = {};

    loadCheckoutEnv(root, env);

    expect(env.DATABASE_URL).toBe(NO_STACK_DATABASE_URL);
    expect(env.WEB_OSU_CLIENT_ID).toBe('1');
  });

  test('replaces the copied DATABASE_URL that Bun already loaded from the same .env', () => {
    linkedWorktree(`DATABASE_URL=${developerDatabase}\n`);
    const env: Record<string, string | undefined> = {
      DATABASE_URL: developerDatabase,
    };

    loadCheckoutEnv(root, env);

    expect(env.DATABASE_URL).toBe(NO_STACK_DATABASE_URL);
  });

  test("uses the stack's DATABASE_URL once otr up has written its block", () => {
    linkedWorktree(
      [
        'WEB_OSU_CLIENT_ID=1',
        '',
        stackBlockBegin(),
        `DATABASE_URL=${stackDatabase}`,
        '# <<< otr stack',
        '',
      ].join('\n')
    );
    const env: Record<string, string | undefined> = {};

    loadCheckoutEnv(root, env);

    expect(env.DATABASE_URL).toBe(stackDatabase);
  });

  test('keeps a DATABASE_URL set in the shell', () => {
    linkedWorktree(`DATABASE_URL=${developerDatabase}\n`);
    const env: Record<string, string | undefined> = {
      DATABASE_URL: stackDatabase,
    };

    loadCheckoutEnv(root, env);

    expect(env.DATABASE_URL).toBe(stackDatabase);
  });

  test("leaves the main checkout's DATABASE_URL alone", () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.env'), `DATABASE_URL=${developerDatabase}\n`);
    const env: Record<string, string | undefined> = {};

    loadCheckoutEnv(root, env);

    expect(env.DATABASE_URL).toBe(developerDatabase);
  });
});
