import { and, asc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { Ruleset } from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

import type { DatabaseClient } from '../db';

export type OsuRefetchCadence = {
  /** Cadence for rated players outside every rank tier. */
  outdatedDays: number;
  /** Cadence for players with no o!TR rating in any ruleset. */
  unratedDays: number;
};

const MS_PER_DAY = 86_400_000;

// A Fetching player whose lease started longer ago than this is enqueued again.
// It must outlast the longest queue wait: at 60 osu! requests a minute, four
// per player, refetching every player once takes about five days.
const FETCH_LEASE_DAYS = 7;

// Ceilings on player_ratings.global_rank; `maxRank: null` matches any rank.
// Rated players outside every tier use `outdatedDays`, and players with no
// rating use `unratedDays`.
const REFETCH_TIERS = {
  osu: [
    { maxRank: 500, days: 1 },
    { maxRank: 5000, days: 3 },
    { maxRank: 20000, days: 7 },
  ],
  otherRulesets: [
    { maxRank: 500, days: 1 },
    { maxRank: null, days: 7 },
  ],
} as const;

/** Leases that started before this time have expired. */
export const fetchLeaseCutoff = () =>
  new Date(Date.now() - FETCH_LEASE_DAYS * MS_PER_DAY).toISOString();

const cadenceDaysExpression = (cadence: OsuRefetchCadence) => {
  // Inlined as literals so postgres types them as integers rather than text parameters.
  const literal = (value: number) => sql.raw(String(Math.trunc(value)));

  const branch = (
    rulesetMatch: ReturnType<typeof sql>,
    tier: { maxRank: number | null; days: number }
  ) =>
    tier.maxRank === null
      ? sql`when ${rulesetMatch} then ${literal(tier.days)}`
      : sql`when ${rulesetMatch} and ${schema.playerRatings.globalRank} <= ${literal(tier.maxRank)} then ${literal(tier.days)}`;

  const isOsu = sql`${schema.playerRatings.ruleset} = ${literal(Ruleset.Osu)}`;
  const isNotOsu = sql`${schema.playerRatings.ruleset} <> ${literal(Ruleset.Osu)}`;

  const branches = [
    ...REFETCH_TIERS.osu.map((tier) => branch(isOsu, tier)),
    ...REFETCH_TIERS.otherRulesets.map((tier) => branch(isNotOsu, tier)),
  ];

  // A player with no rating joins one row of nulls, which matches no
  // branch, so min() is null and coalesce() gives the unrated cadence.
  const isRated = sql`${schema.playerRatings.playerId} is not null`;

  return sql<number>`coalesce(min(case ${sql.join(branches, sql` `)} when ${isRated} then ${literal(cadence.outdatedDays)} end), ${literal(cadence.unratedDays)})`;
};

/**
 * Players due an osu! profile refetch: those last fetched longer ago than
 * their cadence, and those whose fetch lease has expired. A player who was
 * never fetched keeps the 2007 default, so they are always due. Pass
 * `osuPlayerIds` to check only those players. Rows come shortest cadence
 * first, then longest since fetched.
 */
export const selectPlayersDueForOsuRefetch = async (
  db: Pick<DatabaseClient, 'select'>,
  cadence: OsuRefetchCadence,
  osuPlayerIds?: number[]
) => {
  if (osuPlayerIds?.length === 0) {
    return [];
  }

  const cadenceDays = cadenceDaysExpression(cadence);

  return db
    .select({
      osuPlayerId: schema.players.osuId,
      cadenceDays,
      status: schema.players.dataFetchStatus,
      lastFetch: schema.players.osuLastFetch,
    })
    .from(schema.players)
    .leftJoin(
      schema.playerRatings,
      eq(schema.playerRatings.playerId, schema.players.id)
    )
    .where(
      osuPlayerIds ? inArray(schema.players.osuId, osuPlayerIds) : undefined
    )
    .groupBy(schema.players.id)
    .having(
      or(
        and(
          ne(schema.players.dataFetchStatus, DataFetchStatus.Fetching),
          sql`${schema.players.osuLastFetch} < now() - (${cadenceDays} * interval '1 day')`
        ),
        and(
          eq(schema.players.dataFetchStatus, DataFetchStatus.Fetching),
          lt(schema.players.osuLastFetch, fetchLeaseCutoff())
        )
      )
    )
    .orderBy(asc(cadenceDays), asc(schema.players.osuLastFetch));
};
