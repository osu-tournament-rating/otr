import { ORPCError } from '@orpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  PlayerRatingsInputSchema,
  PlayerRatingsResponseSchema,
} from '@/lib/orpc/schema/playerRatings';
import { buildTierProgress } from '@/lib/utils/tierProgress';

import { publicProcedure } from './base';
import { logger } from '@/lib/logger';

export const getPlayerRatings = publicProcedure
  .input(PlayerRatingsInputSchema)
  .output(PlayerRatingsResponseSchema)
  .route({
    summary: 'Get ratings for multiple players',
    tags: ['public'],
    method: 'POST',
    path: '/players/ratings',
  })
  .handler(async ({ input, context }) => {
    try {
      const osuIds = [...new Set(input.osuIds)];
      const ruleset = input.ruleset;

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

      const peakRatingExpr = sql<number>`
        COALESCE(
          (SELECT MAX(ra.rating_after) FROM rating_adjustments ra
           WHERE ra.player_id = ${schema.playerRatings.playerId}
             AND ra.player_rating_id = ${schema.playerRatings.id}),
          ${schema.playerRatings.rating}
        )
      `.as('peakRating');

      const rows = await context.db
        .select({
          osuId: schema.players.osuId,
          rating: schema.playerRatings.rating,
          volatility: schema.playerRatings.volatility,
          percentile: schema.playerRatings.percentile,
          tournamentsPlayed: tournamentsPlayedExpr,
          matchesPlayed: matchesPlayedExpr,
          peakRating: peakRatingExpr,
        })
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
            eq(
              schema.tournaments.id,
              schema.playerTournamentStats.tournamentId
            ),
            eq(schema.tournaments.ruleset, schema.playerRatings.ruleset)
          )
        )
        .where(
          and(
            inArray(schema.players.osuId, osuIds),
            eq(schema.playerRatings.ruleset, ruleset)
          )
        )
        .groupBy(
          schema.players.osuId,
          schema.playerRatings.id,
          schema.playerRatings.playerId,
          schema.playerRatings.rating,
          schema.playerRatings.volatility,
          schema.playerRatings.percentile
        );

      return rows.map((row) => {
        const rating = Number(row.rating);
        const { tierProgress } = buildTierProgress(rating);

        return {
          osuId: Number(row.osuId),
          rating,
          volatility: Number(row.volatility),
          peakRating: Number(row.peakRating),
          verifiedTournamentsPlayed: Number(row.tournamentsPlayed),
          verifiedMatchesPlayed: Number(row.matchesPlayed),
          percentile: Number(row.percentile),
          tier: tierProgress.currentTier,
          subTier: tierProgress.currentSubTier ?? 1,
        };
      });
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }

      logger.error('players.ratings failed', { error });
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message:
          error instanceof Error
            ? error.message
            : 'Failed to fetch player ratings',
      });
    }
  });
