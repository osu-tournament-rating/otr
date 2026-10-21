import { inArray, sql } from 'drizzle-orm';
import { eventIterator } from '@orpc/server';

import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { withAuditUserId } from '@otr/core/db';
import { MessagePriority } from '@otr/core';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import {
  AdminMassEnqueueInputSchema,
  AdminMassEnqueueProgressEventSchema,
  type AdminMassEnqueueInput,
} from '@/lib/orpc/schema/admin';
import type { DatabaseClient } from '@/lib/db';

import { adminMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';
import { getCorrelationId } from '../logging/helpers';

const NOW = sql`CURRENT_TIMESTAMP`;
const BATCH_SIZE = 500;

interface MassEnqueueContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface MassEnqueueArgs {
  input: AdminMassEnqueueInput;
  context: MassEnqueueContext;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Mass-enqueues beatmaps, matches, and players for refetch, yielding progress
 * events. Each beatmap and match batch resets its rows and queues their
 * fetches in one transaction, so a failure leaves earlier batches queued and
 * no row reset without a job.
 */
export async function* massEnqueueHandler({ input, context }: MassEnqueueArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const { beatmapIds, matchIds, playerIds, priority } = input;

  const priorityValue = (() => {
    switch (priority) {
      case 'Low':
        return MessagePriority.Low;
      case 'High':
        return MessagePriority.High;
      case 'Normal':
      default:
        return MessagePriority.Normal;
    }
  })();

  const correlationId = getCorrelationId(context);
  const jobOptions = {
    priority: priorityValue,
    correlationId,
    requestedByUserId: adminUserId,
    explicit: true,
  };
  let beatmapsUpdated = 0;
  let beatmapsSkipped = 0;
  let matchesUpdated = 0;
  let matchesSkipped = 0;
  let playersUpdated = 0;
  let playersSkipped = 0;

  if (beatmapIds.length > 0) {
    const uniqueBeatmapIds = Array.from(new Set(beatmapIds));

    const existingBeatmaps = await context.db
      .select({
        id: schema.beatmaps.id,
        osuId: schema.beatmaps.osuId,
        dataFetchStatus: schema.beatmaps.dataFetchStatus,
      })
      .from(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, uniqueBeatmapIds));

    const beatmapsToUpdate = existingBeatmaps.filter(
      (b) => b.dataFetchStatus !== DataFetchStatus.NotFound
    );

    beatmapsSkipped = uniqueBeatmapIds.length - beatmapsToUpdate.length;

    const beatmapChunks = chunkArray(beatmapsToUpdate, BATCH_SIZE);
    const totalBatches = beatmapChunks.length;
    const shouldYieldProgress = totalBatches >= 2;

    for (let i = 0; i < beatmapChunks.length; i++) {
      const chunk = beatmapChunks[i];
      if (!chunk) continue;

      await context.db.transaction((tx) =>
        withAuditUserId(tx, adminUserId, async () => {
          await tx
            .update(schema.beatmaps)
            .set({
              dataFetchStatus: DataFetchStatus.NotFetched,
              updated: NOW,
            })
            .where(
              inArray(
                schema.beatmaps.id,
                chunk.map((b) => b.id)
              )
            );

          await enqueueJobs(
            tx,
            JobQueue.OsuFetch,
            chunk.map((b) => ({
              ...jobOptions,
              payload: {
                type: 'beatmap',
                beatmapId: b.osuId,
                skipAutomationChecks: false,
              },
            }))
          );
        })
      );

      beatmapsUpdated += chunk.length;

      if (shouldYieldProgress) {
        const itemsProcessed = (i + 1) * BATCH_SIZE;
        yield {
          type: 'progress' as const,
          phase: 'beatmaps' as const,
          currentBatch: i + 1,
          totalBatches,
          itemsProcessed: Math.min(itemsProcessed, beatmapsToUpdate.length),
          totalItems: beatmapsToUpdate.length,
          message: `Processing beatmaps (Batch ${i + 1} of ${totalBatches})`,
        };
      }
    }
  }

  if (matchIds.length > 0) {
    const uniqueMatchIds = Array.from(new Set(matchIds));

    const existingMatches = await context.db
      .select({
        id: schema.matches.id,
        osuId: schema.matches.osuId,
        isLazer: schema.matches.isLazer,
        tournamentId: schema.matches.tournamentId,
        dataFetchStatus: schema.matches.dataFetchStatus,
      })
      .from(schema.matches)
      .where(inArray(schema.matches.osuId, uniqueMatchIds));

    const matchesToUpdate = existingMatches.filter(
      (m) => m.dataFetchStatus !== DataFetchStatus.NotFound
    );

    matchesSkipped = uniqueMatchIds.length - matchesToUpdate.length;

    const matchChunks = chunkArray(matchesToUpdate, BATCH_SIZE);
    const totalBatches = matchChunks.length;
    const shouldYieldProgress = totalBatches >= 2;

    for (let i = 0; i < matchChunks.length; i++) {
      const chunk = matchChunks[i];
      if (!chunk) continue;

      await context.db.transaction((tx) =>
        withAuditUserId(tx, adminUserId, async () => {
          await tx
            .update(schema.matches)
            .set({
              dataFetchStatus: DataFetchStatus.NotFetched,
              updated: NOW,
            })
            .where(
              inArray(
                schema.matches.id,
                chunk.map((m) => m.id)
              )
            );

          await enqueueJobs(
            tx,
            JobQueue.OsuFetch,
            chunk.map((m) => ({
              ...jobOptions,
              payload: {
                type: 'match',
                osuMatchId: m.osuId,
                isLazer: m.isLazer,
              },
              tournamentId: m.tournamentId,
            }))
          );
        })
      );

      matchesUpdated += chunk.length;

      if (shouldYieldProgress) {
        const itemsProcessed = (i + 1) * BATCH_SIZE;
        yield {
          type: 'progress' as const,
          phase: 'matches' as const,
          currentBatch: i + 1,
          totalBatches,
          itemsProcessed: Math.min(itemsProcessed, matchesToUpdate.length),
          totalItems: matchesToUpdate.length,
          message: `Processing matches (Batch ${i + 1} of ${totalBatches})`,
        };
      }
    }
  }

  if (playerIds.length > 0) {
    const uniquePlayerIds = Array.from(new Set(playerIds));

    const existingPlayers = await context.db
      .select({
        osuId: schema.players.osuId,
        dataFetchStatus: schema.players.dataFetchStatus,
      })
      .from(schema.players)
      .where(inArray(schema.players.osuId, uniquePlayerIds));

    const playersToQueue = existingPlayers.filter(
      (p) => p.dataFetchStatus !== DataFetchStatus.NotFound
    );

    playersSkipped = uniquePlayerIds.length - playersToQueue.length;

    const playerChunks = chunkArray(playersToQueue, BATCH_SIZE);
    const totalBatches = playerChunks.length;
    const shouldYieldProgress = totalBatches >= 2;

    for (let i = 0; i < playerChunks.length; i++) {
      const chunk = playerChunks[i];
      if (!chunk) continue;

      // Player rows stay as they are: a player's status is the refetch
      // scheduler's lease, and the worker marks the player Fetching when the
      // job runs.
      await enqueueJobs(
        context.db,
        JobQueue.OsuFetch,
        chunk.map((p) => ({
          ...jobOptions,
          payload: { type: 'player', osuPlayerId: p.osuId },
        }))
      );

      playersUpdated += chunk.length;

      if (shouldYieldProgress) {
        const itemsProcessed = (i + 1) * BATCH_SIZE;
        yield {
          type: 'progress' as const,
          phase: 'players' as const,
          currentBatch: i + 1,
          totalBatches,
          itemsProcessed: Math.min(itemsProcessed, playersToQueue.length),
          totalItems: playersToQueue.length,
          message: `Processing players (Batch ${i + 1} of ${totalBatches})`,
        };
      }
    }
  }

  yield {
    type: 'complete' as const,
    beatmapsUpdated,
    beatmapsSkipped,
    matchesUpdated,
    matchesSkipped,
    playersUpdated,
    playersSkipped,
  };
}

export const massEnqueue = adminMutationProcedure
  .input(AdminMassEnqueueInputSchema)
  .output(eventIterator(AdminMassEnqueueProgressEventSchema))
  .route({
    summary:
      'Mass enqueue beatmap, match, and player refetch with progress updates',
    tags: ['admin'],
    method: 'POST',
    path: '/admin/mass-enqueue',
  })
  .handler(massEnqueueHandler);
