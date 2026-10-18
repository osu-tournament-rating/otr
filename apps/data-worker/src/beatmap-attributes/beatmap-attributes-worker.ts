import { MessagePriority } from '@otr/core';
import { JobQueue } from '@otr/core/jobs';

import { DiscardJobError, PermanentJobError } from '../jobs/errors';
import { pauseForMaintenanceWindow } from '../jobs/maintenance';
import type { ClaimedJob, QueueRegistration } from '../jobs/types';
import type { Logger } from '../logging/logger';
import type { BeatmapAttributesService } from './beatmap-attributes-service';

type BeatmapAttributesServiceContract = Pick<
  BeatmapAttributesService,
  'process'
>;

interface BeatmapAttributesWorkerOptions {
  service: BeatmapAttributesServiceContract;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
}

/**
 * Runs processing.attributes.beatmaps jobs. The runner runs one job of a
 * queue at a time, which BeatmapAttributesService relies on.
 */
export class BeatmapAttributesWorker {
  private readonly service: BeatmapAttributesServiceContract;
  private readonly logger: Logger;
  private readonly maintenanceWindowEnabled: boolean;

  constructor(options: BeatmapAttributesWorkerOptions) {
    this.service = options.service;
    this.logger = options.logger;
    this.maintenanceWindowEnabled = options.maintenanceWindowEnabled;
  }

  registration(): QueueRegistration<JobQueue.BeatmapAttributes> {
    return {
      queue: JobQueue.BeatmapAttributes,
      handler: (job) => this.handle(job),
      // Downloads hit osu!, which the maintenance window keeps quiet.
      pausedUntil: pauseForMaintenanceWindow(this.maintenanceWindowEnabled),
    };
  }

  async handle(job: ClaimedJob<JobQueue.BeatmapAttributes>) {
    const { beatmapId, checksum } = job.payload;

    if (!Number.isInteger(beatmapId)) {
      throw new PermanentJobError(
        `The job has no beatmap id: ${JSON.stringify(job.payload)}`
      );
    }

    const jobLogger = this.logger.child({
      correlationId: job.correlationId,
      beatmapId,
    });

    try {
      await this.service.process({ beatmapId, checksum });
    } catch (error) {
      // A sweep job carries nothing the next sweep would not find again, so
      // retrying or failing it would only pile up copies during an outage.
      // It is dropped instead. A fetch job may carry osu!'s new checksum, so
      // it gets the usual retries.
      if (job.priority === MessagePriority.Low) {
        jobLogger.error(
          'failed to process beatmap attributes, leaving it to the next sweep',
          { error }
        );
        throw new DiscardJobError(
          `Left to the next sweep: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      jobLogger.error('failed to process beatmap attributes', { error });
      throw error;
    }
  }
}
