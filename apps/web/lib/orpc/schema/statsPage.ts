import { z } from 'zod';

import type {
  ActivePlayers,
  BiggestComebacks,
  BiggestUpsets,
  ClosestGames,
  FreemodMods,
  HeadlineTotals,
  HigherRatedWins,
  MostPlayedArtists,
  MostPlayedBeatmaps,
  MostPlayedMappers,
  PoolDifficulty,
  StrongestFields,
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

export const ClosestGamesSchema = z.object({
  total: count,
  games: z.array(
    z.object({
      ...MatchRecordShape,
      margin: count,
      beatmap: z
        .object({
          osuId: z.number().int(),
          diffName: z.string(),
          artist: z.string().nullable(),
          title: z.string().nullable(),
        })
        .nullable(),
    })
  ),
}) satisfies z.ZodType<ClosestGames>;

export const BiggestComebacksSchema = z.object({
  total: count,
  matches: z.array(z.object({ ...MatchRecordShape, deficit: count })),
}) satisfies z.ZodType<BiggestComebacks>;

export const StrongestFieldsSchema = z.object({
  total: count,
  tournaments: z.array(
    z.object({
      tournamentId: z.number().int(),
      name: z.string(),
      abbreviation: z.string(),
      lobbySize: count,
      rankRangeLowerBound: z.number().int(),
      startTime: isoTimestamp.nullable(),
      endTime: isoTimestamp.nullable(),
      players: count,
      rating: z.number(),
    })
  ),
}) satisfies z.ZodType<StrongestFields>;

export const ActivePlayersSchema = z.object({
  years: z.array(
    z.object({
      year: z.number().int(),
      tournaments: count,
      players: count,
      newPlayers: count,
      newPlayersReturned: count,
    })
  ),
}) satisfies z.ZodType<ActivePlayers>;

export const MostPlayedBeatmapsSchema = z.object({
  total: count,
  beatmaps: z.array(
    z.object({
      osuId: z.number().int(),
      diffName: z.string(),
      artist: z.string().nullable(),
      title: z.string().nullable(),
      starRating: z.number().nonnegative(),
      tournaments: count,
      games: count,
    })
  ),
}) satisfies z.ZodType<MostPlayedBeatmaps>;

export const MostPlayedMappersSchema = z.object({
  total: count,
  mappers: z.array(
    z.object({
      playerId: z.number().int(),
      osuId: z.number().int(),
      username: z.string(),
      tournaments: count,
      beatmaps: count,
    })
  ),
}) satisfies z.ZodType<MostPlayedMappers>;

export const MostPlayedArtistsSchema = z.object({
  total: count,
  artists: z.array(
    z.object({ artist: z.string(), tournaments: count, beatmaps: count })
  ),
}) satisfies z.ZodType<MostPlayedArtists>;

const PoolDifficultyPointSchema = z.object({
  maps: count,
  tournaments: count,
  median: z.number().nonnegative(),
  p90: z.number().nonnegative(),
});

export const PoolDifficultySchema = z.object({
  years: z.array(
    z.object({
      year: z.number().int(),
      tournaments: count,
      open: PoolDifficultyPointSchema.nullable(),
      restricted: PoolDifficultyPointSchema.nullable(),
    })
  ),
}) satisfies z.ZodType<PoolDifficulty>;

/** As stored: every mod combination players picked, per year. */
export const FreemodModsSchema = z.object({
  years: z.array(
    z.object({
      year: z.number().int(),
      tournaments: count,
      games: count,
      scores: count,
      mods: z.array(z.object({ mods: z.number().int(), scores: count })),
    })
  ),
}) satisfies z.ZodType<FreemodMods>;

/**
 * The mods picked on freemod maps as the page charts them: the combinations
 * with 1% or more of every year's picks, the rest as "Other".
 */
export const FreemodModsSummarySchema = z.object({
  /** Most picked first; "Other" last, with null mods. */
  series: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      mods: z.number().int().nullable(),
    })
  ),
  years: z.array(
    z.object({
      year: z.number().int(),
      tournaments: count,
      games: count,
      scores: count,
      /** Scores per series key. */
      values: z.record(z.string(), count),
    })
  ),
});

/** Verified matches by the UTC weekday and hour they started. */
export const MatchStartTimesSchema = z.object({
  matches: count,
  /** Monday first, each day's 24 hours from 00:00. */
  weekdays: z.array(z.array(count).length(24)).length(7),
});

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
  closestGames: ClosestGamesSchema.nullable(),
  biggestComebacks: BiggestComebacksSchema.nullable(),
  strongestFields: StrongestFieldsSchema.nullable(),
  activePlayers: ActivePlayersSchema.nullable(),
  mostPlayedBeatmaps: MostPlayedBeatmapsSchema.nullable(),
  mostPlayedMappers: MostPlayedMappersSchema.nullable(),
  mostPlayedArtists: MostPlayedArtistsSchema.nullable(),
  poolDifficulty: PoolDifficultySchema.nullable(),
  freemodMods: FreemodModsSummarySchema.nullable(),
  matchStartTimes: MatchStartTimesSchema,
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
export type ClosestGamesData = z.infer<typeof ClosestGamesSchema>;
export type ClosestGameData = ClosestGamesData['games'][number];
export type BiggestComebacksData = z.infer<typeof BiggestComebacksSchema>;
export type BiggestComebackData = BiggestComebacksData['matches'][number];
export type StrongestFieldsData = z.infer<typeof StrongestFieldsSchema>;
export type StrongestFieldData = StrongestFieldsData['tournaments'][number];
export type ActivePlayersData = z.infer<typeof ActivePlayersSchema>;
export type MostPlayedBeatmapsData = z.infer<typeof MostPlayedBeatmapsSchema>;
export type MostPlayedBeatmapData = MostPlayedBeatmapsData['beatmaps'][number];

export type PoolDifficultyData = z.infer<typeof PoolDifficultySchema>;
export type FreemodModsData = z.infer<typeof FreemodModsSchema>;
export type FreemodModsSummaryData = z.infer<typeof FreemodModsSummarySchema>;
export type MatchStartTimesData = z.infer<typeof MatchStartTimesSchema>;
/** The parts every listed match shares. */
export type MatchRecordData = Pick<
  BiggestUpsetData,
  keyof typeof MatchRecordShape
>;
