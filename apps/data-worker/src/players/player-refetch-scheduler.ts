import { and, asc, eq, isNull, lt, ne, or } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJob, JobQueue } from '@otr/core/jobs';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';
import {
  claimPlayerFetchLease,
  type PlayerFetchSource,
  type PlayerFetchState,
} from '../osu/player-store';
import {
  fetchLeaseCutoff,
  selectPlayersDueForOsuRefetch,
  type OsuRefetchCadence,
} from './osu-refetch-cadence';

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

type AutoRefetchConfig = {
  enabled: boolean;
  intervalMinutes: number;
  outdatedDays: number;
};

type SchedulerConfig = {
  osu: AutoRefetchConfig & OsuRefetchCadence;
  osuTrack: AutoRefetchConfig;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

type IntervalHandle = ReturnType<typeof setInterval> | null;

interface PlayerRefetchSchedulerOptions {
  db: DatabaseClient;
  logger: Logger;
  config: SchedulerConfig;
}

export class PlayerRefetchScheduler {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly config: SchedulerConfig;

  private osuInterval: IntervalHandle = null;
  private osuTrackInterval: IntervalHandle = null;
  private osuInFlight: Promise<void> | null = null;
  private osuTrackInFlight: Promise<void> | null = null;
  private started = false;

  constructor(options: PlayerRefetchSchedulerOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.config = options.config;
  }

  async start() {
    if (this.started) {
      throw new Error('PlayerRefetchScheduler already started');
    }

    this.started = true;

    if (this.config.osu.enabled) {
      const osuIntervalMs = this.config.osu.intervalMinutes * MS_PER_MINUTE;
      await this.runOsuRefetchSafely();
      this.osuInterval = setInterval(() => {
        void this.runOsuRefetchSafely();
      }, osuIntervalMs);
    }

    if (this.config.osuTrack.enabled) {
      const osuTrackIntervalMs =
        this.config.osuTrack.intervalMinutes * MS_PER_MINUTE;
      await this.runOsuTrackRefetchSafely();
      this.osuTrackInterval = setInterval(() => {
        void this.runOsuTrackRefetchSafely();
      }, osuTrackIntervalMs);
    }
  }

  async stop() {
    if (!this.started) {
      return;
    }

    if (this.osuInterval) {
      clearInterval(this.osuInterval);
      this.osuInterval = null;
    }

    if (this.osuTrackInterval) {
      clearInterval(this.osuTrackInterval);
      this.osuTrackInterval = null;
    }

    await Promise.allSettled([
      this.osuInFlight?.catch(() => undefined),
      this.osuTrackInFlight?.catch(() => undefined),
    ]);

    this.started = false;
  }

  private runOsuRefetchSafely() {
    if (this.osuInFlight) {
      return this.osuInFlight;
    }

    this.osuInFlight = this.runOsuRefetch()
      .catch((error) => {
        this.logger.error('Failed to enqueue outdated osu! players', { error });
      })
      .finally(() => {
        this.osuInFlight = null;
      });

    return this.osuInFlight;
  }

  private runOsuTrackRefetchSafely() {
    if (this.osuTrackInFlight) {
      return this.osuTrackInFlight;
    }

    this.osuTrackInFlight = this.runOsuTrackRefetch()
      .catch((error) => {
        this.logger.error('Failed to enqueue outdated osu!track players', {
          error,
        });
      })
      .finally(() => {
        this.osuTrackInFlight = null;
      });

    return this.osuTrackInFlight;
  }

  private async runOsuRefetch() {
    const players = await selectPlayersDueForOsuRefetch(
      this.db,
      this.config.osu
    );

    const enqueuedByCadence = new Map<number, number>();

    const enqueued = await this.enqueuePlayers({
      players,
      publish: async (tx, osuPlayerId, player) => {
        const cadence = Number(player.cadenceDays);
        await enqueueJob(tx, JobQueue.OsuFetch, {
          payload: { type: 'player', osuPlayerId },
          priority: cadence <= 1 ? MessagePriority.Normal : MessagePriority.Low,
        });
        enqueuedByCadence.set(
          cadence,
          (enqueuedByCadence.get(cadence) ?? 0) + 1
        );
      },
      source: 'osu',
      logContext: 'osu!',
    });

    if (enqueued.count > 0) {
      this.logger.info('Auto-refetch enqueued osu! players', {
        count: enqueued.count,
        expiredLeases: enqueued.expiredLeases,
        byCadenceDays: Object.fromEntries(
          [...enqueuedByCadence.entries()].sort((a, b) => a[0] - b[0])
        ),
      });
    }
  }

  private async runOsuTrackRefetch() {
    const cutoffIso = this.calculateCutoff(this.config.osuTrack.outdatedDays);
    const players = await this.db
      .select({
        osuPlayerId: schema.players.osuId,
        status: schema.players.osuTrackDataFetchStatus,
        lastFetch: schema.players.osuTrackLastFetch,
      })
      .from(schema.players)
      .where(
        or(
          isNull(schema.players.osuTrackLastFetch),
          and(
            ne(
              schema.players.osuTrackDataFetchStatus,
              DataFetchStatus.Fetching
            ),
            lt(schema.players.osuTrackLastFetch, cutoffIso)
          ),
          and(
            eq(
              schema.players.osuTrackDataFetchStatus,
              DataFetchStatus.Fetching
            ),
            lt(schema.players.osuTrackLastFetch, fetchLeaseCutoff())
          )
        )
      )
      .orderBy(asc(schema.players.osuTrackLastFetch));

    const enqueued = await this.enqueuePlayers({
      players,
      publish: async (tx, osuPlayerId) => {
        await enqueueJob(tx, JobQueue.OsuTrackFetch, {
          payload: { osuPlayerId },
          priority: MessagePriority.Low,
        });
      },
      source: 'osuTrack',
      logContext: 'osu!track',
    });

    if (enqueued.count > 0) {
      this.logger.info('Auto-refetch enqueued osu!track players', {
        count: enqueued.count,
        expiredLeases: enqueued.expiredLeases,
      });
    }
  }

  private async enqueuePlayers<
    TPlayer extends PlayerFetchState & { osuPlayerId: number },
  >(options: {
    players: Array<TPlayer>;
    publish: (
      tx: Transaction,
      osuPlayerId: number,
      player: TPlayer
    ) => Promise<void>;
    source: PlayerFetchSource;
    logContext: string;
  }): Promise<{ count: number; expiredLeases: number }> {
    let count = 0;
    let expiredLeases = 0;

    for (const player of options.players) {
      const osuPlayerId = player.osuPlayerId;
      // The lease and the job commit together, so a failed enqueue leaves
      // the player as it was. Claimed first, so the lease never lands on top
      // of a fetch that a fast worker has already finished.
      const leaseIso = new Date().toISOString();

      try {
        const claimed = await this.db.transaction(async (tx) => {
          if (
            !(await claimPlayerFetchLease(
              tx,
              options.source,
              osuPlayerId,
              player,
              leaseIso
            ))
          ) {
            return false;
          }
          await options.publish(tx, osuPlayerId, player);
          return true;
        });
        if (!claimed) {
          continue;
        }
        count += 1;
        if (player.status === DataFetchStatus.Fetching) {
          expiredLeases += 1;
        }
      } catch (error) {
        this.logger.error('Failed to publish auto-refetch player', {
          osuPlayerId,
          queue: options.logContext,
          error,
        });
      }
    }

    return { count, expiredLeases };
  }

  private calculateCutoff(outdatedDays: number) {
    const cutoff = new Date(Date.now() - outdatedDays * MS_PER_DAY);
    return cutoff.toISOString();
  }
}
