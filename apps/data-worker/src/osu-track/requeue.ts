import { and, eq, max, ne, sql } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJob, JobQueue } from '@otr/core/jobs';

import type { DatabaseClient } from '../db';
import { claimPlayerFetchLease } from '../osu/player-store';

/**
 * Queues an osu!track fetch for a player whose last one finished before some
 * of their ruleset data existed. osu!track ranks are saved onto that data, so
 * the earlier fetch dropped the ranks for those rulesets. A new player's
 * osu!track fetch usually runs days before their first profile fetch.
 *
 * A player osu!track has never fetched is left to the refetch scheduler, and
 * one with a fetch already queued is left to that fetch. Returns whether it
 * queued one.
 */
export const requeueOsuTrackForNewRulesetData = async (
  db: DatabaseClient,
  osuPlayerId: number
): Promise<boolean> => {
  const [player] = await db
    .select({
      status: schema.players.osuTrackDataFetchStatus,
      lastFetch: schema.players.osuTrackLastFetch,
      missedRulesetData: sql<boolean>`${schema.players.osuTrackLastFetch} < ${max(schema.playerOsuRulesetData.created)}`,
    })
    .from(schema.players)
    .innerJoin(
      schema.playerOsuRulesetData,
      eq(schema.playerOsuRulesetData.playerId, schema.players.id)
    )
    .where(
      and(
        eq(schema.players.osuId, osuPlayerId),
        // The lease's job reads the ruleset data when it runs.
        ne(schema.players.osuTrackDataFetchStatus, DataFetchStatus.Fetching)
      )
    )
    .groupBy(schema.players.id);

  if (!player?.missedRulesetData) {
    return false;
  }

  // Claimed with the job, as the refetch scheduler does, so the scheduler
  // does not queue the player again while this fetch waits.
  return db.transaction(async (tx) => {
    if (
      !(await claimPlayerFetchLease(
        tx,
        'osuTrack',
        osuPlayerId,
        player,
        new Date().toISOString()
      ))
    ) {
      return false;
    }

    await enqueueJob(tx, JobQueue.OsuTrackFetch, {
      payload: { osuPlayerId },
      priority: MessagePriority.Low,
    });
    return true;
  });
};
