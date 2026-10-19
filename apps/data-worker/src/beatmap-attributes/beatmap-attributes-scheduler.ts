import { sql, type SQL } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJob, JobQueue, JobStatus } from '@otr/core/jobs';
import { isWithinMaintenanceWindow } from '@otr/core/maintenance';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import { withoutTracing } from '@otr/core/tracing';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';
import { CALCULATOR } from './calculator';
import { neededAttributeModsSql } from './needed-mods';

const SWEEP_INTERVAL_MS = 10 * 60_000;
// Finding the beatmaps that need attributes scans every score of every
// verified game, so once that finds nothing the sweep looks again only after
// this long. Fetch jobs calculate their own attributes in the meantime.
export const NEEDING_ATTRIBUTES_RECHECK_MS = 60 * 60_000;
// Keeps the sweep's queries out of startup.
const FIRST_SWEEP_DELAY_MS = 60_000;
// The JobQueueDepthHigh alert fires above 1,000 jobs in this queue.
export const SWEEP_BATCH_SIZE = 1_000;

type QueryExecutor = Pick<DatabaseClient, 'execute'>;

const beatmapIds = async (db: QueryExecutor, query: SQL) => {
  const { rows } = await db.execute<{ beatmap_id: number }>(query);
  return rows.map((row) => row.beatmap_id);
};

/**
 * osu! standard beatmaps with a usable stored file that lack a row from this
 * calculator for some needed key. Ascending id.
 */
export const findBeatmapsNeedingAttributes = (
  db: QueryExecutor,
  limit: number
) => {
  const needed = neededAttributeModsSql(
    (beatmapId) => sql`exists (
      select 1 from ${schema.beatmapFiles}
      where ${schema.beatmapFiles.beatmapId} = ${beatmapId}
        and ${schema.beatmapFiles.checksum} is not null
        and ${schema.beatmapFiles.fetchStatus} <> ${DataFetchStatus.Error}
    )`
  );

  return beatmapIds(
    db,
    sql`select distinct needed.beatmap_id
      from (${needed}) needed
      where not exists (
        select 1 from ${schema.beatmapAttributes}
        where ${schema.beatmapAttributes.beatmapId} = needed.beatmap_id
          and ${schema.beatmapAttributes.mods} = needed.mods
          and ${schema.beatmapAttributes.calculator} = ${CALCULATOR}
      )
      order by needed.beatmap_id
      limit ${limit}`
  );
};

/**
 * Fetched beatmaps that a game or a pool uses and that have no file row yet:
 * osu! standard beatmaps with verified osu! standard games first, then the
 * newest.
 */
export const findBeatmapsMissingFiles = (db: QueryExecutor, limit: number) => {
  const hasVerifiedOsuGame = sql`(${schema.beatmaps.ruleset} = ${Ruleset.Osu} and exists (
    select 1 from ${schema.games}
    where ${schema.games.beatmapId} = ${schema.beatmaps.id}
      and ${schema.games.verificationStatus} = ${VerificationStatus.Verified}
      and ${schema.games.ruleset} = ${Ruleset.Osu}
  ))`;

  return beatmapIds(
    db,
    sql`select ${schema.beatmaps.id} as beatmap_id
      from ${schema.beatmaps}
      where ${schema.beatmaps.dataFetchStatus} = ${DataFetchStatus.Fetched}
        and not exists (
          select 1 from ${schema.beatmapFiles}
          where ${schema.beatmapFiles.beatmapId} = ${schema.beatmaps.id}
        )
        and (
          exists (
            select 1 from ${schema.games}
            where ${schema.games.beatmapId} = ${schema.beatmaps.id}
          )
          or exists (
            select 1 from ${schema.joinPooledBeatmaps}
            where ${schema.joinPooledBeatmaps.pooledBeatmapsId} = ${schema.beatmaps.id}
          )
        )
      order by ${hasVerifiedOsuGame} desc, ${schema.beatmaps.id} desc
      limit ${limit}`
  );
};

/**
 * Whether an attribute job is waiting to run now. Running jobs and retries
 * still in their backoff don't count.
 */
const hasReadyJob = async (db: QueryExecutor) => {
  const { rows } = await db.execute<{ ready: boolean }>(
    sql`select exists (
      select 1 from jobs
      where queue = ${JobQueue.BeatmapAttributes}
        and status = ${JobStatus.Pending}
        and run_after <= now()
    ) as ready`
  );
  return rows[0]?.ready === true;
};

