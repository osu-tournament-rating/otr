import { ORPCError } from '@orpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  FilteringFailReason,
  Ruleset,
  VerificationStatus,
} from '@otr/core/osu';
import { protectedMutationProcedure, publicProcedure } from './base';
import { assertOutsideMaintenanceWindow } from './shared/maintenanceWindow';
import {
  FilterReportSchema,
  FilteringRequestSchema,
  FilteringResultSchema,
  StoredFilteringRequestSchema,
  type PlayerFilteringResult,
} from '@/lib/orpc/schema/filtering';
import * as schema from '@otr/core/db/schema';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import { getCorrelationId } from './logging';

type FilterReportPlayerRow = typeof schema.filterReportPlayers.$inferSelect & {
  player: typeof schema.players.$inferSelect | null;
};

const FilterReportIdSchema = z.object({
  id: z.number().int().positive(),
});

export const filterRegistrants = protectedMutationProcedure
  .input(FilteringRequestSchema)
  .output(FilteringResultSchema)
  .route({
    summary: 'Filter tournament registrants',
    tags: ['authenticated'],
    method: 'POST',
    path: '/filtering/registrants:filter',
  })
  .handler(async ({ input, context }) => {
    const userId = context.session.dbUser?.id;

    if (!userId) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'User account is not linked to an internal profile',
      });
    }

    await assertOutsideMaintenanceWindow(context.headers, { db: context.db });

    const uniqueOsuIds = Array.from(new Set(input.osuPlayerIds));

    let players = await context.db
      .select({
        id: schema.players.id,
        osuId: schema.players.osuId,
        username: schema.players.username,
      })
      .from(schema.players)
      .where(inArray(schema.players.osuId, uniqueOsuIds));

    if (players.length !== uniqueOsuIds.length) {
      const foundOsuIds = new Set(players.map((player) => player.osuId));
      const missingOsuIds = uniqueOsuIds.filter(
        (osuId) => !foundOsuIds.has(osuId)
      );

      if (missingOsuIds.length > 0) {
        const correlationId = getCorrelationId(context);

        // Placeholder rows, so filters can record results before ingestion
        await context.db.transaction(async (tx) => {
          await tx
            .insert(schema.players)
            .values(missingOsuIds.map((osuId) => ({ osuId })))
            .onConflictDoNothing({ target: schema.players.osuId });

          await enqueueJobs(
            tx,
            JobQueue.OsuFetch,
            missingOsuIds.map((osuPlayerId) => ({
              payload: { type: 'player', osuPlayerId },
              correlationId,
              requestedByUserId: userId,
              explicit: true,
            }))
          );
        });

        players = await context.db
          .select({
            id: schema.players.id,
            osuId: schema.players.osuId,
            username: schema.players.username,
          })
          .from(schema.players)
          .where(inArray(schema.players.osuId, uniqueOsuIds));
      }
    }

    const playerIdByOsuId = new Map<number, number>();
    const usernameByPlayerId = new Map<number, string>();

    for (const player of players) {
      const osuId = player.osuId;
      playerIdByOsuId.set(osuId, player.id);
      usernameByPlayerId.set(player.id, player.username);
    }

    const playerIds = players.map((player) => player.id);

    const ratings = await context.db
      .select({
        playerId: schema.playerRatings.playerId,
        rating: schema.playerRatings.rating,
      })
      .from(schema.playerRatings)
      .where(
        and(
          eq(schema.playerRatings.ruleset, input.ruleset),
          inArray(schema.playerRatings.playerId, playerIds)
        )
      );

    const ratingByPlayerId = new Map<number, number>();
    for (const row of ratings) {
      ratingByPlayerId.set(row.playerId, Number(row.rating));
    }

    const peakRows = await context.db
      .select({
        playerId: schema.ratingAdjustments.playerId,
        peakRating:
          sql<number>`MAX(${schema.ratingAdjustments.ratingAfter})`.mapWith(
            Number
          ),
      })
      .from(schema.ratingAdjustments)
      .where(
        and(
          eq(schema.ratingAdjustments.ruleset, input.ruleset),
          inArray(schema.ratingAdjustments.playerId, playerIds)
        )
      )
      .groupBy(schema.ratingAdjustments.playerId);

    const peakByPlayerId = new Map<number, number>();
    for (const row of peakRows) {
      if (row.peakRating !== undefined && row.peakRating !== null) {
        peakByPlayerId.set(row.playerId, Number(row.peakRating));
      }
    }

    const participationRows = await context.db
      .select({
        playerId: schema.playerTournamentStats.playerId,
        tournamentsPlayed:
          sql<number>`COUNT(DISTINCT ${schema.playerTournamentStats.tournamentId})`.mapWith(
            Number
          ),
        matchesPlayed:
          sql<number>`COALESCE(SUM(${schema.playerTournamentStats.matchesPlayed}), 0)`.mapWith(
            Number
          ),
      })
      .from(schema.playerTournamentStats)
      .innerJoin(
        schema.tournaments,
        eq(schema.tournaments.id, schema.playerTournamentStats.tournamentId)
      )
      .where(
        and(
          inArray(schema.playerTournamentStats.playerId, playerIds),
          eq(schema.tournaments.ruleset, input.ruleset),
          eq(schema.tournaments.verificationStatus, VerificationStatus.Verified)
        )
      )
      .groupBy(schema.playerTournamentStats.playerId);

    const tournamentsByPlayerId = new Map<number, number>();
    const matchesByPlayerId = new Map<number, number>();

    for (const row of participationRows) {
      tournamentsByPlayerId.set(row.playerId, row.tournamentsPlayed ?? 0);
      matchesByPlayerId.set(row.playerId, row.matchesPlayed ?? 0);
    }

    const playerResults: PlayerFilteringResult[] = uniqueOsuIds.map((osuId) => {
      const playerId = playerIdByOsuId.get(osuId) ?? null;
      const username = playerId
        ? (usernameByPlayerId.get(playerId) ?? null)
        : null;

      const rating = playerId ? (ratingByPlayerId.get(playerId) ?? null) : null;
      const peakRating = playerId
        ? (peakByPlayerId.get(playerId) ?? rating ?? null)
        : null;

      const tournamentsPlayed = playerId
        ? (tournamentsByPlayerId.get(playerId) ?? 0)
        : 0;
      const matchesPlayed = playerId
        ? (matchesByPlayerId.get(playerId) ?? 0)
        : 0;

      let failureReason = FilteringFailReason.None;

      if (input.minRating != null) {
        if (rating == null || rating < input.minRating) {
          failureReason |= FilteringFailReason.MinRating;
        }
      }

      if (input.maxRating != null) {
        if (rating != null && rating > input.maxRating) {
          failureReason |= FilteringFailReason.MaxRating;
        }
      }

      if (input.peakRating != null) {
        if (peakRating == null || peakRating > input.peakRating) {
          failureReason |= FilteringFailReason.PeakRatingTooHigh;
        }
      }

      if (input.tournamentsPlayed != null) {
        if (tournamentsPlayed < input.tournamentsPlayed) {
          failureReason |= FilteringFailReason.NotEnoughTournaments;
        }
      }

      if (input.maxTournamentsPlayed != null) {
        if (tournamentsPlayed > input.maxTournamentsPlayed) {
          failureReason |= FilteringFailReason.TooManyTournaments;
        }
      }

      if (input.matchesPlayed != null) {
        if (matchesPlayed < input.matchesPlayed) {
          failureReason |= FilteringFailReason.NotEnoughMatches;
        }
      }

      if (input.maxMatchesPlayed != null) {
        if (matchesPlayed > input.maxMatchesPlayed) {
          failureReason |= FilteringFailReason.TooManyMatches;
        }
      }

      const isSuccess = failureReason === FilteringFailReason.None;

      return {
        playerId,
        osuId,
        username,
        isSuccess,
        failureReason,
        currentRating: rating,
        peakRating,
        tournamentsPlayed,
        matchesPlayed,
      } satisfies PlayerFilteringResult;
    });

    const playersPassed = playerResults.filter(
      (result) => result.isSuccess
    ).length;
    const playersFailed = playerResults.length - playersPassed;

    const insertedReport = await context.db.transaction(async (tx) => {
      // Re-asserted on the transaction clock to match the report's `created`
      await assertOutsideMaintenanceWindow(context.headers, { db: tx });

      const [report] = await tx
        .insert(schema.filterReports)
        .values({
          userId,
          ruleset: input.ruleset,
          minRating: input.minRating ?? null,
          maxRating: input.maxRating ?? null,
          tournamentsPlayed: input.tournamentsPlayed ?? null,
          peakRating: input.peakRating ?? null,
          matchesPlayed: input.matchesPlayed ?? null,
          playersPassed,
          playersFailed,
          maxMatchesPlayed: input.maxMatchesPlayed ?? null,
          maxTournamentsPlayed: input.maxTournamentsPlayed ?? null,
        })
        .returning({
          id: schema.filterReports.id,
          created: schema.filterReports.created,
        });

      if (!report) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'Failed to persist filter report',
        });
      }

      const storableResults = playerResults.filter(
        (result): result is PlayerFilteringResult & { playerId: number } =>
          result.playerId != null
      );

      if (storableResults.length > 0) {
        await tx.insert(schema.filterReportPlayers).values(
          storableResults.map((result) => ({
            filterReportId: report.id,
            playerId: result.playerId,
            isSuccess: result.isSuccess,
            failureReason: result.failureReason ?? FilteringFailReason.None,
            currentRating: result.currentRating,
            peakRating: result.peakRating,
            tournamentsPlayed: result.tournamentsPlayed,
            matchesPlayed: result.matchesPlayed,
          }))
        );
      }

      return report;
    });

    return {
      filterReportId: insertedReport.id,
      created: insertedReport.created,
      playersPassed,
      playersFailed,
      filteringResults: playerResults,
    };
  });

