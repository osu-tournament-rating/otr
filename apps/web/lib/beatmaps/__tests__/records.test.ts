import { describe, expect, test } from 'bun:test';

import type {
  BeatmapTournamentUsage,
  BeatmapUsagePoint,
} from '@/lib/orpc/schema/beatmapStats';
import { VerificationStatus } from '@otr/core/osu';
import {
  formatQuarterLong,
  getMostUsedInPool,
  getPoolPickRate,
  summarizeActivity,
} from '../records';

function pool(
  overrides: Omit<Partial<BeatmapTournamentUsage>, 'tournament'> & {
    tournament?: Partial<BeatmapTournamentUsage['tournament']>;
  } = {}
): BeatmapTournamentUsage {
  const { tournament, ...rest } = overrides;

  return {
    tournament: {
      id: 1,
      name: 'Test Cup',
      ...tournament,
    },
    gameCount: 0,
    scoreCount: 0,
    rankRangeLowerBound: 1,
    lobbySize: 2,
    startTime: null,
    endTime: null,
    verificationStatus: VerificationStatus.Verified,
    rejectionReason: 0,
    verifiedByUsername: null,
    pendingRating: false,
    mostCommonMods: null,
    mostCommonModsFreemod: false,
    ...rest,
  };
}

function usage(
  quarter: string,
  gameCount: number,
  pooledCount = 0
): BeatmapUsagePoint {
  return { quarter, gameCount, pooledCount };
}

describe('formatQuarterLong', () => {
  test('renders a usage bucket as a readable quarter', () => {
    expect(formatQuarterLong('2023-Q3')).toBe('Q3 2023');
  });

  test('passes through anything that is not a quarter bucket', () => {
    expect(formatQuarterLong('unknown')).toBe('unknown');
  });
});

describe('summarizeActivity', () => {
  test('spans the first and last quarter with any activity', () => {
    const summary = summarizeActivity([
      usage('2020-Q1', 0),
      usage('2020-Q2', 4),
      usage('2020-Q3', 0),
      usage('2020-Q4', 0, 2),
      usage('2021-Q1', 0),
    ]);

    expect(summary.firstActive?.quarter).toBe('2020-Q2');
    expect(summary.lastActive?.quarter).toBe('2020-Q4');
    expect(summary.activeQuarters).toBe(2);
  });

  test('scales to the game series only, since only games render as bars', () => {
    expect(summarizeActivity([usage('2020-Q1', 3, 9)]).maxGames).toBe(3);
    expect(
      summarizeActivity([usage('2020-Q1', 3, 9), usage('2020-Q2', 7)]).maxGames
    ).toBe(7);
  });

  test('reports no span when nothing was ever played or pooled', () => {
    const summary = summarizeActivity([
      usage('2020-Q1', 0),
      usage('2020-Q2', 0),
    ]);

    expect(summary.firstActive).toBeNull();
    expect(summary.lastActive).toBeNull();
    expect(summary.activeQuarters).toBe(0);
    expect(summary.maxGames).toBe(0);
  });
});

describe('getMostUsedInPool', () => {
  test('picks the tournament with the most scores, not the most games', () => {
    const manyGames = pool({
      tournament: { id: 1 },
      gameCount: 30,
      scoreCount: 60,
    });
    const manyScores = pool({
      tournament: { id: 2 },
      gameCount: 12,
      scoreCount: 120,
    });

    expect(getMostUsedInPool([manyGames, manyScores])?.tournament.id).toBe(2);
  });

  test('ignores pool records that produced no scores', () => {
    expect(
      getMostUsedInPool([pool(), pool({ tournament: { id: 2 } })])
    ).toBeNull();
  });

  test('returns nothing when the beatmap has never been pooled', () => {
    expect(getMostUsedInPool([])).toBeNull();
  });
});

describe('getPoolPickRate', () => {
  test('reports the share of pool records that saw play', () => {
    expect(getPoolPickRate(13, 21)).toBe(62);
    expect(getPoolPickRate(3, 4)).toBe(75);
  });

  test('has no rate when the beatmap was never pooled', () => {
    expect(getPoolPickRate(0, 0)).toBeNull();
  });

  test('reports the extremes exactly', () => {
    expect(getPoolPickRate(0, 12)).toBe(0);
    expect(getPoolPickRate(12, 12)).toBe(100);
  });

  test('never rounds a single pick down to never played', () => {
    expect(getPoolPickRate(1, 400)).toBe(1);
  });

  test('never rounds a single skip up to always played', () => {
    expect(getPoolPickRate(399, 400)).toBe(99);
  });
});
