import { Mods } from '@otr/core/osu';

import {
  RANK_RANGE_BUCKETS,
  getRankRangeBucketKey,
  type RankRangeBucketKey,
} from '@/lib/beatmaps/rankRange';
import { deriveGameIsFreeMod, resolveGameDisplayMods } from '@/lib/utils/mods';
import { tierData, tierNames, type TierName } from '@/lib/utils/tierData';
import type {
  BeatmapFreemodPickSummary,
  BeatmapRankRangeModDistribution,
} from '@/lib/orpc/schema/beatmapStats';

/** Incidental score-level modifiers stripped by the beatmap mod display rules. */
export const STRIPPED_SCORE_MODS_MASK = Mods.NoFail | Mods.SpunOut;

/** Arithmetic mirror of normalizeBeatmapDisplayMods and of NORMALIZED_SCORE_MODS_SQL. */
export function normalizeScoreModsArithmetic(mods: number): number {
  if ((mods & Mods.Nightcore) !== 0) {
    return (
      (mods & ~(Mods.Nightcore | STRIPPED_SCORE_MODS_MASK)) | Mods.DoubleTime
    );
  }

  return mods & ~STRIPPED_SCORE_MODS_MASK;
}

/** The only mods the page's score aggregates chart; the rest are too rare in pools. */
export const CHARTED_SCORE_MODS_MASK =
  Mods.NoFail | Mods.Hidden | Mods.HardRock | Mods.DoubleTime | Mods.Nightcore;

/** Whether a raw score bitmask belongs in the charted aggregates. */
export function isChartedScoreMods(mods: number): boolean {
  return (mods & ~CHARTED_SCORE_MODS_MASK) === 0;
}

export interface FreemodPickRow {
  gameId: number;
  /** Forced mods recorded on the game itself. */
  gameMods: number;
  /** One distinct per-player mod combination inside the game. */
  scoreMods: number;
  /** Verified scores in the game using that combination. */
  scoreCount: number;
}

/** Collapses per-game score-mod rows into the freemod pick summary; mods stay raw. */
export function summarizeFreemodPicks(
  rows: FreemodPickRow[]
): BeatmapFreemodPickSummary {
  const rowsByGame = new Map<number, FreemodPickRow[]>();
  for (const row of rows) {
    const gameRows = rowsByGame.get(row.gameId) ?? [];
    gameRows.push(row);
    rowsByGame.set(row.gameId, gameRows);
  }

  let freemodGameCount = 0;
  let freemodScoreCount = 0;
  const countsByMods = new Map<number, number>();

  for (const gameRows of rowsByGame.values()) {
    const gameMods = gameRows[0].gameMods;
    const scores = gameRows.map((row) => ({ mods: row.scoreMods }));

    if (!deriveGameIsFreeMod(gameMods, scores)) continue;

    freemodGameCount += 1;
    for (const row of gameRows) {
      freemodScoreCount += row.scoreCount;
      countsByMods.set(
        row.scoreMods,
        (countsByMods.get(row.scoreMods) ?? 0) + row.scoreCount
      );
    }
  }

  const distribution = Array.from(countsByMods, ([mods, scoreCount]) => ({
    mods,
    scoreCount,
    percentage:
      freemodScoreCount > 0 ? (scoreCount / freemodScoreCount) * 100 : 0,
  })).sort(
    (left, right) =>
      right.scoreCount - left.scoreCount || left.mods - right.mods
  );

  return { freemodGameCount, freemodScoreCount, distribution };
}

export interface PoolDisplayModsRow extends FreemodPickRow {
  /** Tournament whose pool the game belongs to. */
  tournamentId: number;
}

/**
 * Modal display mods per tournament pool slot, resolved from the mods players used
 * so freemod lobbies don't report NM. Tournaments with no rows are absent.
 */
