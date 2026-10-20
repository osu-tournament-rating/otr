import { sql } from 'drizzle-orm';
import { JobStatus, recountEnqueuedSql } from '@otr/core/jobs';
import { isWithinMaintenanceWindow } from '@otr/core/maintenance';
import { withoutTracing } from '@otr/core/tracing';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';

/** Finished jobs stay this long; the daily totals keep their counts after. */
export const JOB_RETENTION_DAYS = 14;
const BATCH_SIZE = 5_000;
const INTERVAL_MS = 60 * 60_000;
const FIRST_RUN_DELAY_MS = 5 * 60_000;
// Days recounted each run, so a worker that was down for a few days catches up.
const RECOUNT_DAYS = 7;

interface JobPrunerOptions {
  db: Pick<DatabaseClient, 'execute'>;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
  now?: () => Date;
}

/** Hourly: recounts jobs created per day, then deletes jobs finished over 14 days ago. */
export class JobPruner {
  private readonly options: JobPrunerOptions;
  private firstRun: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: JobPrunerOptions) {
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
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = withoutTracing(() => this.run())
      .then(() => undefined)
      .catch((error) => {
        this.options.logger.error('Failed to prune jobs', { error });
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Returns how many jobs were deleted. */
  async run(): Promise<number> {
    const {
      db,
      maintenanceWindowEnabled,
      now = () => new Date(),
    } = this.options;
    if (maintenanceWindowEnabled && isWithinMaintenanceWindow(now())) {
      return 0;
    }

    await db.execute(recountEnqueuedSql(RECOUNT_DAYS));

    let deleted = 0;
    for (;;) {
      const { rowCount } = await db.execute(sql`
        WITH doomed AS (
          SELECT id FROM jobs
          WHERE status IN (${JobStatus.Succeeded}, ${JobStatus.Failed}, ${JobStatus.Cancelled})
            AND finished < now() - ${JOB_RETENTION_DAYS}::integer * interval '1 day'
          ORDER BY id
          LIMIT ${BATCH_SIZE}
        )
        DELETE FROM jobs USING doomed WHERE jobs.id = doomed.id`);

      deleted += rowCount ?? 0;
      if ((rowCount ?? 0) < BATCH_SIZE) {
        break;
      }
    }

    if (deleted > 0) {
      this.options.logger.info('Pruned finished jobs', { deleted });
    }
    return deleted;
  }
}
