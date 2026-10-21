import { z } from 'zod';

import { RANK_RANGE_BUCKET_KEYS } from '@/lib/beatmaps/rankRange';
import { tierNames } from '@/lib/utils/tierData';

import { beatmapSelectSchema, beatmapsetSelectSchema } from './base';
import { beatmapPublicColumns, beatmapsetPublicColumns } from './beatmap';
import {
  RulesetSchema,
  ScoreGradeSchema,
  VerificationStatusSchema,
} from './constants';
import { LazerModSchema } from './common';
import { PlayerCompactSchema } from './playerStats';

/** Tournament rank-range bracket, keyed by `lib/beatmaps/rankRange`. */
export const RankRangeBucketKeySchema = z.enum(RANK_RANGE_BUCKET_KEYS);

/** Rating tier name, keyed by `lib/utils/tierData`. */
export const TierNameSchema = z.enum(tierNames);

export const BeatmapTournamentUsageSchema = z.object({
  tournament: z.object({
    id: z.number().int().positive(),
    name: z.string(),
  }),
  gameCount: z.number().int().nonnegative(),
  /** Verified scores set on this beatmap within the tournament. */
  scoreCount: z.number().int().nonnegative(),
  rankRangeLowerBound: z.number().int().positive(),
  /** Players per team; renders as `${n}v${n}`. */
  lobbySize: z.number().int().positive(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  verificationStatus: VerificationStatusSchema,
  /** `TournamentRejectionReason` bitfield; 0 when the tournament is not rejected. */
  rejectionReason: z.number().int().nonnegative(),
  /** Raw mods bitmask of the most common game, null exactly when gameCount is 0. */
  mostCommonMods: z.number().int().nonnegative().nullable(),
  /** True when per-player mods varied in that game, so the row renders FM. */
  mostCommonModsFreemod: z.boolean(),
});

export const BeatmapUsagePointSchema = z.object({
  quarter: z.string(),
  gameCount: z.number().int().nonnegative(),
  pooledCount: z.number().int().nonnegative(),
});

export const BeatmapModDistributionSchema = z.object({
  mods: z.number().int().nonnegative(),
  scoreCount: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
});

export const BeatmapTopPerformerSchema = z.object({
  player: PlayerCompactSchema,
  score: z.number().int().nonnegative(),
  grade: ScoreGradeSchema.optional(),
  accuracy: z.number().min(0).max(1).nullable(),
  mods: z.number().int().nonnegative(),
  /** Every mod of a lazer score with its settings; null for stable scores. */
  lazerMods: z.array(LazerModSchema).nullable(),
  playedAt: z.string().nullable(),
  matchId: z.number().int().positive(),
  gameId: z.number().int().positive(),
  scoreId: z.number().int().positive(),
  /** Tournament the score was set in. */
  tournament: z.object({
    id: z.number().int().positive(),
    name: z.string(),
  }),
});

export const BeatmapStatsSummarySchema = z.object({
  /** Fully verified games. The population every statistic on the page uses. */
  totalGameCount: z.number().int().nonnegative(),
  /** Tournaments that pooled this beatmap, verified or not. */
  totalTournamentCount: z.number().int().nonnegative(),
  /** Subset of `totalTournamentCount` whose tournament is verified. */
  verifiedTournamentCount: z.number().int().nonnegative(),
  /** Usage credit, not a statistical population: verified games plus every game in an unverified tournament. */
  totalPlayedGameCount: z.number().int().nonnegative(),
  /** Pool records where the beatmap was played at least once; pairs with `totalTournamentCount` as a pick rate. */
  pooledPlayedTournamentCount: z.number().int().nonnegative(),
});

const BeatmapsetForStatsSchema = beatmapsetSelectSchema
  .pick(beatmapsetPublicColumns)
  .extend({
    creator: PlayerCompactSchema.nullable(),
  });

const BeatmapForStatsSchema = beatmapSelectSchema
  .pick(beatmapPublicColumns)
  .extend({
    ruleset: RulesetSchema,
    beatmapset: BeatmapsetForStatsSchema.nullable(),
  });

export const BeatmapWithDetailsSchema = BeatmapForStatsSchema.extend({
  creators: z.array(PlayerCompactSchema),
  /** Resolved from `setOwnerIdOverride`; takes the beatmapset creator's place. */
  setOwnerOverride: PlayerCompactSchema.nullable(),
});

export const RelatedBeatmapDifficultySchema = z.object({
  osuId: z.number().int().positive(),
  diffName: z.string(),
  ruleset: RulesetSchema,
  sr: z.number().nonnegative(),
  /** Every pool the difficulty appears in, verified or not. */
  pooledTournamentCount: z.number().int().nonnegative(),
  verifiedGameCount: z.number().int().nonnegative(),
});

/** Five-number summary of charted-mod scores for one normalized mod combination, plus `p20Score`. */
export const BeatmapModScoreDistributionSchema = z.object({
  /** Normalized display mods bitmask (NF/SO stripped, NC folded into DT). */
  mods: z.number().int().nonnegative(),
  scoreCount: z.number().int().positive(),
  minScore: z.number().int().nonnegative(),
  p20Score: z.number().int().nonnegative(),
  p25Score: z.number().int().nonnegative(),
  medianScore: z.number().int().nonnegative(),
  p75Score: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
});

/** One point of the charted-mod CDF: `score` beats `percentile`% of plays. */
export const BeatmapScorePercentilePointSchema = z.object({
  percentile: z.number().min(0).max(100),
  score: z.number().int().nonnegative(),
});

export const BeatmapScoreSamplePointSchema = z.object({
  score: z.number().int().nonnegative(),
  /** Pre-match rating (rating_adjustments.rating_before); null is expected on recent data. */
  rating: z.number().nullable(),
  /** Raw score mods bitmask (client normalizes for color/label). */
  mods: z.number().int().nonnegative(),
  /** Rank-range bucket of the tournament the score's match belongs to. */
  rankRange: RankRangeBucketKeySchema,
});

export const BeatmapScoreSampleSchema = z.object({
  /** Total verified scores the sample was drawn from. */
  totalScoreCount: z.number().int().nonnegative(),
  /** Deterministic sample, capped at 1000, ordered by score id ascending. */
  points: z.array(BeatmapScoreSamplePointSchema),
});

export const BeatmapMissBucketSchema = z.object({
  /** 0..5; 5 means "5 or more". */
  misses: z.number().int().min(0).max(5),
  scoreCount: z.number().int().nonnegative(),
});

export const BeatmapGradeCountSchema = z.object({
  grade: ScoreGradeSchema,
  scoreCount: z.number().int().nonnegative(),
});

export const BeatmapPerformanceSummarySchema = z.object({
  scoreCount: z.number().int().nonnegative(),
  /** Scores with a non-null stat_miss (denominator for missDistribution). */
  missDataScoreCount: z.number().int().nonnegative(),
  missDistribution: z.array(BeatmapMissBucketSchema),
  gradeDistribution: z.array(BeatmapGradeCountSchema),
});

export const BeatmapFreemodPickSummarySchema = z.object({
  /** Verified games on this map detected as freemod. */
  freemodGameCount: z.number().int().nonnegative(),
  /** Verified scores inside those games. */
  freemodScoreCount: z.number().int().nonnegative(),
  /** Reuses the existing mod-distribution row shape (raw score mods). */
  distribution: z.array(BeatmapModDistributionSchema),
});

/** Verified-score mod split within one tournament rank-range bucket. */
export const BeatmapRankRangeModDistributionSchema = z.object({
  rankRange: RankRangeBucketKeySchema,
  /** Verified scores in this bucket (denominator for the rows' percentages). */
  scoreCount: z.number().int().positive(),
  /** Normalized display-mod rows (NF/SO stripped, NC→DT), desc by scoreCount. */
  distribution: z.array(BeatmapModDistributionSchema),
});

/**
 * Score/accuracy summary for charted-mod scores whose player sat in this tier
 * at time of play (pre-match rating, `rating_adjustments.rating_before`).
 */
export const BeatmapTierScoreSummarySchema = z.object({
  /** Elite Grandmaster is folded into Grandmaster and renders as "Grandmaster+". */
  tier: TierNameSchema,
  scoreCount: z.number().int().positive(),
  minScore: z.number().int().nonnegative(),
  p20Score: z.number().int().nonnegative(),
  p25Score: z.number().int().nonnegative(),
  medianScore: z.number().int().nonnegative(),
  p75Score: z.number().int().nonnegative(),
  maxScore: z.number().int().nonnegative(),
  /** Raw stored fractions (0–1) from `gameScores.accuracy`; all six are null together. */
  minAccuracy: z.number().min(0).max(1).nullable(),
  p20Accuracy: z.number().min(0).max(1).nullable(),
  p25Accuracy: z.number().min(0).max(1).nullable(),
  medianAccuracy: z.number().min(0).max(1).nullable(),
  p75Accuracy: z.number().min(0).max(1).nullable(),
  maxAccuracy: z.number().min(0).max(1).nullable(),
});

export const BeatmapTierBreakdownSchema = z.object({
  /** Charted-mod scores with a pre-match rating (rating_adjustments.rating_before). */
  ratedScoreCount: z.number().int().nonnegative(),
  /** All charted-mod scores, for the "X of Y rated" caption. */
  totalScoreCount: z.number().int().nonnegative(),
  /** Ascending by tier (Bronze → Grandmaster+); only tiers with at least five scores. */
  tiers: z.array(BeatmapTierScoreSummarySchema),
});

/**
 * Cohort-standardized closeness of this beatmap's Team Vs games: each game's
 * `logRatio = ln(winning score / losing score)` standardized against the
 * `(ruleset, team size)` baseline in `lib/beatmaps/closeness-baselines`.
 */
export const BeatmapClosenessSummarySchema = z.object({
  gameCount: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Fully verified TeamVs games on this beatmap with exactly two equal-sized rosters and a non-zero losing score. The population behind every other field here.'
    ),
  excludedUnverifiedGameCount: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'TeamVs games on this beatmap with scores from exactly two teams that are not verified at every level (tournament, match and game). A history figure only: it explains why gameCount can be small, and is never an input to any statistic in this object.'
    ),
  cohort: z
    .object({
      ruleset: RulesetSchema.describe(
        "The dominant cohort's games.ruleset, which can disagree with beatmap.ruleset — mania maps stored as ManiaOther are routinely played as 4K."
      ),
      teamSize: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe('Players per team, capped at 5; a 6v6 game reports 5.'),
      baselineScope: z
        .enum(['cohort', 'ruleset', 'global'])
        .describe(
          'Which population the baseline was fitted over. Cohorts with too few corpus games have no row of their own and fall back to their ruleset, then to the whole corpus.'
        ),
      meanLogRatio: z
        .number()
        .describe('Baseline mean of ln(winning score / losing score).'),
      sdLogRatio: z
        .number()
        .positive()
        .describe(
          'Baseline sample SD of ln(winning score / losing score). Read a standardized value back as a native winning-margin percent with `(1 - exp(-(z * sdLogRatio + meanLogRatio))) * 100`.'
        ),
    })
    .nullable()
    .describe(
      "The map's dominant (most-played) cohort and the baseline row that resolved for it. Ties break to the lowest ruleset, then the lowest team size. Null only when gameCount is 0."
    ),
  reliability: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe(
      "`gameCount / (gameCount + k)`, the weight the map's own games carry against the cohort mean; `k` is the fitted shrinkage constant of the cohorts played. Null only when gameCount is 0."
    ),
  percentile: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .describe(
      'Share of comparable maps whose typical score gap is smaller, 0-100: higher means more one-sided. Null unless gameCount is at least 10 and reliability is at least 0.5, below which the estimate is noise.'
    ),
  percentileInterval: z
    .tuple([z.number().min(0).max(100), z.number().min(0).max(100)])
    .nullable()
    .describe(
      'Ascending 80% interval around percentile, on the same 0-100 scale. Null under the same gate as percentile.'
    ),
  bins: z
    .array(z.number().int().nonnegative())
    .describe(
      "Counts of this map's games between baselineZDeciles, ten entries: a map that plays exactly like its cohort reads as ten equal bars. Empty below 10 games."
    ),
  baselineZDeciles: z
    .array(z.number())
    .length(9)
    .nullable()
    .describe(
      "The dominant cohort's q10..q90 standardized cut points, ascending. Non-null whenever gameCount is at least 1."
    ),
  games: z
    .array(
      z.object({
        logRatio: z
          .number()
          .nonnegative()
          .describe('ln(winning score / losing score) for this game.'),
        z: z
          .number()
          .describe(
            "logRatio standardized against this game's own cohort baseline, not the dominant one."
          ),
        ruleset: RulesetSchema.describe('games.ruleset for this game.'),
        teamSize: z
          .number()
          .int()
          .min(1)
          .max(5)
          .describe('Players per team, capped at 5.'),
      })
    )
    .describe(
      'One row per qualifying game, so sparse maps can plot their games individually. Unordered.'
    ),
});

