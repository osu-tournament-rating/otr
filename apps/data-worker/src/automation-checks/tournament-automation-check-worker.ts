import { JobQueue } from '@otr/core/jobs';

import { PermanentJobError } from '../jobs/errors';
import { pauseForMaintenanceWindow } from '../jobs/maintenance';
import type { ClaimedJob, QueueRegistration } from '../jobs/types';
import type { Logger } from '../logging/logger';
import type { TournamentAutomationCheckService } from './tournament-automation-check-service';

interface TournamentAutomationCheckWorkerOptions {
  service: Pick<TournamentAutomationCheckService, 'processAutomationChecks'>;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
}

/**
 * Runs processing.checks.tournaments jobs. Checks write verification
 * statuses that the weekly rating run reads, so the queue pauses during the
 * maintenance window, as admin writes do.
 */
export class TournamentAutomationCheckWorker {
  private readonly service: TournamentAutomationCheckWorkerOptions['service'];
  private readonly logger: Logger;
  private readonly maintenanceWindowEnabled: boolean;

  constructor(options: TournamentAutomationCheckWorkerOptions) {
    this.service = options.service;
    this.logger = options.logger;
    this.maintenanceWindowEnabled = options.maintenanceWindowEnabled;
  }

  registration(): QueueRegistration<JobQueue.TournamentChecks> {
    return {
      queue: JobQueue.TournamentChecks,
      handler: (job) => this.handle(job),
      pausedUntil: pauseForMaintenanceWindow(this.maintenanceWindowEnabled),
    };
  }

  async handle(job: ClaimedJob<JobQueue.TournamentChecks>) {
    const { tournamentId, overrideVerifiedState } = job.payload;

    if (!Number.isInteger(tournamentId)) {
      throw new PermanentJobError(
        `The job has no tournament id: ${JSON.stringify(job.payload)}`
      );
    }

    const jobLogger = this.logger.child({
      correlationId: job.correlationId,
      tournamentId,
    });

    jobLogger.info('processing tournament automation check');

    try {
      const success = await this.service.processAutomationChecks(
        tournamentId,
        overrideVerifiedState === true
      );

      if (success) {
        jobLogger.info('tournament passed automation checks');
      } else {
        jobLogger.info('tournament failed automation checks');
      }
    } catch (error) {
      jobLogger.error('failed to process tournament automation checks', {
        error,
      });
      throw error;
    }
  }
}
