import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'deploy-stack.sh');

// Stands in for docker on the host. It logs each call, fails the one whose
// arguments contain FAIL, and, like `compose run`, reads stdin for `run`.
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$DOCKER_LOG"
if [[ " $* " == *" run "* ]]; then cat >/dev/null; fi
if [[ -n "\${FAIL:-}" && "$*" == *"$FAIL"* ]]; then exit 1; fi
case "$*" in
  "compose config --services") printf '%s\\n' db migrate web web-standby data-worker ;;
  "container inspect"*) exit 1 ;;
esac
`;

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'otr-deploy-stack-'));
  mkdirSync(join(work, 'bin'));
  mkdirSync(join(work, 'remote'));
  writeFileSync(join(work, 'bin', 'docker'), FAKE_DOCKER);
  chmodSync(join(work, 'bin', 'docker'), 0o755);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

// Runs the script the way deploy.yml does: on stdin of `bash -s`.
function deploy(fail?: string) {
  const log = join(work, 'docker.log');
  writeFileSync(log, '');
  const result = Bun.spawnSync({
    cmd: ['bash', '-s', '--', join(work, 'remote')],
    stdin: readFileSync(script),
    env: {
      PATH: `${join(work, 'bin')}:${process.env.PATH}`,
      DOCKER_LOG: log,
      ...(fail ? { FAIL: fail } : {}),
    },
  });
  return {
    exitCode: result.exitCode,
    calls: readFileSync(log, 'utf8').trim().split('\n'),
  };
}

describe('deploy-stack.sh', () => {
  test('pulls, migrates, restarts each web container, then the rest', () => {
    const { exitCode, calls } = deploy();

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      'compose pull',
      'compose --profile migrate run --rm -T migrate',
      'container inspect -f {{ json .Config.Labels }} otr-docs',
      'compose config --services',
      'compose up -d --wait --wait-timeout 300 web-standby',
      'compose up -d --wait --wait-timeout 300 web',
      'compose --profile node-exporter up -d --remove-orphans',
      'compose kill -s SIGHUP prometheus alertmanager',
    ]);
  });

  test('stops before migrating when the pull fails', () => {
    const { exitCode, calls } = deploy('pull');

    expect(exitCode).not.toBe(0);
    expect(calls).toEqual(['compose pull']);
  });

  test('fails when restarting the rest of the stack fails', () => {
    const { exitCode, calls } = deploy('--remove-orphans');

    expect(exitCode).not.toBe(0);
    expect(calls.at(-1)).toBe(
      'compose --profile node-exporter up -d --remove-orphans'
    );
  });
});
