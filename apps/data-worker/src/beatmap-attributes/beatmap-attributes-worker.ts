import {
  MessagePriority,
  type ProcessBeatmapAttributesMessage,
} from '@otr/core';

import type { Logger } from '../logging/logger';
import type { QueueConsumer, QueueMessage } from '@otr/core/queues';
import { deferIfMaintenanceWindow } from '../maintenance/gate';
import type { BeatmapAttributesService } from './beatmap-attributes-service';

type BeatmapAttributesServiceContract = Pick<
  BeatmapAttributesService,
  'process'
>;

interface BeatmapAttributesWorkerOptions {
  /** Must consume with prefetch 1; see BeatmapAttributesService. */
  queue: QueueConsumer<ProcessBeatmapAttributesMessage>;
  service: BeatmapAttributesServiceContract;
  logger: Logger;
  maintenanceWindowEnabled: boolean;
}

export class BeatmapAttributesWorker {
  private readonly queue: QueueConsumer<ProcessBeatmapAttributesMessage>;
  private readonly service: BeatmapAttributesServiceContract;
  private readonly logger: Logger;
  private readonly maintenanceWindowEnabled: boolean;

  constructor(options: BeatmapAttributesWorkerOptions) {
    this.queue = options.queue;
    this.service = options.service;
    this.logger = options.logger;
    this.maintenanceWindowEnabled = options.maintenanceWindowEnabled;
  }

  async start() {
    await this.queue.start((message) => this.handleMessage(message));
  }

  async stop() {
    await this.queue.stop();
  }

  private async handleMessage(
    message: QueueMessage<ProcessBeatmapAttributesMessage>
  ) {
    const { beatmapId, checksum } = message.payload;
    const msgLogger = this.logger.child({
      correlationId: message.metadata.correlationId,
      beatmapId,
    });

    // Downloads hit osu!, which the maintenance window keeps quiet.
    const deferred = await deferIfMaintenanceWindow({
      enabled: this.maintenanceWindowEnabled,
      message,
      logger: msgLogger,
    });
    if (deferred) {
      return;
    }

    try {
      await this.service.process({ beatmapId, checksum });
      await message.ack();
    } catch (error) {
      // A sweep job carries nothing the next sweep would not find again, so
      // retrying and parking it would only fill the failed queue with copies
      // during an outage. It is acknowledged instead, and the rethrow still
      // counts the failure as an error. A fetch job may carry osu!'s new
      // checksum, so it gets the usual retries.
      if (message.metadata.priority === MessagePriority.Low) {
        msgLogger.error(
          'failed to process beatmap attributes, leaving it to the next sweep',
          { error }
        );
        await message.ack();
        throw error;
      }

      msgLogger.error('failed to process beatmap attributes', { error });
      throw error;
    }
  }
}
