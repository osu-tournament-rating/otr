import { describe, expect, test } from 'bun:test';

import { Mods } from '@otr/core/osu';

import { getTierFromRating, tierData } from '@/lib/utils/tierData';
import {
  TIER_BREAKDOWN_MAX_TIER_INDEX,
  TIER_RATING_BOUNDARIES,
  summarizeFreemodPicks,
  summarizePoolDisplayMods,
  summarizeRankRangeMods,
  tierBreakdownTierFromRating,
  tierNameFromRatingArithmetic,
  type FreemodPickRow,
  type PoolDisplayModsRow,
  type RankRangeModRow,
} from '../beatmapStatsHelpers';

const row = (
  gameId: number,
  gameMods: number,
  scoreMods: number,
  scoreCount: number
): FreemodPickRow => ({ gameId, gameMods, scoreMods, scoreCount });

describe('summarizeFreemodPicks', () => {
  test('returns an empty summary for no rows', () => {
    expect(summarizeFreemodPicks([])).toEqual({
      freemodGameCount: 0,
      freemodScoreCount: 0,
      distribution: [],
    });
  });

  test('excludes non-freemod games', () => {
    // Forced-mod game: every score matches the game's own mods.
    const summary = summarizeFreemodPicks([
      row(1, Mods.HardRock, Mods.HardRock, 8),
    ]);

    expect(summary.freemodGameCount).toBe(0);
    expect(summary.freemodScoreCount).toBe(0);
    expect(summary.distribution).toEqual([]);
  });

  test('excludes NoMod games whose scores all carry no mods', () => {
    const summary = summarizeFreemodPicks([row(1, Mods.None, Mods.None, 8)]);

    expect(summary.freemodGameCount).toBe(0);
    expect(summary.freemodScoreCount).toBe(0);
  });

  test('includes games carrying the FreeModAllowed flag', () => {
    const summary = summarizeFreemodPicks([
      row(1, Mods.FreeModAllowed, Mods.Hidden, 3),
      row(1, Mods.FreeModAllowed, Mods.HardRock, 5),
    ]);

    expect(summary.freemodGameCount).toBe(1);
    expect(summary.freemodScoreCount).toBe(8);
    expect(summary.distribution).toEqual([
      { mods: Mods.HardRock, scoreCount: 5, percentage: 62.5 },
      { mods: Mods.Hidden, scoreCount: 3, percentage: 37.5 },
    ]);
  });

  test('includes NoMod games whose per-score mods vary from the game mods', () => {
    const summary = summarizeFreemodPicks([
      row(1, Mods.None, Mods.None, 2),
      row(1, Mods.None, Mods.Hidden, 6),
    ]);

    expect(summary.freemodGameCount).toBe(1);
    expect(summary.freemodScoreCount).toBe(8);
    expect(summary.distribution).toEqual([
      { mods: Mods.Hidden, scoreCount: 6, percentage: 75 },
      { mods: Mods.None, scoreCount: 2, percentage: 25 },
    ]);
  });

  test('NoFail-only variation does not make a game freemod', () => {
    // deriveGameIsFreeMod masks NoFail before comparing to the game mods.
    const summary = summarizeFreemodPicks([row(1, Mods.None, Mods.NoFail, 4)]);

    expect(summary.freemodGameCount).toBe(0);
    expect(summary.freemodScoreCount).toBe(0);
  });

  test('aggregates picks across multiple freemod games with a stable order', () => {
    const summary = summarizeFreemodPicks([
      // Freemod game 1
      row(1, Mods.FreeModAllowed, Mods.Hidden, 2),
      row(1, Mods.FreeModAllowed, Mods.HardRock, 2),
      // Non-freemod game (excluded)
      row(2, Mods.DoubleTime, Mods.DoubleTime, 10),
      // Freemod game 2
      row(3, Mods.None, Mods.None, 1),
      row(3, Mods.None, Mods.HardRock, 2),
      row(3, Mods.None, Mods.Hidden, 1),
    ]);

    expect(summary.freemodGameCount).toBe(2);
    expect(summary.freemodScoreCount).toBe(8);
    expect(summary.distribution).toEqual([
      { mods: Mods.HardRock, scoreCount: 4, percentage: 50 },
      { mods: Mods.Hidden, scoreCount: 3, percentage: 37.5 },
      { mods: Mods.None, scoreCount: 1, percentage: 12.5 },
    ]);
    // Percentages account for every freemod score.
    expect(
      summary.distribution.reduce((total, entry) => total + entry.percentage, 0)
    ).toBeCloseTo(100);
  });
});

