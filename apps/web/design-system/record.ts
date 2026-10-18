/**
 * Records uploaded assets in artifact.json, so the next build points the
 * design system at them:
 *
 *   bun design-system/record.ts /icons/mods/mod-hidden.svg=<blob id> …
 *
 * Each argument is a public path (as the site serves it) and the id the
 * artifact's asset upload returned. The file's hash is stored with it, so a
 * later change to the file shows up as needing a new upload.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const record = join(import.meta.dir, 'artifact.json');
const publicDir = join(import.meta.dir, '../public');
const data = JSON.parse(readFileSync(record, 'utf8'));

for (const arg of process.argv.slice(2)) {
  const match = /^(\/[^=]+)=([0-9a-f]{32})$/.exec(arg);
  if (!match)
    throw new Error(`expected /public/path=<32-hex blob id>, got ${arg}`);
  const [, path, blob] = match;
  const file = join(publicDir, path);
  if (!existsSync(file)) throw new Error(`no such public file: ${path}`);
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  data.assets[path] = { blob, sha256 };
}

data.assets = Object.fromEntries(
  Object.entries(data.assets).sort(([a], [b]) => a.localeCompare(b))
);
writeFileSync(record, JSON.stringify(data, null, 2) + '\n');
console.log(`Recorded ${process.argv.length - 2} assets in artifact.json.`);
