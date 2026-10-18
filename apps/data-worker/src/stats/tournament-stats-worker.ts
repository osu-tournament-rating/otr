import { JobQueue } from '@otr/core/jobs';

import type { ClaimedJob, QueueRegistration } from '../jobs/types';
import { DiscardJobError, PermanentJobError } from '../jobs/errors';
import type { Logger } from '../logging/logger';
import { TournamentStatsService } from './tournament-stats-service';

interface TournamentStatsWorkerOptions {
  service: TournamentStatsService;
  logger: Logger;
}

/** Recalculates a tournament's stats for each job the rating run queues. */
export class TournamentStatsWorker {
  private readonly service: TournamentStatsService;
  private readonly logger: Logger;

  constructor(options: TournamentStatsWorkerOptions) {
    this.service = options.service;
    this.logger = options.logger;
  }

  registration(): QueueRegistration<JobQueue.TournamentStats> {
    return {
      queue: JobQueue.TournamentStats,
      handler: (job) => this.handle(job),
    };
  }

  async handle(job: ClaimedJob<JobQueue.TournamentStats>) {
    const { tournamentId } = job.payload;

    if (!Number.isInteger(tournamentId)) {
      throw new PermanentJobError(
        `The job has no tournament id: ${JSON.stringify(job.payload)}`
      );
    }

    const jobLogger = this.logger.child({
      correlationId: job.correlationId,
      tournamentId,
    });
    jobLogger.info('processing tournament stats');

    const outcome = await this.service.processTournamentStats(tournamentId);

    // A retry gives the same answer either way. A tournament rejected or
    // deleted after its job was queued is expected, so it raises no alert.
    if (outcome.status === 'skipped') {
      throw new DiscardJobError(outcome.reason);
    }
    if (outcome.status === 'failed') {
      throw new PermanentJobError(outcome.reason);
    }
  }
}