type IntervalHandle = ReturnType<typeof setInterval> | null;
type TimeoutHandle = ReturnType<typeof setTimeout> | null;

interface BeatmapAttributesSchedulerOptions {
  db: DatabaseClient;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
  now?: () => Date;
}

export interface BeatmapAttributesSweepResult {
  skipped?: 'maintenance' | 'queue_not_empty';
  needingAttributes: number;
  missingFiles: number;
}

/**
 * Every 10 minutes, while no attribute job is ready to run, queues
 * low-priority jobs for beatmaps whose attributes are missing or from another
 * calculator, then for beatmaps with no stored file. Fetch-hook jobs run
 * first, at normal priority. A sweep job gets one attempt, and its handler
 * drops it on failure: the next sweep finds the beatmap again.
 */
export class BeatmapAttributesScheduler {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly maintenanceWindowEnabled: boolean;
  private readonly now: () => Date;

  private firstSweep: TimeoutHandle = null;
  private interval: IntervalHandle = null;
  private inFlight: Promise<void> | null = null;
  private started = false;
  // When the last search for beatmaps needing attributes found none.
  private nothingNeededAt: number | null = null;

  constructor(options: BeatmapAttributesSchedulerOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.maintenanceWindowEnabled = options.maintenanceWindowEnabled;
    this.now = options.now ?? (() => new Date());
  }

  start() {
    if (this.started) {
      throw new Error('BeatmapAttributesScheduler already started');
    }

    this.started = true;
    this.firstSweep = setTimeout(() => {
      this.firstSweep = null;
      void this.sweepSafely();
    }, FIRST_SWEEP_DELAY_MS);
    this.interval = setInterval(() => {
      void this.sweepSafely();
    }, SWEEP_INTERVAL_MS);
  }

  async stop() {
    if (!this.started) {
      return;
    }

    if (this.firstSweep) {
      clearTimeout(this.firstSweep);
      this.firstSweep = null;
    }

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    await this.inFlight?.catch(() => undefined);

    this.started = false;
  }

  private sweepSafely() {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.sweep()
      .then(() => undefined)
      .catch((error) => {
        this.logger.error('Failed to queue beatmap attribute jobs', { error });
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  async sweep(): Promise<BeatmapAttributesSweepResult> {
    if (
      this.maintenanceWindowEnabled &&
      isWithinMaintenanceWindow(this.now())
    ) {
      return { skipped: 'maintenance', needingAttributes: 0, missingFiles: 0 };
    }

    // A sweep job merges into a waiting or running job for the same beatmap,
    // so jobs still in a retry's backoff can't come back as duplicates.
    if (await hasReadyJob(this.db)) {
      return {
        skipped: 'queue_not_empty',
        needingAttributes: 0,
        missingFiles: 0,
      };
    }

    const now = this.now().getTime();
    let needingAttributes: number[] = [];

    if (
      this.nothingNeededAt === null ||
      now - this.nothingNeededAt >= NEEDING_ATTRIBUTES_RECHECK_MS
    ) {
      needingAttributes = await findBeatmapsNeedingAttributes(
        this.db,
        SWEEP_BATCH_SIZE
      );
      this.nothingNeededAt = needingAttributes.length === 0 ? now : null;
    }

    const missingFiles =
      needingAttributes.length < SWEEP_BATCH_SIZE
        ? await findBeatmapsMissingFiles(
            this.db,
            SWEEP_BATCH_SIZE - needingAttributes.length
          )
        : [];

    // One job per statement keeps the jobs in this order, which is the order
    // they run in. One transaction commits them together and wakes the
    // runner once. Untraced, so a sweep is not a thousand spans.
    const queued = [...needingAttributes, ...missingFiles];
    if (queued.length > 0) {
      await withoutTracing(() =>
        this.db.transaction(async (tx) => {
          for (const beatmapId of queued) {
            await enqueueJob(tx, JobQueue.BeatmapAttributes, {
              payload: { beatmapId },
              priority: MessagePriority.Low,
              maxAttempts: 1,
            });
          }
        })
      );
    }

    if (needingAttributes.length + missingFiles.length > 0) {
      this.logger.info('Queued beatmap attribute jobs', {
        needingAttributes: needingAttributes.length,
        missingFiles: missingFiles.length,
      });
    }

    return {
      needingAttributes: needingAttributes.length,
      missingFiles: missingFiles.length,
    };
  }
}
