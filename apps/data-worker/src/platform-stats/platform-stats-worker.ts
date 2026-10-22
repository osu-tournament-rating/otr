import { JobQueue } from '@otr/core/jobs';
import { refreshPlatformStats } from '@otr/core/platform-stats';

import type { DatabaseClient } from '../db';
import { pauseForMaintenanceWindow } from '../jobs/maintenance';
import type { ClaimedJob, QueueRegistration } from '../jobs/types';
import type { Logger } from '../logging/logger';

interface PlatformStatsWorkerOptions {
  db: DatabaseClient;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
  now?: () => Date;
}

/**
 * Runs processing.stats.platform jobs: computes the platform stats that are
 * due and saves each one. A statistic that fails fails the job, which
 * retries the ones still due.
 */
export class PlatformStatsWorker {
  private readonly options: PlatformStatsWorkerOptions;

  constructor(options: PlatformStatsWorkerOptions) {
    this.options = options;
  }

  registration(): QueueRegistration<JobQueue.PlatformStats> {
    return {
      queue: JobQueue.PlatformStats,
      handler: (job) => this.handle(job),
      // The rating run truncates and rewrites the rating tables in the
      // window, so reading them then would wait on its locks or delay it.
      pausedUntil: pauseForMaintenanceWindow(
        this.options.maintenanceWindowEnabled
      ),
    };
  }

  async handle(job: ClaimedJob<JobQueue.PlatformStats>) {
    const { db, logger, now = () => new Date() } = this.options;
    const jobLogger = logger.child({ correlationId: job.correlationId });

    const { refreshed, failed } = await refreshPlatformStats(db, {
      now: now(),
    });

    if (refreshed.length > 0) {
      jobLogger.info('Refreshed platform stats', { refreshed });
    }

    if (failed.length > 0) {
      for (const { key, error } of failed) {
        jobLogger.error('Failed to compute a platform stat', { key, error });
      }
      throw new Error(
        `Could not compute ${failed.map(({ key }) => key).join(', ')}`
      );
    }
  }
}
