import { Ruleset } from '@otr/core/osu';
import { describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PlayerSearchResult } from '@/lib/orpc/schema/search';

// Bun loads SVG imports as file paths, which React cannot render.
mock.module('@/components/icons/RulesetIcon', () => ({
  default: ({ ruleset }: { ruleset: number }) => <svg data-ruleset={ruleset} />,
}));

const { PlayerResultContent } = await import('../PlayerResultContent');

const rated: PlayerSearchResult = {
  id: 1,
  osuId: 10,
  username: 'Rated',
  rating: 1500,
  ruleset: Ruleset.Taiko,
  globalRank: 42,
  tierProgress: {
    currentTier: 'Gold',
    currentSubTier: 2,
    nextTier: 'Gold',
    nextSubTier: 1,
    ratingForNextTier: 1550,
    ratingForNextMajorTier: 1800,
    nextMajorTier: 'Platinum',
    subTierFillPercentage: 0.5,
    majorTierFillPercentage: 0.5,
  },
};

const render = (data: PlayerSearchResult) =>
  renderToStaticMarkup(<PlayerResultContent data={data} query="" />);

describe('PlayerResultContent', () => {
  it('names the ruleset of a rated player', () => {
    const html = render(rated);

    expect(html).toContain(`data-ruleset="${Ruleset.Taiko}"`);
    expect(html).toContain('>taiko</span>');
  });

  it('hides the ruleset of a player with no rating', () => {
    const html = render({
      ...rated,
      username: 'Unrated',
      rating: null,
      ruleset: Ruleset.Osu,
      globalRank: null,
      tierProgress: null,
    });

    expect(html).toContain('Unrated');
    expect(html).not.toContain('data-ruleset');
    expect(html).not.toContain('osu!');
  });
});
