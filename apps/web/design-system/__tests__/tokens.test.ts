import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { typeScale } from '@/components/kit/layout/Typography';

import { COLOR_USAGE, TYPE_GROUPS, buildTokens } from '../tokens';

const web = join(import.meta.dir, '../..');
const globalsCss = readFileSync(join(web, 'app/globals.css'), 'utf8');
const themeCss = readFileSync(
  require.resolve('tailwindcss/theme.css', { paths: [web] }),
  'utf8'
);

describe('buildTokens', () => {
  const tokens = buildTokens(globalsCss, themeCss);

  it('gives every colour in globals.css a usage note and a value', () => {
    expect(tokens.color.tokens).toHaveLength(Object.keys(COLOR_USAGE).length);
    for (const token of tokens.color.tokens) {
      expect(token.usage.length).toBeGreaterThan(0);
      expect(typeof token.value === 'object' && token.value.light).toBeTruthy();
    }
  });

  it('resolves Tailwind palette references to their values', () => {
    const destructive = tokens.color.tokens.find(
      (t) => t.name === 'destructive'
    );
    expect(destructive?.value).toMatchObject({
      light: expect.stringMatching(/^oklch\(/),
      dark: expect.stringMatching(/^oklch\(/),
    });
  });

  it('turns a reference to another token into an alias', () => {
    const warning = tokens.color.tokens.find((t) => t.name === 'warning');
    expect(warning?.value).toMatchObject({ light: '{color-warning}' });
  });

  it('works out the radii and header height from their formulas', () => {
    expect(tokens.radius.tokens.map((t) => [t.name, t.value])).toEqual([
      ['radius-sm', '4px'],
      ['radius-md', '6px'],
      ['radius-lg', '8px'],
      ['radius-xl', '12px'],
      ['radius-full', '9999px'],
    ]);
    expect(
      tokens.spacing.tokens.find((t) => t.name === 'header-height-px')?.value
    ).toBe('64px');
  });

  it('rejects a colour it has no usage note for', () => {
    const extra = globalsCss.replace(
      /(:root,\s*\.theme-light\s*\{)/,
      '$1\n  --brand-new: #123456;'
    );
    expect(() => buildTokens(extra, themeCss)).toThrow(/--brand-new/);
  });
});

/** Tailwind's text sizes as [font size, line height] in px. */
const TEXT_SIZES: Record<string, [number, number]> = {
  xs: [12, 16],
  sm: [14, 20],
  base: [16, 24],
  lg: [18, 28],
  xl: [20, 28],
  '2xl': [24, 32],
  '3xl': [30, 36],
};
const WEIGHTS: Record<string, number> = {
  'font-medium': 500,
  'font-semibold': 600,
  'font-bold': 700,
};

describe('TYPE_GROUPS', () => {
  const styles = TYPE_GROUPS.flatMap((g) => g.styles).filter((s) => s.scale);

  it.each(styles.map((s) => [s.name, s] as const))(
    '%s matches its typeScale entry',
    (_name, style) => {
      const classes = (typeScale as Record<string, string>)[style.scale!];
      expect(classes).toBeDefined();
      const prefix = style.at === 'sm' ? 'sm:' : '';
      const size = classes
        .split(' ')
        .find(
          (c) =>
            c.startsWith(`${prefix}text-`) &&
            c.slice(prefix.length + 5) in TEXT_SIZES
        )
        ?.slice(prefix.length + 5);
      expect(size).toBeDefined();
      const [fontSize, lineHeight] = TEXT_SIZES[size!];
      expect(style.fontSize).toBe(`${fontSize}px`);
      const leading = /(?:^| )leading-(\d+)(?: |$)/.exec(classes);
      expect(style.lineHeight).toBe(
        `${leading ? Number(leading[1]) * 4 : lineHeight}px`
      );
      const weight =
        Object.entries(WEIGHTS).find(([c]) =>
          classes.split(' ').includes(c)
        )?.[1] ?? 400;
      expect(style.fontWeight).toBe(weight);
    }
  );
});
