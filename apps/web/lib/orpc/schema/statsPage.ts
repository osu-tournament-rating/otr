import { z } from 'zod';

import type {
  BiggestUpsets,
  HeadlineTotals,
  HigherRatedWins,
} from '@otr/core/platform-stats';

import { RANK_RANGE_BUCKET_KEYS } from '@/lib/beatmaps/rankRange';

import { RulesetSchema, TeamSchema } from './constants';

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

export const HigherRatedWinsSchema = z.object({
  buckets: z.array(
    z.object({
      minGap: count,
      matches: count,
      higherRatedWins: count,
    })
  ),
  medianGap: z.number().nonnegative().nullable(),
}) satisfies z.ZodType<HigherRatedWins>;

const MatchRecordShape = {
  matchId: z.number().int(),
  matchName: z.string(),
  tournamentId: z.number().int(),
  tournamentName: z.string(),
  winnerTeam: TeamSchema,
  winnerScore: count,
  loserScore: count,
};

export const BiggestUpsetsSchema = z.object({
  total: count,
  matches: z.array(
    z.object({
      ...MatchRecordShape,
      winnerRating: z.number(),
      loserRating: z.number(),
    })
  ),
}) satisfies z.ZodType<BiggestUpsets>;

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

export const LazerYearSchema = z.object({
  year: z.number().int(),
  total: count,
  lazer: count,
});

export const CountryCountSchema = z.object({
  country: z.string(),
  players: count,
});

/** One ruleset's players by country: the leading countries and the totals. */
export const CountrySummarySchema = z.object({
  /** Most players first, at most `COUNTRY_BAR_LIMIT`. */
  countries: z.array(CountryCountSchema),
  /** Countries with any player. */
  countryCount: count,
  players: count,
});

/** One year's verified tournaments in each rank restriction band. */
export const RankRestrictionYearSchema = z.object({
  year: z.number().int(),
  bands: z.record(z.enum(RANK_RANGE_BUCKET_KEYS), count),
});

export const RulesetStatsSchema = z.object({
  ruleset: RulesetSchema,
  playersByCountry: CountrySummarySchema,
  topPlayersByCountry: CountrySummarySchema,
  rankRestrictionsByYear: z.array(RankRestrictionYearSchema),
  /** Stored statistics, null until the data worker has computed them. */
  higherRatedWins: HigherRatedWinsSchema.nullable(),
  biggestUpsets: BiggestUpsetsSchema.nullable(),
});

/**
 * Everything the stats page shows beyond `stats.platform`: statistics over
 * every ruleset, and one entry per rated ruleset, so the page's ruleset
 * switch changes them without a server render. A stored statistic is null
 * until the data worker has computed it.
 */
export const StatsPageSchema = z.object({
  allRulesets: z.object({
    totals: HeadlineTotalsSchema.nullable(),
    verification: VerificationSummarySchema,
    recentlyVerified: RecentlyVerifiedPageSchema,
    lazerByYear: z.array(LazerYearSchema),
  }),
  byRuleset: z.array(RulesetStatsSchema),
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
export type LazerYearData = z.infer<typeof LazerYearSchema>;
export type CountryCountData = z.infer<typeof CountryCountSchema>;
export type CountrySummaryData = z.infer<typeof CountrySummarySchema>;
export type RankRestrictionYearData = z.infer<typeof RankRestrictionYearSchema>;
export type RulesetStatsData = z.infer<typeof RulesetStatsSchema>;
export type HigherRatedWinsData = z.infer<typeof HigherRatedWinsSchema>;
export type BiggestUpsetsData = z.infer<typeof BiggestUpsetsSchema>;
export type BiggestUpsetData = BiggestUpsetsData['matches'][number];
/** The parts every listed match shares. */
export type MatchRecordData = Pick<
  BiggestUpsetData,
  keyof typeof MatchRecordShape
>;
