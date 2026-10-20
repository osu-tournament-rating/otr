import { z } from 'zod';

import type { HeadlineTotals } from '@otr/core/platform-stats';

import { RulesetSchema } from './constants';

const count = z.number().int().nonnegative();
const isoTimestamp = z.iso.datetime();

/**
 * Stored statistics. Each schema checks a row the data worker saved, so its
 * type must match the payload type in `@otr/core/platform-stats`.
 */
export const HeadlineTotalsSchema = z.object({
  tournaments: count,
  matches: count,
  games: count,
  scores: count,
  ratedPlayers: count,
}) satisfies z.ZodType<HeadlineTotals>;

export const VerificationSummarySchema = z.object({
  windowDays: count,
  tournaments: count,
  medianDays: z.number().nonnegative().nullable(),
});

export const RecentlyVerifiedTournamentSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  abbreviation: z.string(),
  ruleset: RulesetSchema,
  lobbySize: count,
  rankRangeLowerBound: z.number().int(),
  isLazer: z.boolean(),
  endTime: isoTimestamp.nullable(),
  verifiedAt: isoTimestamp,
});

export const RecentlyVerifiedCursorSchema = z.object({
  verifiedAt: isoTimestamp,
  id: z.number().int(),
});

export const RecentlyVerifiedPageSchema = z.object({
  items: z.array(RecentlyVerifiedTournamentSchema),
  totalCount: count,
  nextCursor: RecentlyVerifiedCursorSchema.nullable(),
});

export const RecentlyVerifiedInputSchema = z.object({
  cursor: RecentlyVerifiedCursorSchema.optional(),
  limit: z.number().int().min(1).max(50),
});

/**
 * Everything the stats page shows beyond `stats.platform`. A stored
 * statistic is null until the data worker has computed it.
 */
export const StatsPageSchema = z.object({
  allRulesets: z.object({
    totals: HeadlineTotalsSchema.nullable(),
    verification: VerificationSummarySchema,
    recentlyVerified: RecentlyVerifiedPageSchema,
  }),
});

export type StatsPage = z.infer<typeof StatsPageSchema>;
export type HeadlineTotalsData = z.infer<typeof HeadlineTotalsSchema>;
export type VerificationSummaryData = z.infer<typeof VerificationSummarySchema>;
export type RecentlyVerifiedPageData = z.infer<
  typeof RecentlyVerifiedPageSchema
>;
export type RecentlyVerifiedTournamentData = z.infer<
  typeof RecentlyVerifiedTournamentSchema
>;