export const BeatmapStatsResponseSchema = z.object({
  beatmap: BeatmapWithDetailsSchema,
  relatedDifficulties: z.array(RelatedBeatmapDifficultySchema),
  summary: BeatmapStatsSummarySchema,
  usageOverTime: z.array(BeatmapUsagePointSchema),
  /** Every tournament that pooled this beatmap, verified or not, most-played first. */
  tournaments: z.array(BeatmapTournamentUsageSchema),
  modDistribution: z.array(BeatmapModDistributionSchema),
  topPerformers: z.array(BeatmapTopPerformerSchema),
  scoreDistribution: z.array(BeatmapModScoreDistributionSchema),
  scorePercentiles: z.array(BeatmapScorePercentilePointSchema),
  /** Verified NM/HD/HR/DT scores only; every other aggregate here counts all verified scores. */
  chartedScoreCount: z.number().int().nonnegative(),
  scoreSample: BeatmapScoreSampleSchema,
  performance: BeatmapPerformanceSummarySchema,
  freemodPicks: BeatmapFreemodPickSummarySchema,
  /** Bucket display order; buckets with no verified scores are omitted. */
  rankRangeModDistribution: z.array(BeatmapRankRangeModDistributionSchema),
  tierBreakdown: BeatmapTierBreakdownSchema,
  closeness: BeatmapClosenessSummarySchema,
});

