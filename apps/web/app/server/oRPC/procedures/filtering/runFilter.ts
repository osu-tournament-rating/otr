import { ORPCError } from '@orpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import {
  FilteringFailReason,
  VerificationStatus,
  type Ruleset,
} from '@otr/core/osu';
import type {
  FilteringResult,
  PlayerFilteringResult,
} from '@/lib/orpc/schema/filtering';
import type { DatabaseClient } from '@/lib/db';

import { assertOutsideMaintenanceWindow } from '../shared/maintenanceWindow';

export type TransactionClient = Parameters<
  Parameters<DatabaseClient['transaction']>[0]
>[0];

/** How many of `osuIds` have no player row: the ones a filter would look up. */
export async function countUnknownPlayers(
  tx: Pick<DatabaseClient, 'select'>,
  osuIds: readonly number[]
): Promise<number> {
  if (osuIds.length === 0) {
    return 0;
  }

  const known = await tx
    .select({ osuId: schema.players.osuId })
    .from(schema.players)
    .where(inArray(schema.players.osuId, [...osuIds]));

  return osuIds.length - new Set(known.map((row) => Number(row.osuId))).size;
}

export interface RunFilterOptions {
  /** Who the report belongs to; null once a held request's requester deleted their account. */
  userId: number | null;
  /** Who the player fetches are queued for. */
  requestedByUserId: number;
  ruleset: Ruleset;
  minRating: number | null;
  maxRating: number | null;
  /** Unique osu! IDs. */
  osuIds: readonly number[];
  correlationId: string | undefined;
  headers: Headers;
}

/**
 * Runs the registrant filter in the caller's transaction: adds a placeholder
 * player and queues a fetch for each ID o!TR has never seen, checks every
 * player's current rating against the bounds, and stores the report.
 */
export async function runFilter(
  tx: TransactionClient,
  {
    userId,
    requestedByUserId,
    ruleset,
    minRating,
    maxRating,
    osuIds,
    correlationId,
    headers,
  }: RunFilterOptions
): Promise<FilteringResult> {
  // On the transaction clock, which also stamps the report's `created`
  await assertOutsideMaintenanceWindow(headers, { db: tx });

  const uniqueOsuIds = [...osuIds];
  const selectPlayers = () =>
    tx
      .select({
        id: schema.players.id,
        osuId: schema.players.osuId,
        username: schema.players.username,
      })
      .from(schema.players)
      .where(inArray(schema.players.osuId, uniqueOsuIds));

  let players = await selectPlayers();

  if (players.length !== uniqueOsuIds.length) {
    const foundOsuIds = new Set(players.map((player) => player.osuId));
    const missingOsuIds = uniqueOsuIds.filter(
      (osuId) => !foundOsuIds.has(osuId)
    );

    if (missingOsuIds.length > 0) {
      // Placeholder rows, so filters can record results before ingestion
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
          requestedByUserId,
          explicit: true,
        }))
      );

      players = await selectPlayers();
    }
  }

  const playerIdByOsuId = new Map<number, number>();
  const usernameByPlayerId = new Map<number, string>();

  for (const player of players) {
    playerIdByOsuId.set(player.osuId, player.id);
    usernameByPlayerId.set(player.id, player.username);
  }

  const playerIds = players.map((player) => player.id);

  const ratings = await tx
    .select({
      playerId: schema.playerRatings.playerId,
      rating: schema.playerRatings.rating,
    })
    .from(schema.playerRatings)
    .where(
      and(
        eq(schema.playerRatings.ruleset, ruleset),
        inArray(schema.playerRatings.playerId, playerIds)
      )
    );

  const ratingByPlayerId = new Map<number, number>();
  for (const row of ratings) {
    ratingByPlayerId.set(row.playerId, Number(row.rating));
  }

  // Recorded on each player's row of the report, not filtered on (#1163)
  const peakRows = await tx
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
        eq(schema.ratingAdjustments.ruleset, ruleset),
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

  const participationRows = await tx
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
        eq(schema.tournaments.ruleset, ruleset),
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

    let failureReason = FilteringFailReason.None;

    if (minRating != null && (rating == null || rating < minRating)) {
      failureReason |= FilteringFailReason.MinRating;
    }

    if (maxRating != null && rating != null && rating > maxRating) {
      failureReason |= FilteringFailReason.MaxRating;
    }

    return {
      playerId,
      osuId,
      username,
      isSuccess: failureReason === FilteringFailReason.None,
      failureReason,
      currentRating: rating,
      peakRating,
      tournamentsPlayed: playerId
        ? (tournamentsByPlayerId.get(playerId) ?? 0)
        : 0,
      matchesPlayed: playerId ? (matchesByPlayerId.get(playerId) ?? 0) : 0,
    } satisfies PlayerFilteringResult;
  });

  const playersPassed = playerResults.filter(
    (result) => result.isSuccess
  ).length;
  const playersFailed = playerResults.length - playersPassed;

  const [report] = await tx
    .insert(schema.filterReports)
    .values({
      userId,
      ruleset,
      minRating,
      maxRating,
      playersPassed,
      playersFailed,
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

  return {
    filterReportId: report.id,
    created: report.created,
    playersPassed,
    playersFailed,
    filteringResults: playerResults,
  };
}