describe('summarizePoolDisplayMods', () => {
  const poolRow = (
    tournamentId: number,
    gameId: number,
    gameMods: number,
    scoreMods: number,
    scoreCount = 1
  ): PoolDisplayModsRow => ({
    tournamentId,
    gameId,
    gameMods,
    scoreMods,
    scoreCount,
  });

  test('returns no entry for an empty input, leaving the fallback in charge', () => {
    expect(summarizePoolDisplayMods([]).size).toBe(0);
  });

  test('resolves a pool whose games record no mods but whose players varied as freemod', () => {
    const resolved = summarizePoolDisplayMods([
      poolRow(1699, 1, Mods.None, Mods.Hidden | Mods.NoFail, 4),
      poolRow(1699, 1, Mods.None, Mods.HardRock | Mods.NoFail, 3),
      poolRow(1699, 2, Mods.None, Mods.Hidden | Mods.NoFail, 5),
      poolRow(1699, 2, Mods.None, Mods.None, 2),
    ]);

    expect(resolved.get(1699)).toEqual({ mods: Mods.None, freemod: true });
  });

  test('keeps a forced-mod pool on its game mods', () => {
    const resolved = summarizePoolDisplayMods([
      poolRow(2189, 1, Mods.HardRock, Mods.HardRock | Mods.NoFail, 6),
    ]);

    expect(resolved.get(2189)).toEqual({
      mods: Mods.HardRock,
      freemod: false,
    });
  });

  test('takes the majority game across a mixed pool', () => {
    const resolved = summarizePoolDisplayMods([
      // Two forced-HR games outvote the single freemod one.
      poolRow(42, 1, Mods.HardRock, Mods.HardRock, 4),
      poolRow(42, 2, Mods.HardRock, Mods.HardRock, 4),
      poolRow(42, 3, Mods.None, Mods.Hidden, 2),
      poolRow(42, 3, Mods.None, Mods.HardRock, 2),
    ]);

    expect(resolved.get(42)).toEqual({ mods: Mods.HardRock, freemod: false });
  });

  test('counts games that differ only by No Fail together', () => {
    const resolved = summarizePoolDisplayMods([
      // Three uniform Hidden games, two of them all No Fail, outvote two DT.
      poolRow(7, 1, Mods.None, Mods.Hidden | Mods.NoFail, 2),
      poolRow(7, 2, Mods.None, Mods.Hidden | Mods.NoFail, 2),
      poolRow(7, 3, Mods.None, Mods.Hidden, 2),
      poolRow(7, 4, Mods.DoubleTime, Mods.DoubleTime, 2),
      poolRow(7, 5, Mods.DoubleTime, Mods.DoubleTime, 2),
    ]);

    expect(resolved.get(7)).toEqual({ mods: Mods.Hidden, freemod: false });
  });
});

