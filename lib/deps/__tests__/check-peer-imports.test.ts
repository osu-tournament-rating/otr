import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPeerImports } from '../check-peer-imports';

// Unique names, so the walk up from a fixture never finds a real package above tmpdir
const suffix = crypto.randomUUID().slice(0, 8);
const host = `otr-fixture-host-${suffix}`;
const peer = `otr-fixture-peer-${suffix}`;
const scopedPeer = `@otr-fixture-${suffix}/peer`;

let base: string;
let root: string;

function writeJson(dir: string, value: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(value));
}

function writeSource(file: string, text: string): string {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
  return file;
}

function manifest(
  dir: string,
  value: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = {}
): void {
  writeJson(join(root, dir), { name: dir, ...value });
}

// The host lists both peers, as drizzle-orm lists pg
function installHost(): void {
  writeJson(join(root, 'node_modules', host), {
    name: host,
    version: '1.0.0',
    peerDependencies: { [peer]: '*', [scopedPeer]: '*' },
  });
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'otr-check-peer-imports-')));
  root = join(base, 'repo');
  writeJson(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
  installHost();
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('checkPeerImports', () => {
  test("reports an import of an undeclared peer of the workspace's dependency", () => {
    manifest('apps/w', { dependencies: { [host]: '^1.0.0' } });
    const file = writeSource(
      'apps/w/src/db.ts',
      `import { Pool } from '${peer}';`
    );

    expect(checkPeerImports(root, [file])).toEqual([
      `apps/w/src/db.ts: ${peer} is a peer of ${host}, and apps/w/package.json does not declare it`,
    ]);
  });

  test("reports an import of an undeclared peer of the root's dependency", () => {
    writeJson(root, {
      name: 'root',
      workspaces: ['apps/*'],
      devDependencies: { [host]: '^1.0.0' },
    });
    manifest('apps/w');
    const file = writeSource('apps/w/a.test.ts', `import '${peer}';`);

    expect(checkPeerImports(root, [file])).toEqual([
      `apps/w/a.test.ts: ${peer} is a peer of ${host}, and apps/w/package.json does not declare it`,
    ]);
  });

  test('accepts a peer that the workspace or the root declares', () => {
    manifest('apps/w', {
      dependencies: { [host]: '^1.0.0', [peer]: '^8.0.0' },
    });
    writeJson(root, {
      name: 'root',
      workspaces: ['apps/*'],
      devDependencies: { [scopedPeer]: '^1.0.0' },
    });
    const file = writeSource(
      'apps/w/db.ts',
      `import '${peer}';\nimport '${scopedPeer}';`
    );

    expect(checkPeerImports(root, [file])).toEqual([]);
  });

  test('ignores a peer of a package that only another workspace declares', () => {
    manifest('apps/v', { dependencies: { [host]: '^1.0.0' } });
    manifest('apps/w');
    const file = writeSource('apps/w/db.ts', `import '${peer}';`);

    expect(checkPeerImports(root, [file])).toEqual([]);
  });

  test('finds type, dynamic, require, re-export and subpath imports, once per file', () => {
    manifest('apps/w', { dependencies: { [host]: '^1.0.0' } });
    const typeOnly = writeSource(
      'apps/w/types.ts',
      `import type { Pool } from '${peer}';\nimport '${peer}/sub';`
    );
    const dynamic = writeSource(
      'apps/w/dynamic.mjs',
      `const { Pool } = await import('${scopedPeer}/deep/path');`
    );
    const required = writeSource(
      'apps/w/config.cjs',
      `module.exports = require('${peer}');`
    );
    const reExport = writeSource(
      'apps/w/index.tsx',
      `export { Pool } from '${scopedPeer}';`
    );

    expect(
      checkPeerImports(root, [typeOnly, dynamic, required, reExport])
    ).toEqual([
      `apps/w/types.ts: ${peer} is a peer of ${host}, and apps/w/package.json does not declare it`,
      `apps/w/dynamic.mjs: ${scopedPeer} is a peer of ${host}, and apps/w/package.json does not declare it`,
      `apps/w/config.cjs: ${peer} is a peer of ${host}, and apps/w/package.json does not declare it`,
      `apps/w/index.tsx: ${scopedPeer} is a peer of ${host}, and apps/w/package.json does not declare it`,
    ]);
  });

  test('ignores comments, strings and files outside a workspace', () => {
    writeJson(root, {
      name: 'root',
      workspaces: ['apps/*'],
      dependencies: { [host]: '^1.0.0' },
    });
    manifest('apps/w');
    // A package that is not a workspace, like the docs site's plugins
    writeJson(join(root, 'apps/docs/plugins/footer'), { name: 'footer' });
    const files = [
      writeSource(
        'apps/w/comment.ts',
        `// import '${peer}';\nconst s = "import '${peer}'";`
      ),
      writeSource('apps/docs/plugins/footer/index.ts', `import '${peer}';`),
      writeSource('apps/w/notes.md', `import '${peer}';`),
      'apps/w/deleted.ts',
    ];

    expect(checkPeerImports(root, files)).toEqual([]);
  });

  test('assigns root files to the root workspace', () => {
    writeJson(root, {
      name: 'root',
      workspaces: ['apps/*'],
      dependencies: { [host]: '^1.0.0' },
    });
    const files = [
      writeSource('migrate.ts', `import '${peer}';`),
      writeSource('scripts/run.ts', `import '${peer}';`),
    ];

    expect(checkPeerImports(root, files)).toEqual([
      `migrate.ts: ${peer} is a peer of ${host}, and package.json does not declare it`,
      `scripts/run.ts: ${peer} is a peer of ${host}, and package.json does not declare it`,
    ]);
  });
});
