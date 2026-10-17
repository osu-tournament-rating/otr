import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { Mods } from '@otr/core/osu';

import FittingModIconset from '@/components/icons/FittingModIconset';
import ModIconset from '@/components/icons/ModIconset';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ModsEnumHelper } from '@/lib/enum-helpers';
import {
  MOD_BADGES,
  getModBadgeAcronyms,
  getModName,
} from '@/lib/utils/mod-badges';

const iconDir = join(import.meta.dir, '../../../public/icons/mods');

const renderToStaticMarkup = (node: ReactNode) =>
  renderMarkup(<TooltipProvider>{node}</TooltipProvider>);

/** Each badge is a button named for its mod. */
const BADGE = /<button[^>]*aria-label="[^"]+"/g;

const singleBitMods = Object.values(Mods).filter(
  (value): value is Mods =>
    typeof value === 'number' && value !== 0 && (value & (value - 1)) === 0
);

describe('ModIconset', () => {
  it('has a glyph file for every badge', () => {
    const missing = Object.values(MOD_BADGES)
      .map(({ glyph }) => glyph)
      .filter(
        (glyph) => !glyph || !existsSync(join(iconDir, `mod-${glyph}.svg`))
      );

    expect(missing).toEqual([]);
    expect(existsSync(join(iconDir, 'blanks/mod-icon.svg'))).toBe(true);
  });

  it('draws a glyph for every single-bit mod with an acronym', () => {
    const withoutGlyphs = singleBitMods
      .filter((mod) => ModsEnumHelper.metadata[mod].text !== '')
      .filter(
        (mod) =>
          !renderToStaticMarkup(<ModIconset mods={mod} />).includes(
            '/icons/mods/mod-'
          )
      )
      .map((mod) => ModsEnumHelper.metadata[mod].text);

    expect(withoutGlyphs).toEqual([]);
  });

  it('draws a mod through its glyph in its type colour', () => {
    const html = renderToStaticMarkup(<ModIconset mods={Mods.Hidden} />);

    expect(html).toContain('aria-label="Hidden"');
    expect(html).not.toContain('aria-label="HD"');
    expect(html).toContain('/icons/mods/blanks/mod-icon.svg');
    expect(html).toContain('/icons/mods/mod-hidden.svg');
    expect(html).toContain('background-color:hsl(360, 100%, 70%)');
    expect(html).toContain(
      'color-mix(in srgb-linear, black, hsl(360, 100%, 70%) 10%)'
    );
  });

  it('maps legacy acronyms to their lazer glyphs', () => {
    expect(renderToStaticMarkup(<ModIconset mods={Mods.Cinema} />)).toContain(
      'mod-cinema.svg'
    );
    expect(renderToStaticMarkup(<ModIconset mods={Mods.Key7} />)).toContain(
      'mod-seven-keys.svg'
    );
  });

  it('draws nothing for no mods, and draws No Fail', () => {
    expect(renderToStaticMarkup(<ModIconset mods={Mods.None} />)).toBe('');

    const html = renderToStaticMarkup(
      <ModIconset mods={Mods.NoFail | Mods.DoubleTime} />
    );
    expect(html).toContain('mod-no-fail.svg');
    expect(html).toContain('mod-double-time.svg');
  });

  it('sets badges side by side, never overlapping', () => {
    const html = renderToStaticMarkup(
      <ModIconset mods={Mods.Hidden | Mods.HardRock} />
    );

    expect(html).not.toMatch(/-ml-|peer/);
  });

  it('draws Nightcore and Perfect without the mods they imply', () => {
    expect(
      getModBadgeAcronyms(
        Mods.DoubleTime | Mods.Nightcore | Mods.SuddenDeath | Mods.Perfect
      )
    ).toEqual(['NC', 'PF']);
    expect(getModBadgeAcronyms(Mods.DoubleTime | Mods.SuddenDeath)).toEqual([
      'SD',
      'DT',
    ]);
    expect(getModBadgeAcronyms(Mods.Hidden, true)).toEqual(['FM', 'HD']);
  });

  it('draws freemod as an acronym badge', () => {
    const html = renderToStaticMarkup(
      <ModIconset mods={Mods.Hidden} freemod />
    );

    expect(html).toContain('aria-label="Free Mods"');
    expect(html).toContain('background-color:hsl(125, 100%, 70%)');
    expect(html).toContain(
      'color:color-mix(in srgb-linear, black, hsl(125, 100%, 70%) 10%)'
    );
    expect(html).toContain('>FM</span>');
    expect(html).toContain('mod-hidden.svg');
  });

  it('skips mods that have no acronym', () => {
    const html = renderToStaticMarkup(
      <ModIconset mods={Mods.Hidden | Mods.Target} />
    );

    expect(html.match(BADGE)).toHaveLength(1);
  });
});

describe('FittingModIconset', () => {
  it('sends every badge from the server, in order, before it can measure', () => {
    const html = renderToStaticMarkup(
      <FittingModIconset mods={Mods.Hidden | Mods.HardRock | Mods.DoubleTime} />
    );

    expect(html.match(BADGE)).toHaveLength(3);
    expect(html.indexOf('Hidden')).toBeLessThan(html.indexOf('Hard Rock'));
    expect(html).not.toContain('more mods');
  });
});

describe('getModName', () => {
  it("names every badge the site draws with osu!'s official name", () => {
    const acronyms = singleBitMods.flatMap((mod) => getModBadgeAcronyms(mod));
    const unnamed = acronyms.filter(
      (acronym) => getModName(acronym) === acronym
    );

    expect(unnamed).toEqual([]);
    // Every word of a proper mod name starts with a capital, as osu! writes it.
    const notTitleCase = [...acronyms, 'FM', ...Object.keys(MOD_BADGES)]
      .map(getModName)
      .filter(
        (name) => !name.split(' ').every((word) => /^[A-Z0-9]/.test(word))
      );
    expect(notTitleCase).toEqual([]);
  });

  it("keeps osu!'s spelling for stored mods, keys and freemod", () => {
    expect(getModName('SO')).toBe('Spun Out');
    expect(getModName('HR')).toBe('Hard Rock');
    expect(getModName('7K')).toBe('Seven Keys');
    expect(getModName('CM')).toBe('Cinema');
    expect(getModName('V2')).toBe('Score V2');
    expect(getModName('FM')).toBe('Free Mods');
  });
});

describe('ModIconset with lazer mods', () => {
  it('draws lazer-only mods by name and writes a custom speed', () => {
    const html = renderToStaticMarkup(
      <ModIconset
        mods={Mods.DoubleTime}
        lazerMods={[
          { acronym: 'DT', settings: { speed_change: 1.2 } },
          { acronym: 'DA' },
        ]}
      />
    );

    expect(html).toContain('aria-label="Double Time 1.2x"');
    expect(html).toContain('aria-label="Difficulty Adjust"');
    expect(html).toContain('1.2x</span>');
  });

  it('names a custom speed in a fitting row', () => {
    const html = renderToStaticMarkup(
      <FittingModIconset
        mods={Mods.HalfTime}
        lazerMods={[{ acronym: 'DC', settings: { speed_change: 0.8 } }]}
      />
    );

    expect(html).toContain('aria-label="Daycore 0.8x"');
  });
});