describe('summarizeRankRangeMods', () => {
  const row = (
    rankRangeLowerBound: number,
    mods: number,
    scoreCount: number
  ): RankRangeModRow => ({ rankRangeLowerBound, mods, scoreCount });

  test('returns nothing for no rows', () => {
    expect(summarizeRankRangeMods([])).toEqual([]);
  });

  test('buckets by rank range and computes percentages within the bucket', () => {
    const buckets = summarizeRankRangeMods([
      row(1, Mods.HardRock, 3),
      row(1, Mods.None, 1),
      row(5_000, Mods.None, 2),
    ]);

    expect(buckets).toEqual([
      {
        rankRange: 'open',
        scoreCount: 4,
        distribution: [
          { mods: Mods.HardRock, scoreCount: 3, percentage: 75 },
          { mods: Mods.None, scoreCount: 1, percentage: 25 },
        ],
      },
      {
        rankRange: '1kPlus',
        scoreCount: 2,
        distribution: [{ mods: Mods.None, scoreCount: 2, percentage: 100 }],
      },
    ]);
  });

  test('sums rows sharing a bucket even when bounds differ', () => {
    const buckets = summarizeRankRangeMods([
      row(1_000, Mods.Hidden, 2),
      row(9_999, Mods.Hidden, 3),
    ]);

    expect(buckets).toHaveLength(1);
    expect(buckets[0].rankRange).toBe('1kPlus');
    expect(buckets[0].scoreCount).toBe(5);
    expect(buckets[0].distribution).toEqual([
      { mods: Mods.Hidden, scoreCount: 5, percentage: 100 },
    ]);
  });

  test('emits buckets in display order and skips empty ones', () => {
    const buckets = summarizeRankRangeMods([
      row(100_000, Mods.None, 1),
      row(500, Mods.None, 1),
      row(1, Mods.None, 1),
    ]);

    expect(buckets.map((bucket) => bucket.rankRange)).toEqual([
      'open',
      'lt1k',
      '100kPlus',
    ]);
  });

  test('ties break on ascending mods', () => {
    const buckets = summarizeRankRangeMods([
      row(1, Mods.HardRock, 2),
      row(1, Mods.Hidden, 2),
      row(1, Mods.None, 2),
    ]);

    expect(buckets[0].distribution.map((entry) => entry.mods)).toEqual([
      Mods.None,
      Mods.Hidden,
      Mods.HardRock,
    ]);
  });

  test('skips malformed rank-range bounds', () => {
    expect(summarizeRankRangeMods([row(0, Mods.None, 4)])).toEqual([]);
  });
});

describe('TIER_RATING_BOUNDARIES', () => {
  test('is every tierData baseRating above Bronze, ascending', () => {
    expect([...TIER_RATING_BOUNDARIES]).toEqual([
      400, 700, 1000, 1300, 1600, 1900, 2200, 2500,
    ]);
    expect(TIER_RATING_BOUNDARIES).toHaveLength(tierData.length - 1);
  });
});

// Parity with the tier breakdown query's width_bucket arithmetic
describe('tierNameFromRatingArithmetic', () => {
  const ratings = [
    0, 99, 100, 399, 400, 699, 700, 999, 1000, 1299, 1300, 1599, 1600, 1899,
    1900, 2199, 2200, 2499, 2500, 3200,
  ];

  test.each(ratings)('matches getTierFromRating at %p', (rating) => {
    expect(tierNameFromRatingArithmetic(rating)).toBe(
      getTierFromRating(rating).tier
    );
  });

  test('every boundary promotes exactly at its threshold', () => {
    for (const bound of TIER_RATING_BOUNDARIES) {
      expect(tierNameFromRatingArithmetic(bound)).toBe(
        getTierFromRating(bound).tier
      );
      expect(tierNameFromRatingArithmetic(bound - 1)).toBe(
        getTierFromRating(bound - 1).tier
      );
    }
  });
});

// Parity with LEAST(width_bucket(...), TIER_BREAKDOWN_MAX_TIER_INDEX) in the SQL
describe('tierBreakdownTierFromRating', () => {
  test('clamps at Grandmaster', () => {
    expect(TIER_BREAKDOWN_MAX_TIER_INDEX).toBe(tierData.length - 2);
    expect(tierBreakdownTierFromRating(2500)).toBe('Grandmaster');
    expect(tierBreakdownTierFromRating(9000)).toBe('Grandmaster');
  });

  test('matches the unclamped tier below Elite Grandmaster', () => {
    for (const rating of [0, 99, 100, 399, 400, 1899, 1900, 2200, 2499]) {
      expect(tierBreakdownTierFromRating(rating)).toBe(
        tierNameFromRatingArithmetic(rating)
      );
    }
  });
});
