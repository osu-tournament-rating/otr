import { describe, expect, it } from 'bun:test';

import { selectTopPerformers } from '@/components/tournaments/TournamentTopPerformers';
import type { TournamentPlayerStats } from '@/lib/orpc/schema/tournament';

const player = (
  id: number,
  averageMatchCost: number,
  matchesPlayed: number
): TournamentPlayerStats =>
  ({
    player: { id, osuId: id, username: `player-${id}` },
    averageMatchCost,
    matchesPlayed,
  }) as TournamentPlayerStats;

describe('selectTopPerformers', () => {
  // Weighted match cost = average × (0.9 + 0.1 × min(matches, 6)), from #922.
  it('weights each average by the matches played, up to six', () => {
    const top = selectTopPerformers([
      player(1, 1.2, 3), // 1.2 × 1.2 = 1.44
      player(2, 1.2, 6), // 1.2 × 1.5 = 1.8
      player(3, 1.2, 7), // 1.2 × 1.5 = 1.8, no more than six matches give
    ]);

    expect(
      top.map(({ stats, matchCost }) => [stats.player.id, matchCost])
    ).toEqual([
      [2, expect.closeTo(1.8, 10)],
      [3, expect.closeTo(1.8, 10)],
      [1, expect.closeTo(1.44, 10)],
    ]);
  });

  it('ranks a run through the bracket above one strong match', () => {
    // 1.5 × 1.2 = 1.8 over three matches; 1.3 × 1.5 = 1.95 over eight.
    const top = selectTopPerformers([player(1, 1.5, 3), player(2, 1.3, 8)]);

    expect(top.map(({ stats }) => stats.player.id)).toEqual([2, 1]);
  });
});
