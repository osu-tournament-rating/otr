import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lib = join(import.meta.dir, '..', 'dev-db-lib.sh');
const script = join(import.meta.dir, '..', 'dev-db.sh');

function call(fn: string, ...args: string[]) {
  const result = Bun.spawnSync({
    cmd: ['bash', '-c', `set -euo pipefail; . "$0"; ${fn} "$@"`, lib, ...args],
  });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trim();
}

const verdict = (fn: string, ...args: string[]) =>
  call(fn, ...args).split(' ')[0];
const list = (...entries: string[]) => entries.join('\n');

const first = '1000 aaa';
const second = '2000 bbb';
const third = '3000 ccc';

describe('classify_journal', () => {
  test.each([
    ['identical journals', list(first, second), list(first, second), 'match'],
    ['applied behind expected', list(first), list(first, second), 'behind'],
    ['applied ahead of expected', list(first, second), list(first), 'ahead'],
    ['ahead by two', list(first, second, third), list(first), 'ahead'],
    [
      'same count, rewritten entry',
      list(first, '2000 xxx'),
      list(first, second),
      'diverged',
    ],
    [
      'longer with a rewritten prefix',
      list(first, '2000 xxx', third),
      list(first, second),
      'diverged',
    ],
    ['reordered entries', list(second, first), list(first, second), 'diverged'],
    ['empty database', '', list(first, second), 'behind'],
    ['empty on both sides', '', '', 'match'],
  ])('%s', (_name, applied, expected, want) => {
    expect(call('classify_journal', applied, expected)).toBe(want);
  });
});

describe('decide_isolation', () => {
  test.each([
    ['head matches base', list(first, second), list(first, second), 'share'],
    ['head behind base', list(first, second), list(first), 'share-behind'],
    [
      'head adds one migration',
      list(first, second),
      list(first, second, third),
      'isolate',
    ],
    [
      'head rewrites an applied migration',
      list(first, second),
      list(first, '2000 xxx'),
      'isolate',
    ],
    [
      'head adds a migration older than the base tip',
      list(first, third),
      list(first, third, second),
      'rebase-required',
    ],
    ['empty base', '', list(first), 'isolate'],
  ])('%s', (_name, base, head, want) => {
    expect(verdict('decide_isolation', base, head)).toBe(want);
  });
});

describe('decide_clone_action', () => {
  const day = '86400';
  test.each([
    ['no clone yet', ['false', '', '', '2', '', day], 'create'],
    [
      'clone from a previous seed generation',
      ['true', 'match', '1', '2', '10', day],
      'recreate',
    ],
    [
      'clone with no provenance',
      ['true', 'match', '', '2', '', day],
      'recreate',
    ],
    [
      'clone older than the limit',
      ['true', 'match', '2', '2', '90000', day],
      'recreate',
    ],
    [
      'clone the head rewrote',
      ['true', 'diverged', '2', '2', '10', day],
      'recreate',
    ],
    [
      'clone already at the head journal',
      ['true', 'match', '2', '2', '10', day],
      'reuse',
    ],
    [
      'clone behind the head journal',
      ['true', 'behind', '2', '2', '10', day],
      'reuse-migrate',
    ],
  ])('%s', (_name, args, want) => {
    expect(call('decide_clone_action', ...args)).toBe(want);
  });
});

describe('select_reapable', () => {
  test('drops only per-PR databases with no open pull request', () => {
    const databases = list(
      'otr_dev',
      'otr_dev_seed',
      'otr_pr_7',
      'otr_pr_12',
      'otr_pr_x'
    );
    expect(call('select_reapable', databases, '12\n40')).toBe('otr_pr_7');
  });

  test('drops every per-PR database when nothing is open', () => {
    expect(call('select_reapable', list('otr_dev', 'otr_pr_7'), '')).toBe(
      'otr_pr_7'
    );
  });
});

describe('check_capacity', () => {
  test.each([
    ['room to spare', ['500', '100', '1', '6', '120', '100'], 'ok'],
    [
      'free space below the threshold',
      ['200', '100', '1', '6', '120', '100'],
      'refuse-disk',
    ],
    [
      'clone count at the cap',
      ['500', '100', '6', '6', '120', '100'],
      'refuse-cap',
    ],
    ['unreadable figure', ['', '100', '1', '6', '120', '100'], 'refuse-disk'],
  ])('%s', (_name, args, want) => {
    expect(call('check_capacity', ...args)).toBe(want);
  });
});

