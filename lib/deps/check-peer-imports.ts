import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import {
  declaredDependencies,
  findInstalled,
  listWorkspaces,
  readManifest,
} from './workspaces';

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

// '@scope/name/sub/path' -> '@scope/name', 'name/sub/path' -> 'name'
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : (parts[0] ?? '');
}

/**
 * Reports each import of a package that neither the importing workspace nor
 * the root declares, but that a package one of them declares lists as a peer
 * dependency. knip accepts such an import whenever the package resolves, and a
 * worktree resolves it from the main checkout, so an optional peer that CI
 * never installs passes knip locally.
 *
 * `files` are paths relative to the root. A file belongs to the workspace whose
 * package.json is nearest above it; files under any other package.json, and
 * files that are not JavaScript or TypeScript, are skipped.
 */
export function checkPeerImports(rootDir: string, files: string[]): string[] {
  const root = realpathSync(rootDir);
  const workspaces = new Set(listWorkspaces(root));
  const declared = (ws: string) =>
    Object.keys(
      declaredDependencies(readManifest(join(root, ws, 'package.json')))
    );
  const rootDeclared = declared('.');

  const owners = new Map<string, string | undefined>();
  const ownerOf = (dir: string): string | undefined => {
    if (owners.has(dir)) return owners.get(dir);
    let owner: string | undefined;
    if (existsSync(join(root, dir, 'package.json'))) {
      owner = workspaces.has(dir) ? dir : undefined;
    } else if (dir !== '.') {
      owner = ownerOf(dirname(dir));
    }
    owners.set(dir, owner);
    return owner;
  };

  const filesByWorkspace = new Map<string, string[]>();
  for (const file of files) {
    if (!SOURCE_FILE.test(file) || !existsSync(join(root, file))) continue;
    const owner = ownerOf(dirname(file));
    if (owner === undefined) continue;
    const owned = filesByWorkspace.get(owner) ?? [];
    owned.push(file);
    filesByWorkspace.set(owner, owned);
  }

  const problems: string[] = [];
  for (const [ws, wsFiles] of filesByWorkspace) {
    const own = declared(ws);
    const accepted = new Set([...own, ...rootDeclared]);

    // knip looks for a host among the workspace's own dependencies and the root's
    const hostPeers = new Map<string, string>();
    const sources: [string, string[]][] =
      ws === '.'
        ? [['.', rootDeclared]]
        : [
            [ws, own],
            ['.', rootDeclared],
          ];
    for (const [dir, names] of sources) {
      for (const host of names) {
        const installed = findInstalled(join(root, dir), host);
        if (!installed) continue;
        const peers = readManifest(
          join(installed, 'package.json')
        ).peerDependencies;
        for (const peer of Object.keys(peers ?? {})) {
          if (!accepted.has(peer) && !hostPeers.has(peer))
            hostPeers.set(peer, host);
        }
      }
    }
    if (hostPeers.size === 0) continue;

    const manifestPath = join(ws, 'package.json');
    for (const file of wsFiles) {
      const { importedFiles } = ts.preProcessFile(
        readFileSync(join(root, file), 'utf8'),
        true,
        true
      );
      const reported = new Set<string>();
      for (const { fileName } of importedFiles) {
        const name = packageName(fileName);
        const host = hostPeers.get(name);
        if (!host || reported.has(name)) continue;
        reported.add(name);
        problems.push(
          `${file}: ${name} is a peer of ${host}, and ${manifestPath} does not declare it`
        );
      }
    }
  }

  return problems;
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..');
  // Tracked files plus untracked ones that are not ignored, as knip sees them
  const git = Bun.spawnSync(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root }
  );
  if (git.exitCode !== 0) {
    console.error(git.stderr.toString());
    process.exit(1);
  }

  const problems = checkPeerImports(
    root,
    git.stdout.toString().split('\0').filter(Boolean)
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error('');
    console.error(
      'Declare each package above in the package.json its line names. knip accepts these imports wherever the package resolves, and a worktree resolves it from the main checkout.'
    );
    process.exit(1);
  }
}
