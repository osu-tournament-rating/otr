import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { FilteringFailReason, Ruleset } from '@otr/core/osu';
import * as schema from '@otr/core/db/schema';
import { hasAdminScope } from '@/lib/auth/roles';
import type { DatabaseClient } from '@/lib/db';
import { formatCount } from '@/lib/kit/format/number';
import {
  FILTER_REPORTS_PER_DAY,
  FLAGGED_UNKNOWN_PERCENT,
  MAX_FILTER_PLAYER_IDS,
  FilterReportSchema,
  FilteringRequestSchema,
  FilteringResponseSchema,
  FilteringResultSchema,
  StoredFilteringRequestSchema,
  isFlaggedFilterRequest,
  type FilteringRequest,
  type FilteringResponse,
} from '@/lib/orpc/schema/filtering';

import { protectedMutationProcedure, publicProcedure } from './base';
import { countUnknownPlayers, runFilter } from './filtering/runFilter';
import {
  dailyLimitError,
  lockUser,
  readDailyFilterUsage,
  toFilterRequest,
} from './filtering/limits';
import { getCorrelationId } from './logging';
import {
  allowanceUsedError,
  apiAllowanceRetryAfter,
  chargeApiAllowance,
} from './shared/apiAllowance';
import { assertOutsideMaintenanceWindow } from './shared/maintenanceWindow';

type FilterReportPlayerRow = typeof schema.filterReportPlayers.$inferSelect & {
  player: typeof schema.players.$inferSelect | null;
};

const FilterReportIdSchema = z.object({
  id: z.number().int().positive(),
});

export interface FilterRegistrantsArgs {
  input: FilteringRequest;
  context: {
    db: DatabaseClient;
    headers: Headers;
    session: {
      dbUser?: { id: number; scopes?: string[] | null } | null;
    };
    logging?: unknown;
  };
}

/**
 * Filters registrants for a signed-in user. A user may check
 * {@link MAX_FILTER_PLAYER_IDS} players a request and make
 * {@link FILTER_REPORTS_PER_DAY} reports in a rolling 24 hours. A request
 * where more than 30% of the players are unknown to o!TR is held, with the
 * user's justification, until an admin approves it, and each unknown player
 * the filter looks up costs the user one request of their API allowance.
 * Admins have none of these limits.
 */
export async function filterRegistrantsHandler({
  input,
  context,
}: FilterRegistrantsArgs): Promise<FilteringResponse> {
  const userId = context.session.dbUser?.id;

  if (!userId) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'User account is not linked to an internal profile',
    });
  }

  const isAdmin = hasAdminScope(context.session.dbUser?.scopes);

  if (!isAdmin && input.osuPlayerIds.length > MAX_FILTER_PLAYER_IDS) {
    throw new ORPCError('BAD_REQUEST', {
      message: `A filter report can check up to ${formatCount(MAX_FILTER_PLAYER_IDS)} osu! player IDs.`,
      data: {
        code: 'TOO_MANY_PLAYER_IDS',
        maxPlayerIds: MAX_FILTER_PLAYER_IDS,
      },
    });
  }

  await assertOutsideMaintenanceWindow(context.headers, { db: context.db });

  const osuIds = Array.from(new Set(input.osuPlayerIds));
  const correlationId = getCorrelationId(context);

  return context.db.transaction(async (tx) => {
    await lockUser(tx, userId);

    if (!isAdmin) {
      const usage = await readDailyFilterUsage(tx, userId);

      if (usage.used >= FILTER_REPORTS_PER_DAY) {
        throw dailyLimitError(usage.nextReportAt);
      }
    }

    const unknownPlayerCount = await countUnknownPlayers(tx, osuIds);

    if (!isAdmin && isFlaggedFilterRequest(unknownPlayerCount, osuIds.length)) {
      if (!input.justification) {
        throw new ORPCError('UNPROCESSABLE_CONTENT', {
          status: 422,
          message: `More than ${FLAGGED_UNKNOWN_PERCENT}% of these players are not in o!TR yet. Enter a justification, and an admin will review the request before it runs.`,
          data: {
            code: 'JUSTIFICATION_REQUIRED',
            unknownPlayerCount,
            playerCount: osuIds.length,
          },
        });
      }

      const [request] = await tx
        .insert(schema.filterRequests)
        .values({
          userId,
          ruleset: input.ruleset,
          minRating: input.minRating ?? null,
          maxRating: input.maxRating ?? null,
          osuPlayerIds: osuIds,
          unknownPlayerCount,
          justification: input.justification,
        })
        .returning();

      if (!request) {
        throw new ORPCError('INTERNAL_SERVER_ERROR', {
          message: 'Failed to save the filter request',
        });
      }

      return { status: 'pending', request: toFilterRequest(request) };
    }

    // Admins' lookups cost nothing
    if (!isAdmin && unknownPlayerCount > 0) {
      const retryAfter = await apiAllowanceRetryAfter(tx, userId);

      if (retryAfter > 0) {
        throw allowanceUsedError(retryAfter);
      }

      await chargeApiAllowance(tx, userId, unknownPlayerCount);
    }

    const result = await runFilter(tx, {
      userId,
      requestedByUserId: userId,
      ruleset: input.ruleset,
      minRating: input.minRating ?? null,
      maxRating: input.maxRating ?? null,
      osuIds,
      correlationId,
      headers: context.headers,
    });

    return { status: 'completed', ...result };
  });
}

export const filterRegistrants = protectedMutationProcedure
  .input(FilteringRequestSchema)
  .output(FilteringResponseSchema)
  .route({
    summary: 'Filter tournament registrants',
    tags: ['authenticated'],
    method: 'POST',
    path: '/filtering/registrants:filter',
  })
  .handler(({ input, context }) =>
    filterRegistrantsHandler({ input, context })
  );

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
