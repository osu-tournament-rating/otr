import { ORPCError } from '@orpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  TournamentBeatmapAdminMutationInputSchema,
  TournamentBeatmapAdminMutationResponseSchema,
  type TournamentBeatmapAdminMutationInput,
} from '@/lib/orpc/schema/tournament';

import { adminMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { getCorrelationId } from '../logging/helpers';
import { Ruleset } from '@otr/core/osu';
import { createPlaceholderBeatmap } from './beatmapPlaceholders';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import type { DatabaseClient } from '@/lib/db';

interface ManageBeatmapsContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface ManageTournamentBeatmapsArgs {
  input: TournamentBeatmapAdminMutationInput;
  context: ManageBeatmapsContext;
}

export async function manageTournamentBeatmapsAdminHandler({
  input,
  context,
}: ManageTournamentBeatmapsArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const tournament = await context.db.query.tournaments.findFirst({
    columns: { id: true, ruleset: true },
    where: eq(schema.tournaments.id, input.tournamentId),
  });

  if (!tournament) {
    throw new ORPCError('NOT_FOUND', {
      message: 'Tournament not found',
    });
  }

  const addOsuIds = Array.from(new Set(input.addBeatmapOsuIds));
  const removeIds = Array.from(new Set(input.removeBeatmapIds));

  let addedCount = 0;
  let skippedCount = 0;

  if (addOsuIds.length === 0 && removeIds.length === 0) {
    return {
      success: true,
      addedCount,
      skippedCount,
    } as const;
  }

  const correlationId = getCorrelationId(context);

  await context.db.transaction(async (tx) => {
    const beatmapsToQueue = new Set<number>();

    if (addOsuIds.length > 0) {
      const existingBeatmaps = await tx
        .select({
          id: schema.beatmaps.id,
          osuId: schema.beatmaps.osuId,
          dataFetchStatus: schema.beatmaps.dataFetchStatus,
        })
        .from(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, addOsuIds));

      const existingMap = new Map<
        number,
        { id: number; dataFetchStatus: number }
      >();
      existingBeatmaps.forEach((beatmap) => {
        existingMap.set(Number(beatmap.osuId), {
          id: beatmap.id,
          dataFetchStatus: beatmap.dataFetchStatus,
        });
      });

      const missingOsuIds = addOsuIds.filter(
        (osuId) => !existingMap.has(osuId)
      );

      if (missingOsuIds.length > 0) {
        const placeholderRows = missingOsuIds.map((osuId) =>
          createPlaceholderBeatmap(osuId, tournament.ruleset as Ruleset)
        );

        if (placeholderRows.length > 0) {
          const insertedBeatmaps = await tx
            .insert(schema.beatmaps)
            .values(placeholderRows)
            .onConflictDoNothing({
              target: schema.beatmaps.osuId,
            })
            .returning({
              id: schema.beatmaps.id,
              osuId: schema.beatmaps.osuId,
              dataFetchStatus: schema.beatmaps.dataFetchStatus,
            });

          insertedBeatmaps.forEach((beatmap) => {
            existingMap.set(Number(beatmap.osuId), {
              id: beatmap.id,
              dataFetchStatus: beatmap.dataFetchStatus,
            });
          });
        }

        if (missingOsuIds.some((osuId) => !existingMap.has(osuId))) {
          const refreshedBeatmaps = await tx
            .select({
              id: schema.beatmaps.id,
              osuId: schema.beatmaps.osuId,
              dataFetchStatus: schema.beatmaps.dataFetchStatus,
            })
            .from(schema.beatmaps)
            .where(inArray(schema.beatmaps.osuId, missingOsuIds));

          refreshedBeatmaps.forEach((beatmap) => {
            existingMap.set(Number(beatmap.osuId), {
              id: beatmap.id,
              dataFetchStatus: beatmap.dataFetchStatus,
            });
          });
        }

        missingOsuIds.forEach((osuId) => beatmapsToQueue.add(osuId));
      }

      const beatmapIdsForJoin = addOsuIds
        .map((osuId) => {
          const record = existingMap.get(osuId);
          if (!record) {
            return null;
          }

          return {
            pooledBeatmapsId: record.id,
            tournamentsPooledInId: input.tournamentId,
          } satisfies typeof schema.joinPooledBeatmaps.$inferInsert;
        })
        .filter(Boolean) as (typeof schema.joinPooledBeatmaps.$inferInsert)[];

      if (beatmapIdsForJoin.length > 0) {
        const beatmapIds = beatmapIdsForJoin.map(
          (value) => value.pooledBeatmapsId
        );

        const existingJoins = await tx
          .select({
            beatmapId: schema.joinPooledBeatmaps.pooledBeatmapsId,
          })
          .from(schema.joinPooledBeatmaps)
          .where(
            and(
              eq(
                schema.joinPooledBeatmaps.tournamentsPooledInId,
                input.tournamentId
              ),
              inArray(schema.joinPooledBeatmaps.pooledBeatmapsId, beatmapIds)
            )
          );

        const existingJoinSet = new Set(
          existingJoins.map((row) => row.beatmapId)
        );

        const joinValues = beatmapIdsForJoin.filter(
          (value) => !existingJoinSet.has(value.pooledBeatmapsId)
        );

        skippedCount += beatmapIdsForJoin.length - joinValues.length;

        if (joinValues.length > 0) {
          await tx
            .insert(schema.joinPooledBeatmaps)
            .values(joinValues)
            .onConflictDoNothing();

          addedCount += joinValues.length;
        }
      }

      addOsuIds.forEach((osuId) => {
        const record = existingMap.get(osuId);
        if (!record) {
          return;
        }

        if (
          record.dataFetchStatus === DataFetchStatus.NotFetched ||
          record.dataFetchStatus === DataFetchStatus.Error
        ) {
          beatmapsToQueue.add(osuId);
        }
      });
    }

    if (removeIds.length > 0) {
      await tx
        .delete(schema.joinPooledBeatmaps)
        .where(
          and(
            eq(
              schema.joinPooledBeatmaps.tournamentsPooledInId,
              input.tournamentId
            ),
            inArray(schema.joinPooledBeatmaps.pooledBeatmapsId, removeIds)
          )
        );
    }

    await enqueueJobs(
      tx,
      JobQueue.OsuFetch,
      Array.from(beatmapsToQueue, (beatmapId) => ({
        payload: { type: 'beatmap', beatmapId },
        correlationId,
        tournamentId: input.tournamentId,
        requestedByUserId: adminUserId,
        explicit: true,
      }))
    );
  });

  return {
    success: true,
    addedCount,
    skippedCount,
  } as const;
}

export const manageTournamentBeatmapsAdmin = adminMutationProcedure
  .input(TournamentBeatmapAdminMutationInputSchema)
  .output(TournamentBeatmapAdminMutationResponseSchema)
  .route({
    summary: 'Manage tournament beatmaps',
    tags: ['admin'],
    method: 'POST',
    path: '/tournaments/beatmaps:manage',
  })
  .handler(async ({ input, context }) =>
    manageTournamentBeatmapsAdminHandler({ input, context })
  );
