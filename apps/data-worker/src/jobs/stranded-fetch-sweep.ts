import { sql } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJobs, JobQueue, JobStatus } from '@otr/core/jobs';
import { isWithinMaintenanceWindow } from '@otr/core/maintenance';
import { withoutTracing } from '@otr/core/tracing';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';

const INTERVAL_MS = 60 * 60_000;
const FIRST_RUN_DELAY_MS = 2 * 60_000;
const BATCH_SIZE = 1_000;

const activeOsuJob = (dedupKey: ReturnType<typeof sql>) => sql`EXISTS (
  SELECT 1 FROM jobs
  WHERE queue = ${JobQueue.OsuFetch}
    AND status IN (${JobStatus.Pending}, ${JobStatus.Running})
    AND dedup_key = ${dedupKey}
)`;

interface StrandedFetchSweepOptions {
  db: Pick<DatabaseClient, 'execute'>;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
  /**
   * Also queue players left Fetching with no job. Follows automatic player
   * refetching, which is off on stacks and developer machines: their players
   * are copied from production without the jobs, so every Fetching player
   * there looks stranded.
   */
  players: boolean;
  now?: () => Date;
}

/**
 * Hourly: queues a fetch for every match and beatmap still waiting to be
 * fetched, and every player still Fetching, with no job to do it, such as one
 * whose queue message was lost before the move to the jobs table. Low
 * priority, so a backlog waits behind new submissions.
 */
export class StrandedFetchSweep {
  private readonly options: StrandedFetchSweepOptions;
  private firstRun: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: StrandedFetchSweepOptions) {
    this.options = options;
  }

  start() {
    this.firstRun = setTimeout(() => void this.runSafely(), FIRST_RUN_DELAY_MS);
    this.interval = setInterval(() => void this.runSafely(), INTERVAL_MS);
  }

  async stop() {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.interval) clearInterval(this.interval);
    await this.inFlight;
  }

  private runSafely() {
    if (!this.inFlight) {
      this.inFlight = withoutTracing(() => this.run())
        .then(() => undefined)
        .catch((error) => {
          this.options.logger.error('Failed to queue stranded fetches', {
            error,
          });
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  /** Returns how many matches, beatmaps, and players it queued. */
  async run(): Promise<{ matches: number; beatmaps: number; players: number }> {
    const {
      db,
      maintenanceWindowEnabled,
      now = () => new Date(),
    } = this.options;
    if (maintenanceWindowEnabled && isWithinMaintenanceWindow(now())) {
      return { matches: 0, beatmaps: 0, players: 0 };
    }

    const unfinished = sql`(${DataFetchStatus.NotFetched}, ${DataFetchStatus.Fetching})`;

    const { rows: matches } = await db.execute<{
      osu_id: string;
      is_lazer: boolean;
      tournament_id: number | null;
    }>(sql`
      SELECT m.osu_id, m.is_lazer, m.tournament_id
      FROM matches m
      WHERE m.data_fetch_status IN ${unfinished}
        AND NOT ${activeOsuJob(sql`'match:' || m.osu_id || ':' || CASE WHEN m.is_lazer THEN 'lazer' ELSE 'stable' END`)}
      ORDER BY m.id
      LIMIT ${BATCH_SIZE}`);

    const { rows: beatmaps } = await db.execute<{ osu_id: string }>(sql`
      SELECT b.osu_id
      FROM beatmaps b
      WHERE b.data_fetch_status IN ${unfinished}
        AND NOT b.manual_override
        AND NOT ${activeOsuJob(sql`'beatmap:' || b.osu_id`)}
        AND NOT ${activeOsuJob(sql`'beatmap:' || b.osu_id || ':nochecks'`)}
      ORDER BY b.id
      LIMIT ${BATCH_SIZE}`);

    // Only Fetching: a player who was never fetched waits for the refetch
    // scheduler instead. Longest stranded first.
    const { rows: players } = this.options.players
      ? await db.execute<{ osu_id: string }>(sql`
          SELECT p.osu_id
          FROM players p
          WHERE p.data_fetch_status = ${DataFetchStatus.Fetching}
            AND NOT ${activeOsuJob(sql`'player:' || p.osu_id`)}
          ORDER BY p.osu_last_fetch, p.id
          LIMIT ${BATCH_SIZE}`)
      : { rows: [] };

    await enqueueJobs(
      db,
      JobQueue.OsuFetch,
      matches.map((match) => ({
        payload: {
          type: 'match' as const,
          osuMatchId: Number(match.osu_id),
          isLazer: match.is_lazer,
        },
        tournamentId: match.tournament_id,
        priority: MessagePriority.Low,
      }))
    );
    await enqueueJobs(
      db,
      JobQueue.OsuFetch,
      beatmaps.map((beatmap) => ({
        payload: {
          type: 'beatmap' as const,
          beatmapId: Number(beatmap.osu_id),
        },
        priority: MessagePriority.Low,
      }))
    );
    await enqueueJobs(
      db,
      JobQueue.OsuFetch,
      players.map((player) => ({
        payload: {
          type: 'player' as const,
          osuPlayerId: Number(player.osu_id),
        },
        priority: MessagePriority.Low,
      }))
    );

    if (matches.length > 0 || beatmaps.length > 0 || players.length > 0) {
      this.options.logger.warn('Queued fetches that had no job', {
        matches: matches.length,
        beatmaps: beatmaps.length,
        players: players.length,
      });
    }

    return {
      matches: matches.length,
      beatmaps: beatmaps.length,
      players: players.length,
    };
  }
}
