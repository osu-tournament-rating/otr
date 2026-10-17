import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export type Manifest = {
  version?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

export function declaredDependencies(
  manifest: Manifest
): Record<string, string> {
  return { ...manifest.dependencies, ...manifest.devDependencies };
}

/** The root as '.', then each workspace directory relative to it, sorted. */
export function listWorkspaces(root: string): string[] {
  const patterns = readManifest(join(root, 'package.json')).workspaces ?? [];
  return [
    '.',
    ...patterns
      .flatMap((pattern) => [
        ...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root }),
      ])
      .map((manifest) => dirname(manifest))
      .sort(),
  ];
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// Node's walk-up lookup: the nearest node_modules/<name> wins, even above the checkout
export function findInstalled(
  fromDir: string,
  name: string
): string | undefined {
  let dir = fromDir;
  while (true) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