export function summarizePoolDisplayMods(
  rows: ReadonlyArray<PoolDisplayModsRow>
): Map<number, { mods: number; freemod: boolean }> {
  const rowsByGame = new Map<number, PoolDisplayModsRow[]>();
  for (const row of rows) {
    const gameRows = rowsByGame.get(row.gameId) ?? [];
    gameRows.push(row);
    rowsByGame.set(row.gameId, gameRows);
  }

  const talliesByTournament = new Map<
    number,
    Map<string, { mods: number; freemod: boolean; gameCount: number }>
  >();

  for (const gameRows of rowsByGame.values()) {
    const { tournamentId, gameMods } = gameRows[0];
    const scores = gameRows.map((row) => ({ mods: row.scoreMods }));
    const resolved = resolveGameDisplayMods(
      { isFreeMod: deriveGameIsFreeMod(gameMods, scores), mods: gameMods },
      scores
    );

    // Pools never show No Fail or a freemod game's forced mods, so neither
    // splits the tally.
    const mods = resolved.freemod ? Mods.None : resolved.mods & ~Mods.NoFail;
    const tally = talliesByTournament.get(tournamentId) ?? new Map();
    const key = resolved.freemod ? 'fm' : String(mods);
    const entry = tally.get(key);

    if (entry) {
      entry.gameCount += 1;
    } else {
      tally.set(key, {
        mods,
        freemod: resolved.freemod,
        gameCount: 1,
      });
    }

    talliesByTournament.set(tournamentId, tally);
  }

  const displayMods = new Map<number, { mods: number; freemod: boolean }>();

  for (const [tournamentId, tally] of talliesByTournament) {
    let best: { mods: number; freemod: boolean; gameCount: number } | null =
      null;

    for (const entry of tally.values()) {
      if (best == null || entry.gameCount > best.gameCount) best = entry;
    }

    if (best) {
      displayMods.set(tournamentId, { mods: best.mods, freemod: best.freemod });
    }
  }

  return displayMods;
}

export interface RankRangeModRow {
  /** Raw `tournaments.rankRangeLowerBound` of the score's tournament. */
  rankRangeLowerBound: number;
  /** Normalized display mods (NF/SO stripped, NC folded into DT). */
  mods: number;
  /** Verified scores with that bound and mod combination. */
  scoreCount: number;
}

/** Folds per-(rank range, normalized mods) counts into one distribution per bucket. */
export function summarizeRankRangeMods(
  rows: ReadonlyArray<RankRangeModRow>
): BeatmapRankRangeModDistribution[] {
  const countsByBucket = new Map<RankRangeBucketKey, Map<number, number>>();

  for (const row of rows) {
    const key = getRankRangeBucketKey(row.rankRangeLowerBound);
    if (key == null) continue;

    const byMods = countsByBucket.get(key) ?? new Map<number, number>();
    byMods.set(row.mods, (byMods.get(row.mods) ?? 0) + row.scoreCount);
    countsByBucket.set(key, byMods);
  }

  const buckets: BeatmapRankRangeModDistribution[] = [];

  for (const definition of RANK_RANGE_BUCKETS) {
    const byMods = countsByBucket.get(definition.key);
    if (!byMods) continue;

    const scoreCount = Array.from(byMods.values()).reduce(
      (total, count) => total + count,
      0
    );
    if (scoreCount <= 0) continue;

    buckets.push({
      rankRange: definition.key,
      scoreCount,
      distribution: Array.from(byMods, ([mods, count]) => ({
        mods,
        scoreCount: count,
        percentage: (count / scoreCount) * 100,
      })).sort(
        (left, right) =>
          right.scoreCount - left.scoreCount || left.mods - right.mods
      ),
    });
  }

  return buckets;
}

/** Ascending tier boundaries above Bronze, indexing into tierNames via width_bucket. */
export const TIER_RATING_BOUNDARIES: readonly number[] = tierData
  .slice(1)
  .map((tier) => tier.baseRating);

/** Arithmetic mirror of the tier breakdown query's width_bucket expression. */
export function tierNameFromRatingArithmetic(rating: number): TierName {
  let index = 0;
  for (const bound of TIER_RATING_BOUNDARIES) {
    if (rating >= bound) index += 1;
  }

  return tierNames[index];
}

/** Highest tier index the breakdown reports; Elite Grandmaster folds into Grandmaster+. */
export const TIER_BREAKDOWN_MAX_TIER_INDEX = tierNames.indexOf('Grandmaster');

/** Tier a rating lands in for the breakdown, with the Elite Grandmaster fold applied. */
export function tierBreakdownTierFromRating(rating: number): TierName {
  let index = 0;
  for (const bound of TIER_RATING_BOUNDARIES) {
    if (rating >= bound) index += 1;
  }

  return tierNames[Math.min(index, TIER_BREAKDOWN_MAX_TIER_INDEX)];
}
