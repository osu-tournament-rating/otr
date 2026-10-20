import { ORPCError } from '@orpc/server';
import { SQL, and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  LeaderboardRequestSchema,
  LeaderboardResponseSchema,
  type LeaderboardRequest,
} from '@/lib/orpc/schema/leaderboard';
import { buildTierProgress, getTierBounds } from '@/lib/utils/tierProgress';
import { Ruleset } from '@otr/core/osu';

import {
  publicProcedure,
  protectedProcedure,
  withSearchRateLimit,
} from './base';
import {
  buildLeaderboardOrder,
  buildLeaderboardSearchCondition,
} from './shared/leaderboardQuery';
import type { DatabaseClient } from '@/lib/db';
import { logger } from '@/lib/logger';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function runLeaderboard({
  input,
  context,
  friendUserId,
}: {
  input: LeaderboardRequest;
  context: { db: DatabaseClient };
  friendUserId?: number;
}) {
  try {
    const page = Math.max(input.page ?? 1, 1);
    const pageSize = Math.max(
      1,
      Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    );
    const ruleset = input.ruleset ?? Ruleset.Osu;
    let scopedPlayerIds: number[] | undefined;

    if (friendUserId != null) {
      const friendRows = await context.db
        .select({ friendId: schema.playerFriends.friendId })
        .from(schema.playerFriends)
        .where(eq(schema.playerFriends.playerId, friendUserId));

      scopedPlayerIds = Array.from(
        new Set<number>([
          friendUserId,
          ...friendRows.map((row) => Number(row.friendId)),
        ])
      );
    }

    const tournamentsPlayedExpr = sql<number>`
      COALESCE(COUNT(DISTINCT ${schema.tournaments.id})::int, 0)
    `.as('tournamentsPlayed');
    const matchesPlayedExpr = sql<number>`
      COALESCE(
        SUM(
          CASE
            WHEN ${schema.tournaments.id} IS NOT NULL THEN ${schema.playerTournamentStats.matchesPlayed}
            ELSE 0
          END
        )::int,
        0
      )
    `.as('matchesPlayed');
    const winRateExpr = sql<number>`
      CASE
        WHEN SUM(
          CASE
            WHEN ${schema.tournaments.id} IS NOT NULL THEN ${schema.playerTournamentStats.matchesPlayed}
            ELSE 0
          END
        ) = 0 THEN 0
        ELSE SUM(
          CASE
            WHEN ${schema.tournaments.id} IS NOT NULL THEN ${schema.playerTournamentStats.matchesWon}
            ELSE 0
          END
        )::double precision
        / NULLIF(
          SUM(
            CASE
              WHEN ${schema.tournaments.id} IS NOT NULL THEN ${schema.playerTournamentStats.matchesPlayed}
              ELSE 0
            END
          )::double precision,
          0
        )
      END
    `.as('winRate');
    const osuGlobalRankExpr = sql<number | null>`
      ${schema.playerOsuRulesetData.globalRank}
    `.as('osuGlobalRank');

    const selectFields = {
      playerId: schema.players.id,
      osuId: schema.players.osuId,
      username: schema.players.username,
      country: schema.players.country,
      rating: schema.playerRatings.rating,
      volatility: schema.playerRatings.volatility,
      percentile: schema.playerRatings.percentile,
      ratingGlobalRank: schema.playerRatings.globalRank,
      countryRank: schema.playerRatings.countryRank,
      tournamentsPlayed: tournamentsPlayedExpr,
      matchesPlayed: matchesPlayedExpr,
      winRate: winRateExpr,
      osuGlobalRank: osuGlobalRankExpr,
    } as const;

    const leaderboardBaseQuery = context.db
      .select(selectFields)
      .from(schema.playerRatings)
      .innerJoin(
        schema.players,
        eq(schema.playerRatings.playerId, schema.players.id)
      )
      .leftJoin(
        schema.playerTournamentStats,
        eq(schema.playerTournamentStats.playerId, schema.players.id)
      )
      .leftJoin(
        schema.tournaments,
        and(
          eq(schema.tournaments.id, schema.playerTournamentStats.tournamentId),
          eq(schema.tournaments.ruleset, schema.playerRatings.ruleset)
        )
      )
      .leftJoin(
        schema.playerOsuRulesetData,
        and(
          eq(schema.playerOsuRulesetData.playerId, schema.players.id),
          eq(schema.playerOsuRulesetData.ruleset, schema.playerRatings.ruleset)
        )
      );

    const ratingRulesetFilter = eq(schema.playerRatings.ruleset, ruleset);
    const playerScopeFilter =
      scopedPlayerIds && scopedPlayerIds.length > 0
        ? inArray(schema.players.id, scopedPlayerIds)
        : undefined;
    // Filters players before the per-player aggregation, not after it
    const usernameFilter = buildLeaderboardSearchCondition(input.searchQuery);
    const baseWhere =
      playerScopeFilter || usernameFilter
        ? and(playerScopeFilter, usernameFilter, ratingRulesetFilter)
        : ratingRulesetFilter;
    const groupByColumns = [
      schema.playerRatings.id,
      schema.playerRatings.rating,
      schema.playerRatings.volatility,
      schema.playerRatings.percentile,
      schema.playerRatings.globalRank,
      schema.playerRatings.countryRank,
      schema.players.id,
      schema.players.osuId,
      schema.players.username,
      schema.players.country,
      schema.playerOsuRulesetData.globalRank,
    ] as const;

    const leaderboardBase = context.db
      .$with('leaderboard_base')
      .as(leaderboardBaseQuery.where(baseWhere).groupBy(...groupByColumns));

    const filters: SQL<unknown>[] = [];

    if (input.country) {
      filters.push(eq(leaderboardBase.country, input.country));
    }

    if (input.minRating !== undefined) {
      filters.push(gte(leaderboardBase.rating, input.minRating));
    }

    if (input.maxRating !== undefined) {
      filters.push(lte(leaderboardBase.rating, input.maxRating));
    }

    if (input.minMatches !== undefined) {
      filters.push(gte(leaderboardBase.matchesPlayed, input.minMatches));
    }

    if (input.maxMatches !== undefined) {
      filters.push(lte(leaderboardBase.matchesPlayed, input.maxMatches));
    }

    if (input.minWinRate !== undefined) {
      filters.push(gte(leaderboardBase.winRate, input.minWinRate));
    }

    if (input.maxWinRate !== undefined) {
      filters.push(lte(leaderboardBase.winRate, input.maxWinRate));
    }

    if (input.minOsuRank !== undefined) {
      filters.push(
        sql`${leaderboardBase.osuGlobalRank} IS NOT NULL AND ${leaderboardBase.osuGlobalRank} >= ${input.minOsuRank}`
      );
    }

    if (input.maxOsuRank !== undefined) {
      filters.push(
        sql`${leaderboardBase.osuGlobalRank} IS NOT NULL AND ${leaderboardBase.osuGlobalRank} <= ${input.maxOsuRank}`
      );
    }

    if (input.tiers && input.tiers.length > 0) {
      const tierConditions = input.tiers
        .map((tierKey) => {
          const bounds = getTierBounds(tierKey);

          if (!bounds) {
            return undefined;
          }

          const lowerBound = sql`${leaderboardBase.rating} >= ${bounds.min}`;

          if (bounds.max === null) {
            return lowerBound;
          }

          const upperBound = sql`${leaderboardBase.rating} < ${bounds.max}`;
          return sql`${lowerBound} AND ${upperBound}`;
        })
        .filter(
          (condition): condition is SQL<unknown> => condition !== undefined
        );

      const tiersFilter = or(...tierConditions);

      if (tiersFilter) {
        filters.push(tiersFilter);
      }
    }

    const whereClause =
      filters.length === 1
        ? filters[0]
        : filters.length > 1
          ? and(...filters)
          : undefined;

    const baseCountQuery = context.db
      .with(leaderboardBase)
      .select({ value: sql<number>`COUNT(*)` })
      .from(leaderboardBase);

    const totalRows = whereClause
      ? await baseCountQuery.where(whereClause)
      : await baseCountQuery;
    const total = Number(totalRows[0]?.value ?? 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, pages);
    const offset = Math.max(0, (currentPage - 1) * pageSize);

    const baseRowsQuery = context.db
      .with(leaderboardBase)
      .select({
        playerId: leaderboardBase.playerId,
        osuId: leaderboardBase.osuId,
        username: leaderboardBase.username,
        country: leaderboardBase.country,
        rating: leaderboardBase.rating,
        volatility: leaderboardBase.volatility,
        percentile: leaderboardBase.percentile,
        ratingGlobalRank: leaderboardBase.ratingGlobalRank,
        countryRank: leaderboardBase.countryRank,
        tournamentsPlayed: leaderboardBase.tournamentsPlayed,
        matchesPlayed: leaderboardBase.matchesPlayed,
        winRate: leaderboardBase.winRate,
      })
      .from(leaderboardBase);

    const rowsQuery = whereClause
      ? baseRowsQuery.where(whereClause)
      : baseRowsQuery;

    const leaderboardRows = await rowsQuery
      .orderBy(
        ...buildLeaderboardOrder(leaderboardBase, input.sort, input.descending)
      )
      .limit(pageSize)
      .offset(offset);

    const leaderboard = leaderboardRows.map((row) => {
      const rating = Number(row.rating ?? 0);
      const { tierKey, tierProgress } = buildTierProgress(rating);

      const winRate = Number(row.winRate ?? 0);

      return {
        player: {
          id: Number(row.playerId),
          osuId: Number(row.osuId),
          username: row.username,
          country: row.country,
        },
        ruleset,
        rating,
        volatility: Number(row.volatility ?? 0),
        percentile: Number(row.percentile ?? 0),
        globalRank: Number(row.ratingGlobalRank ?? 0),
        countryRank: Number(row.countryRank ?? 0),
        tournamentsPlayed: Number(row.tournamentsPlayed ?? 0),
        matchesPlayed: Number(row.matchesPlayed ?? 0),
        winRate: Number.isFinite(winRate) && winRate >= 0 ? winRate : 0,
        tier: tierKey,
        tierProgress,
      };
    });

    return LeaderboardResponseSchema.parse({
      page: currentPage,
      pageSize,
      pages,
      total,
      ruleset,
      leaderboard,
    });
  } catch (error) {
    logger.error('leaderboard.list failed', { error });
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message:
        error instanceof Error
          ? error.message
          : 'Failed to fetch leaderboard data',
    });
  }
}

export const getLeaderboard = publicProcedure
  .input(LeaderboardRequestSchema.omit({ friend: true, userId: true }))
  .use(withSearchRateLimit, (input) => input.searchQuery)
  .output(LeaderboardResponseSchema)
  .route({
    summary: 'List leaderboard entries',
    tags: ['public'],
    method: 'GET',
    path: '/leaderboard',
  })
  .handler(async ({ input, context }) =>
    runLeaderboard({ input, context, friendUserId: undefined })
  );

export const getLeaderboardFriends = protectedProcedure
  .input(LeaderboardRequestSchema.omit({ friend: true, userId: true }))
  .use(withSearchRateLimit, (input) => input.searchQuery)
  .output(LeaderboardResponseSchema)
  .route({
    summary: "List leaderboard entries for user's friends",
    tags: ['protected'],
    method: 'GET',
    path: '/leaderboard/friends',
  })
  .handler(async ({ input, context }) => {
    const session = context.session as
      { dbPlayer?: { id?: number | null } | null } | undefined;
    const friendUserId = session?.dbPlayer?.id;

    if (!friendUserId) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'Invalid or missing session',
      });
    }

    return runLeaderboard({ input, context, friendUserId });
  });
