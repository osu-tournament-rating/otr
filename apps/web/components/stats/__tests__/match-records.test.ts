import { describe, expect, it } from 'bun:test';

import { Team } from '@otr/core/osu';

import { getMatchSides, getRatingGapBars } from '@/components/stats/stats-data';

describe('getMatchSides', () => {
  // osu! names a match `(red) vs (blue)`.
  it.each([
    [Team.Red, { winner: 'Japan', loser: 'Korea' }],
    [Team.Blue, { winner: 'Korea', loser: 'Japan' }],
  ])('puts the winning side first when team %i won', (winnerTeam, sides) => {
    expect(
      getMatchSides({ matchName: 'OWC: (Japan) vs (Korea)', winnerTeam })
    ).toEqual(sides);
  });

  it('is null for a name it cannot split', () => {
    expect(
      getMatchSides({
        matchName: 'ICC2025: Simps vs. Cucardas',
        winnerTeam: Team.Red,
      })
    ).toBeNull();
  });
});

describe('getRatingGapBars', () => {
  it('labels each bucket by its range, the last open-ended, out of its matches', () => {
    expect(
      getRatingGapBars([
        { minGap: 0, matches: 40, higherRatedWins: 22 },
        { minGap: 100, matches: 30, higherRatedWins: 21 },
        { minGap: 1000, matches: 5, higherRatedWins: 5 },
      ])
    ).toEqual([
      { key: '0', label: '0–100', values: { higherRated: 22 }, total: 40 },
      {
        key: '100',
        label: '100–1,000',
        values: { higherRated: 21 },
        total: 30,
      },
      { key: '1000', label: '1,000+', values: { higherRated: 5 }, total: 5 },
    ]);
  });
});
