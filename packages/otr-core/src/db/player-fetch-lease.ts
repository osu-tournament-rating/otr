import { and, eq, isNull, max, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { enqueueJob, JobQueue } from '../jobs';
import { MessagePriority } from '../messages/values';
import { DataFetchStatus } from './data-fetch-status';
import * as relations from './relations';
import * as schema from './schema';

type Database = NodePgDatabase<typeof schema & typeof relations>;

export type PlayerFetchSource = 'osu' | 'osuTrack';

/**
 * A player's fetch status for one source, and that source's last-fetch time.
 * While the status is Fetching, the last-fetch time is when the fetch lease
 * started.
 */
export interface PlayerFetchState {
  status: number;
  lastFetch: string | null;
}

const fetchStateMatches = (
  source: PlayerFetchSource,
  osuPlayerId: number,
  state: PlayerFetchState
) => {
  const statusColumn =
    source === 'osu'
      ? schema.players.dataFetchStatus
      : schema.players.osuTrackDataFetchStatus;
  const lastFetchColumn =
    source === 'osu'
      ? schema.players.osuLastFetch
      : schema.players.osuTrackLastFetch;

  return and(
    eq(schema.players.osuId, osuPlayerId),
    eq(statusColumn, state.status),
    state.lastFetch === null
      ? isNull(lastFetchColumn)
      : eq(lastFetchColumn, state.lastFetch)
  );
};

const fetchStateValues = (
  source: PlayerFetchSource,
  state: PlayerFetchState,
  updatedIso: string
) =>
  source === 'osu'
    ? {
        dataFetchStatus: state.status,
        osuLastFetch: state.lastFetch ?? undefined,
        updated: updatedIso,
      }
    : {
        osuTrackDataFetchStatus: state.status,
        osuTrackLastFetch: state.lastFetch,
        updated: updatedIso,
      };

/**
 * Marks the player Fetching for `source` and records `leaseIso` as the lease
 * start. Applies only while the row still matches `previous`, so a fetch that
 * started or finished after `previous` was read is never overwritten.
 */
export const claimPlayerFetchLease = async (
  db: Pick<Database, 'update'>,
  source: PlayerFetchSource,
  osuPlayerId: number,
  previous: PlayerFetchState,
  leaseIso: string
): Promise<boolean> => {
  const claimed = await db
    .update(schema.players)
    .set(
      fetchStateValues(
        source,
        { status: DataFetchStatus.Fetching, lastFetch: leaseIso },
        leaseIso
      )
    )
    .where(fetchStateMatches(source, osuPlayerId, previous))
    .returning({ id: schema.players.id });

  return claimed.length > 0;
};

/**
 * Queues an osu!track fetch for a player whose last one finished before some
 * of their ruleset data existed. osu!track ranks are saved onto that data, so
 * the earlier fetch dropped the ranks for those rulesets. A new player's
 * osu!track fetch usually runs days before their first profile fetch. The
 * data worker's profile fetch and sign-in both call this after saving
 * ruleset data.
 *
 * A player osu!track has never fetched is left to the refetch scheduler, and
 * one with a fetch already queued is left to that fetch. Returns whether it
 * queued one.
 */
export const requeueOsuTrackForNewRulesetData = async (
  db: Pick<Database, 'select' | 'transaction'>,
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