describe('redact', () => {
  test('strips the connection string, the password and row values', () => {
    const noisy = [
      'connecting to postgresql://otr:hunter2@db:5432/otr_pr_1',
      'ERROR:  duplicate key value violates unique constraint',
      'DETAIL:  Key (osu_id)=(12345) already exists.',
      'CONTEXT:  SQL statement "insert into players"',
    ].join('\n');
    const result = Bun.spawnSync({
      cmd: ['bash', '-c', 'set -euo pipefail; . "$0"; redact', lib],
      env: { ...process.env, DOCKER_POSTGRES_PASSWORD: 'hunter2' },
      stdin: Buffer.from(noisy),
    });
    const out = result.stdout.toString();
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('osu_id');
    expect(out).not.toContain('insert into players');
    expect(out).toContain('duplicate key value');
  });

  test('strips absolute and home paths in every shape', () => {
    const noisy = [
      'gzip: /srv/dev/dumps/latest.sql.gz: No such file or directory',
      'psql:/srv/dev/seed.sql:12: ERROR: relation missing',
      'error at [/srv/dev/seed.sql]',
      'moving to:/srv/dev/dumps',
      'copy from ~/dev/dumps/seed.sql failed',
      'applied 10/20 migrations and/or seeds',
    ].join('\n');
    const result = Bun.spawnSync({
      cmd: ['bash', '-c', 'set -euo pipefail; . "$0"; redact', lib],
      stdin: Buffer.from(noisy),
    });
    const out = result.stdout.toString();
    expect(out).not.toContain('/srv');
    expect(out).not.toContain('~/dev');
    expect(out).toContain('gzip: /redacted: No such file or directory');
    expect(out).toContain('psql:/redacted:12: ERROR: relation missing');
    expect(out).toContain('error at [/redacted]');
    expect(out).toContain('moving to:/redacted');
    expect(out).toContain('copy from /redacted failed');
    expect(out).toContain('10/20 migrations and/or seeds');
  });

  test('strips a relative OTR_SCRIPTS_DIR the path rule cannot see', () => {
    const result = Bun.spawnSync({
      cmd: ['bash', '-c', 'set -euo pipefail; . "$0"; redact', lib],
      env: { ...process.env, OTR_SCRIPTS_DIR: 'otr-scripts' },
      stdin: Buffer.from('bash: otr-scripts/recover.sh: not found'),
    });
    expect(result.stdout.toString()).toBe(
      'bash: redacted/recover.sh: not found\n'
    );
  });

  test('keeps the connection string rule without a password in the environment', () => {
    const result = Bun.spawnSync({
      cmd: ['bash', '-c', 'set -euo pipefail; . "$0"; redact', lib],
      env: { ...process.env, DOCKER_POSTGRES_PASSWORD: '' },
      stdin: Buffer.from(
        'connecting to postgresql://otr:hunter2@db:5432/otr_pr_1'
      ),
    });
    const out = result.stdout.toString();
    expect(out).toContain('postgresql://redacted');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('otr_pr_1');
  });

  test('caps the output', () => {
    const result = Bun.spawnSync({
      cmd: ['bash', '-c', 'set -euo pipefail; . "$0"; redact', lib],
      env: { ...process.env, DEV_DB_LOG_LINES: '3' },
      stdin: Buffer.from(
        Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
      ),
    });
    expect(result.stdout.toString().trim().split('\n')).toEqual([
      'line 37',
      'line 38',
      'line 39',
    ]);
  });
});

describe('provenance_field', () => {
  test('reads a stamped field and ignores a missing one', () => {
    const stamped = '{"generation":1756000000,"created":1756000123}';
    expect(call('provenance_field', stamped, 'generation')).toBe('1756000000');
    expect(call('provenance_field', stamped, 'pr')).toBe('');
    expect(call('provenance_field', '', 'generation')).toBe('');
  });
});

describe('dev-db.sh', () => {
  // Every case fails before dev-db.sh reaches docker. The restore, the
  // migrator and the container are disarmed anyway, so a regression cannot
  // run the real recovery script on a developer's machine.
  function run(args: string[], env: Record<string, string> = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'dev-db-'));
    const result = Bun.spawnSync({
      cmd: [script, ...args],
      cwd: directory,
      env: {
        ...process.env,
        DEV_DB_LOCK_FILE: join(directory, 'dev-db.lock'),
        DEV_DB_CONTAINER: 'otr-dev-db-unit-test',
        DEV_RESTORE_COMMAND: 'false',
        DEV_MIGRATOR_COMMAND: 'false',
        OTR_SCRIPTS_DIR: directory,
        EXPECTED_JOURNAL: first,
        ...env,
      },
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  function archiveWithoutJournal() {
    const directory = mkdtempSync(join(tmpdir(), 'dev-db-archive-'));
    mkdirSync(join(directory, 'apps/web/drizzle'), { recursive: true });
    writeFileSync(
      join(directory, 'apps/web/drizzle/0000_one.sql'),
      'select 1;\n'
    );
    const packed = Bun.spawnSync({
      cmd: ['tar', '-czf', 'migrations.tar.gz', 'apps'],
      cwd: directory,
    });
    expect(packed.exitCode).toBe(0);
    return join(directory, 'migrations.tar.gz');
  }

  test('reports API version 3', () => {
    expect(run(['capabilities']).stdout).toContain('version=3');
  });

  test.each(['sync', 'restore'])(
    '%s refuses an archive without the journal before restoring',
    (command) => {
      const result = run([command], {
        MIGRATIONS_ARCHIVE: archiveWithoutJournal(),
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'MIGRATIONS_ARCHIVE has no apps/web/drizzle/meta/_journal.json'
      );
      expect(result.stdout + result.stderr).not.toContain('restoring');
    }
  );

  test('sync refuses an archive it cannot read without naming the path', () => {
    const missing = join(tmpdir(), 'dev-db-missing', 'migrations.tar.gz');
    const result = run(['sync'], { MIGRATIONS_ARCHIVE: missing });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'MIGRATIONS_ARCHIVE is not a readable file'
    );
    expect(result.stderr).not.toContain(missing);
  });
});

test('gives up when the host lock is already held', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dev-db-'));
  const lockFile = join(directory, 'dev-db.lock');
  const holder = Bun.spawn(['flock', '-x', lockFile, 'sleep', '30']);

  const held = () =>
    Bun.spawnSync(['flock', '-n', '-E', '4', lockFile, 'true']).exitCode === 4;
  for (let attempt = 0; attempt < 100 && !held(); attempt++) {
    await Bun.sleep(20);
  }

  const result = Bun.spawnSync({
    cmd: [script, 'classify', 'otr_pr_1'],
    cwd: directory,
    env: { ...process.env, DEV_DB_LOCK_FILE: lockFile, DEV_DB_LOCK_WAIT: '1' },
  });
  holder.kill();

  expect(result.exitCode).toBe(4);
  expect(result.stderr.toString()).toContain(
    'another dev tier operation still holds the lock'
  );
  expect(result.stderr.toString()).not.toContain(lockFile);
});
