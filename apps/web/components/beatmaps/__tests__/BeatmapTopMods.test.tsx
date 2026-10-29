import { Mods } from '@otr/core/osu';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import BeatmapTopMods from '@/components/beatmaps/BeatmapTopMods';
import { BEATMAP_MOD_OTHER_LABEL } from '@/lib/utils/mods';

type TopMods = Parameters<typeof BeatmapTopMods>[0]['mods'];

/**
 * What assistive tech reads for each list item: its text, skipping anything
 * under `aria-hidden`.
 */
function spokenItems(mods: TopMods): string[] {
  const items: string[] = [];
  let hiddenDepth = 0;

  new HTMLRewriter()
    .on('li', {
      element() {
        items.push('');
      },
    })
    .on('li [aria-hidden="true"]', {
      element(element) {
        hiddenDepth += 1;
        element.onEndTag(() => {
          hiddenDepth -= 1;
        });
      },
    })
    .on('li *', {
      text(chunk) {
        if (hiddenDepth === 0) items[items.length - 1] += chunk.text;
      },
    })
    .transform(renderToStaticMarkup(<BeatmapTopMods mods={mods} />));

  // The rewriter hands over text as written, entities and all.
  return items.map((item) =>
    item
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&')
  );
}

describe('BeatmapTopMods', () => {
  it('names each shown mod with its share as a whole percent', () => {
    expect(
      spokenItems([
        { mod: 'HD', mods: Mods.Hidden, percentage: 42.4 },
        { mod: 'DTEZ', mods: Mods.DoubleTime | Mods.Easy, percentage: 30.5 },
      ])
    ).toEqual(['Hidden 42%', 'Easy + Double Time 31%']);
  });

  it('names No Mod and "Other"', () => {
    expect(
      spokenItems([
        { mod: 'NM', mods: Mods.None, percentage: 55 },
        { mod: BEATMAP_MOD_OTHER_LABEL, mods: Mods.None, percentage: 45 },
      ])
    ).toEqual(['No Mod 55%', 'Other mods 45%']);
  });

  it("draws osu!'s No Mod badge, not NM text, for scores without mods", () => {
    const html = renderToStaticMarkup(
      <BeatmapTopMods
        mods={[{ mod: 'NM', mods: Mods.None, percentage: 100 }]}
      />
    );

    expect(html).toContain('aria-label="No Mod"');
    expect(html).toContain('/icons/mods/mod-no-mod.svg');
    expect(html).not.toContain('>NM<');
  });

  it('never rounds a share to 0% or 100% when it is neither', () => {
    expect(
      spokenItems([{ mod: 'HD', mods: Mods.Hidden, percentage: 0.4 }])
    ).toEqual(['Hidden <1%']);
    expect(
      spokenItems([{ mod: 'HD', mods: Mods.Hidden, percentage: 0.5 }])
    ).toEqual(['Hidden 1%']);
    expect(
      spokenItems([{ mod: 'HD', mods: Mods.Hidden, percentage: 99.6 }])
    ).toEqual(['Hidden >99%']);
    expect(
      spokenItems([{ mod: 'HD', mods: Mods.Hidden, percentage: 100 }])
    ).toEqual(['Hidden 100%']);
  });

  it('says when there is no mod data', () => {
    const html = renderToStaticMarkup(<BeatmapTopMods mods={[]} />);

    expect(spokenItems([])).toEqual([]);
    expect(html).toContain('No mod data');
  });
});
