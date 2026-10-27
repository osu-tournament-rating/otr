import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TOKEN_GROUPS } from '@/lib/kit/color/tokens';

const css = readFileSync(
  join(import.meta.dir, '../../../../app/globals.css'),
  'utf8'
);

/** The custom properties declared directly in the first block whose selector matches. */
function declarations(selector: RegExp): Map<string, string> {
  const match = css.match(
    new RegExp(`(?:^|\\n)${selector.source}\\s*\\{([^}]*)\\}`)
  );
  if (!match) throw new Error(`No block for ${selector}`);

  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim().replace(/\s+/g, ' '),
    ])
  );
}

const light = declarations(/:root,\s*\.theme-light/);
const dark = declarations(/\.dark/);
const inlineTheme = declarations(/@theme inline/);

const entries = TOKEN_GROUPS.flatMap((group) => group.entries);

describe('globals.css', () => {
  it('declares every library token in both themes', () => {
    expect(entries.length).toBeGreaterThan(0);

    const missing = entries
      .map((entry) => entry.color.token)
      .filter((token) => !light.has(token) || !dark.has(token));

    expect(missing).toEqual([]);
  });

  it('registers a Tailwind colour for every token that names a utility', () => {
    const missing = TOKEN_GROUPS.flatMap((group) => group.entries)
      .filter((entry) => entry.utility)
      .filter(
        (entry) =>
          inlineTheme.get(`--color-${entry.utility}`) !==
          `var(${entry.color.token})`
      )
      .map((entry) => entry.utility);

    expect(missing).toEqual([]);
  });
});