export const getFilterReport = publicProcedure
  .input(FilterReportIdSchema)
  .output(FilterReportSchema)
  .route({
    summary: 'Get filtering report',
    tags: ['public'],
    method: 'GET',
    path: '/filtering/reports/{id}',
  })
  .handler(async ({ input, context }) => {
    const report = await context.db.query.filterReports.findFirst({
      where: eq(schema.filterReports.id, input.id),
      with: {
        filterReportPlayers: {
          with: {
            player: true,
          },
        },
      },
    });

    if (!report) {
      throw new ORPCError('NOT_FOUND', {
        message: `Filter report ${input.id} was not found`,
      });
    }

    const playerEntries = (report.filterReportPlayers ??
      []) as FilterReportPlayerRow[];

    const response = {
      filterReportId: report.id,
      created: report.created,
      playersPassed: report.playersPassed,
      playersFailed: report.playersFailed,
      filteringResults: playerEntries.map((player) => ({
        playerId: player.playerId,
        osuId: player.player ? Number(player.player.osuId) : null,
        username: player.player?.username ?? null,
        isSuccess: player.isSuccess,
        failureReason: player.failureReason ?? FilteringFailReason.None,
        currentRating:
          player.currentRating !== null && player.currentRating !== undefined
            ? Number(player.currentRating)
            : null,
        peakRating:
          player.peakRating !== null && player.peakRating !== undefined
            ? Number(player.peakRating)
            : null,
        tournamentsPlayed:
          player.tournamentsPlayed !== null &&
          player.tournamentsPlayed !== undefined
            ? Number(player.tournamentsPlayed)
            : null,
        matchesPlayed:
          player.matchesPlayed !== null && player.matchesPlayed !== undefined
            ? Number(player.matchesPlayed)
            : null,
      })),
    } satisfies z.infer<typeof FilteringResultSchema>;

    return {
      id: report.id,
      created: report.created,
      request: StoredFilteringRequestSchema.parse({
        ruleset: report.ruleset as Ruleset,
        minRating: report.minRating,
        maxRating: report.maxRating,
        peakRating: report.peakRating,
        tournamentsPlayed: report.tournamentsPlayed,
        matchesPlayed: report.matchesPlayed,
        maxMatchesPlayed: report.maxMatchesPlayed,
        maxTournamentsPlayed: report.maxTournamentsPlayed,
        osuPlayerIds: playerEntries
          .map((player) => (player.player ? Number(player.player.osuId) : null))
          .filter((id): id is number => id !== null),
      }),
      response,
    } satisfies z.infer<typeof FilterReportSchema>;
  });
