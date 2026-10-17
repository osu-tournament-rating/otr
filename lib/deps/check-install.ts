import { existsSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  declaredDependencies,
  findInstalled,
  isInside,
  listWorkspaces,
  readManifest,
} from './workspaces';

// Ranges that name a source rather than a version, so there is nothing to compare
const NON_SEMVER_RANGE = /^(workspace|file|link|npm|git|github|https?):/;

/**
 * Checks that every dependency each workspace declares resolves inside this
 * checkout, at a version its declared range allows. A worktree inside the main
 * checkout otherwise picks up whatever the main checkout has installed.
 */
export function checkInstall(rootDir: string): {
  problems: string[];
  nodeModulesDirs: string[];
} {
  const root = realpathSync(rootDir);
  const workspaces = listWorkspaces(root);

  const nodeModulesDirs = workspaces
    .map((ws) => join(ws, 'node_modules'))
    .filter((dir) => existsSync(join(root, dir)));

  if (!existsSync(join(root, 'node_modules'))) {
    return { problems: ['this checkout has no node_modules'], nodeModulesDirs };
  }

  const problems: string[] = [];
  for (const ws of workspaces) {
    const manifestPath = join(ws, 'package.json');
    const declared = declaredDependencies(
      readManifest(join(root, manifestPath))
    );

    for (const [name, range] of Object.entries(declared)) {
      const installed = findInstalled(join(root, ws), name);
      if (!installed) {
        problems.push(`${manifestPath}: ${name} is not installed`);
        continue;
      }
      if (!isInside(root, installed)) {
        problems.push(
          `${manifestPath}: ${name} resolves from outside this checkout, at ${installed}`
        );
        continue;
      }
      if (NON_SEMVER_RANGE.test(range)) continue;

      const version = readManifest(join(installed, 'package.json')).version;
      if (!version || !Bun.semver.satisfies(version, range)) {
        problems.push(
          `${manifestPath}: ${name} resolves to ${version ?? 'no version'} at ${relative(root, installed)}, outside its declared ${range}`
        );
      }
    }
  }

  return { problems, nodeModulesDirs };
}

if (import.meta.main) {
  const { problems, nodeModulesDirs } = checkInstall(
    join(import.meta.dir, '..', '..')
  );

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);

    // Concrete paths only: fish and zsh abort the whole command on an unmatched glob
    const dirs =
      nodeModulesDirs.length > 0 ? nodeModulesDirs : ['node_modules'];
    console.error('');
    console.error('Reinstall from the lockfile, from the repository root:');
    console.error(
      `  rm -rf ${dirs.join(' ')} && bun install --frozen-lockfile`
    );
    console.error(
      "New Claude desktop worktrees copy the main checkout's node_modules, so a stale main checkout needs the same reinstall."
    );
    process.exit(1);
  }
}
