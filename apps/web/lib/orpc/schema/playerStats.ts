import { z } from 'zod';

import {
  playerRatingSelectSchema,
  playerSelectSchema,
  ratingAdjustmentSelectSchema,
} from './base';
import {
  DefaultRulesetSchema,
  RatingAdjustmentTypeSchema,
  RulesetSchema,
} from './constants';
import { TierProgressSchema } from './leaderboard';

const playerCompactBaseSchema = playerSelectSchema
  .pick({
    id: true,
    osuId: true,
    username: true,
    country: true,
  })
  .extend({
    defaultRuleset: DefaultRulesetSchema,
  });

export const PlayerCompactSchema = playerCompactBaseSchema;

export const PlayerFrequencySchema = z.object({
  player: PlayerCompactSchema,
  frequency: z.number().int().nonnegative(),
});

export const PlayerModStatsSchema = z.object({
  mods: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  averageScore: z.number().nonnegative(),
});

export const PlayerMatchReferenceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  tournamentId: z.number().int().positive().nullable(),
});

const ratingAdjustmentBaseSchema = ratingAdjustmentSelectSchema
  .pick({
    playerId: true,
    adjustmentType: true,
    timestamp: true,
    ratingBefore: true,
    ratingAfter: true,
    volatilityBefore: true,
    volatilityAfter: true,
    matchId: true,
  })
  .extend({
    adjustmentType: RatingAdjustmentTypeSchema,
  });

export const PlayerRatingAdjustmentSchema = ratingAdjustmentBaseSchema.extend({
  ratingDelta: z.number(),
  volatilityDelta: z.number(),
  match: PlayerMatchReferenceSchema.nullable(),
  gamesWon: z.number().int().nonnegative().nullable(),
  gamesLost: z.number().int().nonnegative().nullable(),
  matchWon: z.boolean().nullable(),
});

const playerRatingBaseSchema = playerRatingSelectSchema
  .pick({
    ruleset: true,
    rating: true,
    volatility: true,
    percentile: true,
    globalRank: true,
    countryRank: true,
  })
  .extend({
    ruleset: RulesetSchema,
  });

export const PlayerRatingStatsSchema = playerRatingBaseSchema.extend({
  player: PlayerCompactSchema,
  tournamentsPlayed: z.number().int().nonnegative().default(0),
  matchesPlayed: z.number().int().nonnegative().default(0),
  winRate: z.number().min(0).max(1).nullable(),
  tierProgress: TierProgressSchema,
  adjustments: PlayerRatingAdjustmentSchema.array(),
  isProvisional: z.boolean(),
});

export const AggregatePlayerMatchStatsSchema = z.object({
  averageMatchCostAggregate: z.number().nonnegative(),
  highestRating: z.number().nonnegative().nullable(),
  ratingGained: z.number(),
  gamesWon: z.number().int().nonnegative(),
  gamesLost: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().nonnegative(),
  matchesWon: z.number().int().nonnegative(),
  matchesLost: z.number().int().nonnegative(),
  matchesPlayed: z.number().int().nonnegative(),
  gameWinRate: z.number().min(0).max(1),
  matchWinRate: z.number().min(0).max(1),
  bestWinStreak: z.number().int().nonnegative(),
  matchAverageScoreAggregate: z.number().nonnegative(),
  matchAverageMissesAggregate: z.number().nonnegative(),
  matchAverageAccuracyAggregate: z.number().min(0),
  averageGamesPlayedAggregate: z.number().min(0),
  averagePlacingAggregate: z.number().min(0),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
});

export const PlayerStatsSchema = z.object({
  playerInfo: PlayerCompactSchema,
  ruleset: RulesetSchema,
  rating: PlayerRatingStatsSchema.nullable(),
  matchStats: AggregatePlayerMatchStatsSchema.nullable(),
  modStats: PlayerModStatsSchema.array(),
  frequentTeammates: PlayerFrequencySchema.array(),
  frequentOpponents: PlayerFrequencySchema.array(),
  tournamentPerformanceStats: z.unknown().nullable().optional(),
});

export const PlayerStatsRequestSchema = z.object({
  id: z.number().int().positive(),
  ruleset: RulesetSchema.optional(),
  dateMin: z.string().optional(),
  dateMax: z.string().optional(),
});

export type PlayerCompact = z.infer<typeof PlayerCompactSchema>;
export type PlayerFrequency = z.infer<typeof PlayerFrequencySchema>;
export type PlayerModStats = z.infer<typeof PlayerModStatsSchema>;
export type PlayerMatchReference = z.infer<typeof PlayerMatchReferenceSchema>;
export type PlayerRatingAdjustment = z.infer<
  typeof PlayerRatingAdjustmentSchema
>;
export type PlayerRatingStats = z.infer<typeof PlayerRatingStatsSchema>;
export type AggregatePlayerMatchStats = z.infer<
  typeof AggregatePlayerMatchStatsSchema
>;
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
export type PlayerStatsRequest = z.infer<typeof PlayerStatsRequestSchema>;