export type BeatmapTournamentUsage = z.infer<
  typeof BeatmapTournamentUsageSchema
>;
export type BeatmapUsagePoint = z.infer<typeof BeatmapUsagePointSchema>;
export type BeatmapModDistribution = z.infer<
  typeof BeatmapModDistributionSchema
>;
export type BeatmapTopPerformer = z.infer<typeof BeatmapTopPerformerSchema>;
export type BeatmapStatsSummary = z.infer<typeof BeatmapStatsSummarySchema>;
export type BeatmapWithDetails = z.infer<typeof BeatmapWithDetailsSchema>;
export type RelatedBeatmapDifficulty = z.infer<
  typeof RelatedBeatmapDifficultySchema
>;
export type BeatmapModScoreDistribution = z.infer<
  typeof BeatmapModScoreDistributionSchema
>;
export type BeatmapScorePercentilePoint = z.infer<
  typeof BeatmapScorePercentilePointSchema
>;
export type BeatmapScoreSamplePoint = z.infer<
  typeof BeatmapScoreSamplePointSchema
>;
export type BeatmapScoreSample = z.infer<typeof BeatmapScoreSampleSchema>;
export type BeatmapMissBucket = z.infer<typeof BeatmapMissBucketSchema>;
export type BeatmapGradeCount = z.infer<typeof BeatmapGradeCountSchema>;
export type BeatmapPerformanceSummary = z.infer<
  typeof BeatmapPerformanceSummarySchema
>;
export type BeatmapFreemodPickSummary = z.infer<
  typeof BeatmapFreemodPickSummarySchema
>;
export type BeatmapRankRangeModDistribution = z.infer<
  typeof BeatmapRankRangeModDistributionSchema
>;
export type BeatmapTierScoreSummary = z.infer<
  typeof BeatmapTierScoreSummarySchema
>;
export type BeatmapTierBreakdown = z.infer<typeof BeatmapTierBreakdownSchema>;
export type BeatmapClosenessSummary = z.infer<
  typeof BeatmapClosenessSummarySchema
>;
export type BeatmapStatsResponse = z.infer<typeof BeatmapStatsResponseSchema>;
