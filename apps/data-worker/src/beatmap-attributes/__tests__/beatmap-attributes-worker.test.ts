import { describe, expect, it } from 'bun:test';
import {
  MessagePriority,
  type ProcessBeatmapAttributesMessage,
} from '@otr/core';

import type { QueueConsumer, QueueMessage } from '@otr/core/queues';
import type { Logger } from '../../logging/logger';
import { BeatmapAttributesWorker } from '../beatmap-attributes-worker';

type Handler = (
  message: QueueMessage<ProcessBeatmapAttributesMessage>
) => Promise<void>;

class StubQueue implements QueueConsumer<ProcessBeatmapAttributesMessage> {
  handler: Handler | null = null;

  async start(handler: Handler) {
    this.handler = handler;
  }

  async stop() {
    this.handler = null;
  }

  async emit(message: QueueMessage<ProcessBeatmapAttributesMessage>) {
    if (!this.handler) {
      throw new Error('Queue handler not registered');
    }

    await this.handler(message);
  }
}

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

const metadata = {
  correlationId: 'corr-id',
  requestedAt: new Date().toISOString(),
  priority: MessagePriority.Normal,
};

const createMessage = (
  payload: { beatmapId: number; checksum?: string },
  counts: { acked: number; nacked: number },
  priority = MessagePriority.Normal
): QueueMessage<ProcessBeatmapAttributesMessage> => ({
  payload: { ...metadata, priority, ...payload },
  metadata: { ...metadata, priority },
  ack: async () => {
    counts.acked += 1;
  },
  nack: async () => {
    counts.nacked += 1;
  },
});

const startWorker = async (
  processJob: (job: { beatmapId: number; checksum?: string }) => Promise<void>
) => {
  const queue = new StubQueue();
  const worker = new BeatmapAttributesWorker({
    queue,
    service: { process: processJob },
    logger: noopLogger,
    maintenanceWindowEnabled: false,
  });

  await worker.start();
  return queue;
};

describe('BeatmapAttributesWorker', () => {
  it('passes the beatmap and checksum to the service, then acknowledges', async () => {
    const jobs: Array<{ beatmapId: number; checksum?: string }> = [];
    const queue = await startWorker(async (job) => {
      jobs.push(job);
    });
    const counts = { acked: 0, nacked: 0 };

    await queue.emit(createMessage({ beatmapId: 7, checksum: 'abc' }, counts));
    await queue.emit(createMessage({ beatmapId: 8 }, counts));

    expect(jobs).toEqual([
      { beatmapId: 7, checksum: 'abc' },
      { beatmapId: 8, checksum: undefined },
    ]);
    expect(counts).toEqual({ acked: 2, nacked: 0 });
  });

  it('rethrows a failure without acknowledging, so the consumer retries', async () => {
    const queue = await startWorker(async () => {
      throw new Error('storage unavailable');
    });
    const counts = { acked: 0, nacked: 0 };

    await expect(
      queue.emit(createMessage({ beatmapId: 7, checksum: 'abc' }, counts))
    ).rejects.toThrow('storage unavailable');
    expect(counts).toEqual({ acked: 0, nacked: 0 });
  });

  it('acknowledges a failed sweep job before rethrowing, so it is not retried', async () => {
    const queue = await startWorker(async () => {
      throw new Error('storage unavailable');
    });
    const counts = { acked: 0, nacked: 0 };

    await expect(
      queue.emit(createMessage({ beatmapId: 7 }, counts, MessagePriority.Low))
    ).rejects.toThrow('storage unavailable');
    expect(counts).toEqual({ acked: 1, nacked: 0 });
  });
});
