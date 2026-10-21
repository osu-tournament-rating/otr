import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { format, resolveConfig } from 'prettier';

import { generatePublicOpenAPISpec } from '@/app/server/openapi';

// apps/web/openapi.json is a committed copy of the generated public API
// reference. `bun run lint` fails when the generated reference no longer
// matches it, so a change to the public API shows up in review as a change to
// that copy, rather than reaching API users unnoticed.
//
//   bun app/server/openapi-reference.ts check   compares the two
//   bun app/server/openapi-reference.ts write   regenerates the copy

const REFERENCE_PATH = join(import.meta.dir, '..', '..', 'openapi.json');
const REPOSITORY_ROOT = join(import.meta.dir, '..', '..', '..', '..');

/** Lines of a failed check to print before summarizing the rest. */
const MAX_REPORTED = 40;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const formatPath = (path: readonly string[]) =>
  path.reduce(
    (text, key) =>
      IDENTIFIER.test(key)
        ? `${text}.${key}`
        : `${text}[${JSON.stringify(key)}]`,
    '$'
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Where two JSON values differ, one line per path: `+` for a key only `next`
 * has, `-` for a key only `previous` has, and `~` for a value that changed. A
 * list that changed at all counts as one changed value.
 */
export const diffReferences = (
  previous: unknown,
  next: unknown,
  path: readonly string[] = []
): string[] => {
  if (isRecord(previous) && isRecord(next)) {
    const keys = [
      ...Object.keys(previous),
      ...Object.keys(next).filter((key) => !Object.hasOwn(previous, key)),
    ];

    return keys.flatMap((key) => {
      const keyPath = [...path, key];
      if (!Object.hasOwn(next, key)) {
        return [`- ${formatPath(keyPath)}`];
      }
      if (!Object.hasOwn(previous, key)) {
        return [`+ ${formatPath(keyPath)}`];
      }
      return diffReferences(previous[key], next[key], keyPath);
    });
  }

  return Bun.deepEquals(previous, next, true) ? [] : [`~ ${formatPath(path)}`];
};

/**
 * The reference without its server URL, which comes from the environment and
 * is not part of the API.
 */
const generateReference = async (): Promise<unknown> => {
  const { servers: _servers, ...reference } = await generatePublicOpenAPISpec();
  return JSON.parse(JSON.stringify(reference));
};

const write = async (displayPath: string) => {
  const options = await resolveConfig(REFERENCE_PATH);
  const text = await format(JSON.stringify(await generateReference()), {
    ...options,
    filepath: REFERENCE_PATH,
  });
  await Bun.write(REFERENCE_PATH, text);
  console.log(`Wrote ${displayPath}`);
};

const check = async (displayPath: string) => {
  const committed = existsSync(REFERENCE_PATH)
    ? JSON.parse(await Bun.file(REFERENCE_PATH).text())
    : undefined;
  const differences = diffReferences(committed, await generateReference());
  if (differences.length === 0) {
    return;
  }

  console.error(`The public API reference no longer matches ${displayPath}:`);
  for (const line of differences.slice(0, MAX_REPORTED)) {
    console.error(`  ${line}`);
  }
  if (differences.length > MAX_REPORTED) {
    console.error(`  ...and ${differences.length - MAX_REPORTED} more`);
  }
  console.error('');
  console.error(
    'If the API is meant to change, regenerate the copy and commit it with your change:'
  );
  console.error('  bun run --filter web openapi');
  console.error(
    'Removing or renaming a field, or adding a required input, breaks API users.'
  );
  process.exit(1);
};

if (import.meta.main) {
  const displayPath = relative(REPOSITORY_ROOT, REFERENCE_PATH);
  const mode = process.argv[2];

  if (mode === 'write') {
    await write(displayPath);
  } else if (mode === 'check') {
    await check(displayPath);
  } else {
    console.error('Usage: bun app/server/openapi-reference.ts <check|write>');
    process.exit(2);
  }
}
