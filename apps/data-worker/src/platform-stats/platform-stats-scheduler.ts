import { enqueueJob, JobQueue } from '@otr/core/jobs';
import { isWithinMaintenanceWindow } from '@otr/core/maintenance';
import { findDuePlatformStats } from '@otr/core/platform-stats';
import { withoutTracing } from '@otr/core/tracing';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';

const CHECK_INTERVAL_MS = 10 * 60_000;
// Keeps the first check out of startup.
const FIRST_CHECK_DELAY_MS = 60_000;

interface PlatformStatsSchedulerOptions {
  db: DatabaseClient;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
  now?: () => Date;
}

export type PlatformStatsCheck = 'maintenance' | 'fresh' | 'queued';

/**
 * Every 10 minutes, queues a platform stats refresh when a statistic is due:
 * one is missing or of an old version, or was computed before the current
 * UTC day or the latest rating run began. So the stats refresh daily after
 * midnight UTC, after each Tuesday run once the maintenance window ends, and
 * right after a deploy that adds or changes one.
 */
export class PlatformStatsScheduler {
  private readonly options: PlatformStatsSchedulerOptions;
  private firstCheck: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: PlatformStatsSchedulerOptions) {
    this.options = options;
  }

  start() {
    this.firstCheck = setTimeout(
      () => void this.checkSafely(),
      FIRST_CHECK_DELAY_MS
    );
    this.interval = setInterval(
      () => void this.checkSafely(),
      CHECK_INTERVAL_MS
    );
  }

  async stop() {
    if (this.firstCheck) clearTimeout(this.firstCheck);
    if (this.interval) clearInterval(this.interval);
    await this.inFlight;
  }

  private checkSafely() {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = withoutTracing(() => this.check())
      .then(() => undefined)
      .catch((error) => {
        this.options.logger.error('Failed to check the platform stats', {
          error,
        });
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  async check(): Promise<PlatformStatsCheck> {
    const {
      db,
      logger,
      maintenanceWindowEnabled,
      now = () => new Date(),
    } = this.options;
    const at = now();

    // The rating run rewrites the rating tables in the window.
    if (maintenanceWindowEnabled && isWithinMaintenanceWindow(at)) {
      return 'maintenance';
    }

    const due = await findDuePlatformStats(db, at);
    if (due.length === 0) {
      return 'fresh';
    }

    // Merges into a refresh that is already waiting or running.
    await enqueueJob(db, JobQueue.PlatformStats, { payload: {} });
    logger.info('Queued a platform stats refresh', {
      due: due.map((definition) => definition.key),
    });
    return 'queued';
  }
}
