import { describe, expect, it } from 'bun:test';

import { Team } from '@otr/core/osu';

import { getMatchSides } from '@/components/stats/stats-data';

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
