import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Mods } from '@otr/core/osu';

import ModIconset from '@/components/icons/ModIconset';
import { ModsEnumHelper } from '@/lib/enum-helpers';
import { MOD_BADGES } from '@/lib/utils/mod-badges';

const iconDir = join(import.meta.dir, '../../../public/icons/mods');

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
      .filter((mod) => mod !== Mods.NoFail)
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

  it('draws No Mod with its glyph and clears No Fail', () => {
    for (const mods of [Mods.None, Mods.NoFail]) {
      const html = renderToStaticMarkup(<ModIconset mods={mods} />);

      expect(html).toContain('mod-no-mod.svg');
      expect(html).toContain('background-color:#ffcc22');
      expect(html).not.toContain('mod-no-fail.svg');
    }
  });

  it('draws freemod as an acronym badge', () => {
    const html = renderToStaticMarkup(
      <ModIconset mods={Mods.Hidden} freemod />
    );

    expect(html).toContain('aria-label="Freemod"');
    expect(html).toContain('>FM</span>');
    expect(html).toContain('mod-hidden.svg');
    expect(html).not.toContain('mod-no-mod.svg');
  });

  it('skips mods that have no acronym', () => {
    const html = renderToStaticMarkup(
      <ModIconset mods={Mods.Hidden | Mods.Target} />
    );

    expect(html.match(/role="img"/g)).toHaveLength(1);
  });
});
