import { z } from 'zod';

import { INACTIVE_AFTER_DAYS } from '@otr/core/db/player-activity';

import { playerRatingSelectSchema, playerSelectSchema } from './base';
import { RulesetSchema } from './constants';

export const leaderboardTierKeys = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'emerald',
  'diamond',
  'master',
  'grandmaster',
  'eliteGrandmaster',
] as const;

export const LeaderboardTierKeySchema = z.enum(leaderboardTierKeys);

/**
 * The columns the leaderboard sorts by. Rank and tier follow rating, so
 * `rating` covers them too.
 */
export const leaderboardSortKeys = [
  'rating',
  'tournaments',
  'matches',
  'winRate',
] as const;

export const LeaderboardSortSchema = z.enum(leaderboardSortKeys);

/** Mirrors the other list searches: one character matches too much. */
export const LEADERBOARD_SEARCH_MIN_LENGTH = 2;
export const LEADERBOARD_SEARCH_MAX_LENGTH = 200;

export const TierProgressSchema = z.object({
  currentTier: z.string(),
  currentSubTier: z.number().int().min(1).max(3).nullable(),
  nextTier: z.string().nullable(),
  nextSubTier: z.number().int().min(1).max(3).nullable(),
  ratingForNextTier: z.number(),
  ratingForNextMajorTier: z.number(),
  nextMajorTier: z.string().nullable(),
  subTierFillPercentage: z.number().min(0).max(1).nullable(),
  majorTierFillPercentage: z.number().min(0).max(1).nullable(),
});

export const LeaderboardPlayerSchema = playerSelectSchema.pick({
  id: true,
  osuId: true,
  username: true,
  country: true,
});

const leaderboardRatingBaseSchema = playerRatingSelectSchema
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

/** A rated player's activity in the ruleset, for the leaderboard and profiles. */
export const PlayerActivitySchema = z.object({
  lastMatchTime: z
    .string()
    .nullable()
    .describe(
      "When the player's last verified match in the ruleset ended (ISO 8601), as of the last rating run."
    ),
  inactive: z
    .boolean()
    .describe(
      `True when the player has no verified match in the ruleset in the last ${INACTIVE_AFTER_DAYS} days.`
    ),
});

export const LeaderboardEntrySchema = leaderboardRatingBaseSchema
  .extend({
    player: LeaderboardPlayerSchema,
    countryRank: z.number().int().nonnegative(),
    tournamentsPlayed: z.number().int().nonnegative(),
    matchesPlayed: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(1),
    tier: LeaderboardTierKeySchema,
    tierProgress: TierProgressSchema,
  })
  .extend(PlayerActivitySchema.shape);

export const LeaderboardRequestSchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  ruleset: RulesetSchema.optional(),
  country: z.string().trim().min(2).max(4).optional(),
  minOsuRank: z.number().int().min(1).optional(),
  maxOsuRank: z.number().int().min(1).optional(),
  minRating: z.number().int().min(0).optional(),
  maxRating: z.number().int().min(0).optional(),
  minMatches: z.number().int().min(1).optional(),
  maxMatches: z.number().int().min(1).optional(),
  minWinRate: z.number().min(0).max(1).optional(),
  maxWinRate: z.number().min(0).max(1).optional(),
  tiers: LeaderboardTierKeySchema.array().optional(),
  searchQuery: z
    .string()
    .trim()
    .min(LEADERBOARD_SEARCH_MIN_LENGTH)
    .max(LEADERBOARD_SEARCH_MAX_LENGTH)
    .optional()
    .describe(
      'Keeps players whose username contains this text, ignoring case. Ranks stay global.'
    ),
  sort: LeaderboardSortSchema.optional().describe(
    'Column to sort by. Without `sort` or `descending`, players are in global rank order.'
  ),
  descending: z
    .boolean()
    .optional()
    .describe(
      'Sort direction; defaults to true (highest first). Ties fall back to global rank.'
    ),
  includeInactive: z
    .boolean()
    .optional()
    .describe(
      `Also lists inactive players, with no verified match in the ruleset in the last ${INACTIVE_AFTER_DAYS} days. Defaults to false. Players restricted on osu! are never listed.`
    ),
  friend: z.boolean().optional(),
  userId: z.number().int().min(1).optional(),
});

export const LeaderboardResponseSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  pages: z.number().int().min(0),
  total: z.number().int().nonnegative(),
  ruleset: RulesetSchema,
  leaderboard: LeaderboardEntrySchema.array(),
});

export type LeaderboardTierKey = z.infer<typeof LeaderboardTierKeySchema>;
export type LeaderboardSort = z.infer<typeof LeaderboardSortSchema>;
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
export type LeaderboardRequest = z.infer<typeof LeaderboardRequestSchema>;
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
