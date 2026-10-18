import type { UserStatUpdate } from '@otr/core';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import * as schema from '@otr/core/db/schema';
import { JobQueue } from '@otr/core/jobs';
import { and, eq } from 'drizzle-orm';

import { PermanentJobError } from '../jobs/errors';
import { pauseForMaintenanceWindow } from '../jobs/maintenance';
import type {
  ClaimedJob,
  JobTransaction,
  QueueRegistration,
} from '../jobs/types';
import { consoleLogger, type Logger } from '../logging/logger';
import type { RateLimiter } from '../rate-limiter';
import { OsuTrackClient } from './client';

export interface OsuTrackPlayerWorkerEvents {
  onPlayer?: (details: {
    osuPlayerId: number;
    results: Array<{
      mode: number;
      updates: UserStatUpdate[];
    }>;
  }) => Promise<void> | void;
}

export interface OsuTrackPlayerWorkerOptions extends OsuTrackPlayerWorkerEvents {
  client: OsuTrackClient;
  rateLimiter: RateLimiter;
  logger?: Logger;
  maintenanceWindowEnabled: boolean;
}

const MODES = [0, 1, 2, 3];

/**
 * Runs data.osutrack jobs: fetches a player's rank history in every mode.
 *
 * A failed attempt leaves the player Fetching, so the refetch scheduler's
 * lease holds while the job waits to retry. Only a job that gives up, after
 * its last attempt or when that attempt's lease lapses, marks the player
 * Error, which frees the lease for the scheduler's next run.
 */
export class OsuTrackPlayerWorker {
  private readonly client: OsuTrackClient;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;
  private readonly events: OsuTrackPlayerWorkerEvents;
  private readonly maintenanceWindowEnabled: boolean;

  constructor(options: OsuTrackPlayerWorkerOptions) {
    this.client = options.client;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger ?? consoleLogger;
    this.events = {
      onPlayer: options.onPlayer,
    };
    this.maintenanceWindowEnabled = options.maintenanceWindowEnabled;
  }

  registration(): QueueRegistration<JobQueue.OsuTrackFetch> {
    return {
      queue: JobQueue.OsuTrackFetch,
      handler: (job) => this.handle(job),
      pausedUntil: pauseForMaintenanceWindow(this.maintenanceWindowEnabled),
      onGiveUp: (job, tx) => this.giveUp(job, tx),
    };
  }

  async handle(job: ClaimedJob<JobQueue.OsuTrackFetch>) {
    const { osuPlayerId } = job.payload;

    if (!Number.isInteger(osuPlayerId)) {
      throw new PermanentJobError(
        `The job has no osu! player id: ${JSON.stringify(job.payload)}`
      );
    }

    const jobLogger = this.logger.child({
      correlationId: job.correlationId,
      osuPlayerId,
    });

    jobLogger.info('processing osu!track player fetch');

    try {
      const results: Array<{ mode: number; updates: UserStatUpdate[] }> = [];

      for (const mode of MODES) {
        const updates = await this.rateLimiter.schedule(() =>
          this.client.fetchUserStatsHistory({ osuPlayerId, mode })
        );

        jobLogger.info('fetched osu!track updates', {
          mode,
          updateCount: updates.length,
        });

        results.push({ mode, updates });
      }
      await this.events.onPlayer?.({ osuPlayerId, results });

      const summary = results
        .map((entry) => `${entry.mode}:${entry.updates.length}`)
        .join(',');
      jobLogger.info('osu!track player fetch completed', { modes: summary });
    } catch (error) {
      jobLogger.error('failed to process osu!track player fetch', { error });
      throw error;
    }
  }

  /**
   * Marks the player's osu!track fetch errored while it is still Fetching,
   * so a fetch that finished some other way keeps its result. The last fetch
   * time moves to now, so the scheduler waits a full refetch interval before
   * trying the player again.
   */
  private async giveUp(
    job: ClaimedJob<JobQueue.OsuTrackFetch>,
    tx: JobTransaction
  ) {
    const nowIso = new Date().toISOString();

    await tx
      .update(schema.players)
      .set({
        osuTrackDataFetchStatus: DataFetchStatus.Error,
        osuTrackLastFetch: nowIso,
        updated: nowIso,
      })
      .where(
        and(
          eq(schema.players.osuId, job.payload.osuPlayerId),
          eq(schema.players.osuTrackDataFetchStatus, DataFetchStatus.Fetching)
        )
      );
  }
}
