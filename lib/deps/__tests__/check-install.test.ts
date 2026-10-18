import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkInstall } from '../check-install';

// Unique names, so the walk up from a fixture never finds a real package above tmpdir
const suffix = crypto.randomUUID().slice(0, 8);
const a = `otr-fixture-a-${suffix}`;
const b = `otr-fixture-b-${suffix}`;
const scoped = `@otr-fixture-${suffix}/p`;

let base: string;
let root: string;

function writeJson(dir: string, value: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(value));
}

function manifest(
  dir: string,
  value: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  } = {}
): void {
  writeJson(join(root, dir), { name: dir, ...value });
}

function install(dir: string, name: string, version: string): void {
  writeJson(join(dir, 'node_modules', name), { name, version });
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'otr-check-install-')));
  root = join(base, 'repo');
  writeJson(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('checkInstall', () => {
  test('reports nothing for a clean install', () => {
    manifest('apps/w', {
      dependencies: { [a]: '^1.0.0' },
      devDependencies: { [b]: '2.0.0' },
      peerDependencies: { [`${a}-peer`]: '^1.0.0' },
      optionalDependencies: { [`${a}-optional`]: '^1.0.0' },
    });
    install(root, a, '1.4.2');
    install(root, b, '2.0.0');

    expect(checkInstall(root).problems).toEqual([]);
  });

  test('reports a checkout with no node_modules as one problem', () => {
    manifest('apps/w', { dependencies: { [a]: '^1.0.0' } });

    expect(checkInstall(root).problems).toEqual([
      'this checkout has no node_modules',
    ]);
  });

  test('reports a dependency that resolves from above the checkout', () => {
    manifest('apps/w', { dependencies: { [a]: '^1.0.0' } });
    mkdirSync(join(root, 'node_modules'));
    install(base, a, '1.0.0');

    expect(checkInstall(root).problems).toEqual([
      `apps/w/package.json: ${a} resolves from outside this checkout, at ${join(base, 'node_modules', a)}`,
    ]);
  });

  test('reports a stale nested copy outside the declared range', () => {
    manifest('apps/w', { devDependencies: { [a]: '^10.0.0' } });
    install(root, a, '10.2.0');
    install(join(root, 'apps/w'), a, '9.0.0');

    expect(checkInstall(root).problems).toEqual([
      `apps/w/package.json: ${a} resolves to 9.0.0 at apps/w/node_modules/${a}, outside its declared ^10.0.0`,
    ]);
  });

  test('reports a dependency that is not installed', () => {
    writeJson(root, {
      name: 'root',
      workspaces: ['apps/*'],
      devDependencies: { [b]: '^2.0.0' },
    });
    mkdirSync(join(root, 'node_modules'));

    expect(checkInstall(root).problems).toEqual([
      `package.json: ${b} is not installed`,
    ]);
  });

  test('skips the version check for a workspace range', () => {
    manifest('apps/w', { dependencies: { [a]: 'workspace:*' } });
    install(root, a, '0.0.0');

    expect(checkInstall(root).problems).toEqual([]);
  });

  test('resolves a scoped package', () => {
    manifest('apps/w', { dependencies: { [scoped]: '^3.0.0' } });
    install(root, scoped, '2.1.0');

    expect(checkInstall(root).problems).toEqual([
      `apps/w/package.json: ${scoped} resolves to 2.1.0 at node_modules/${scoped}, outside its declared ^3.0.0`,
    ]);
  });

  test('lists only the node_modules directories that exist', () => {
    manifest('apps/w');
    manifest('apps/v');
    manifest('packages/core');
    mkdirSync(join(root, 'node_modules'));
    mkdirSync(join(root, 'apps/w/node_modules'));

    expect(checkInstall(root).nodeModulesDirs).toEqual([
      'node_modules',
      'apps/w/node_modules',
    ]);
  });
});
