import { describe, expect, it } from 'bun:test';
import {
  type FetchPlayerOsuTrackMessage,
  type UserStatUpdate,
  MessagePriority,
} from '@otr/core';

import { FixedWindowRateLimiter } from '../../src/rate-limiter';
import { OsuTrackClient } from '../../src/osu-track/client';
import { OsuTrackPlayerWorker } from '../../src/osu-track/worker';
import type { QueueConsumer, QueueMessage } from '@otr/core/queues';
import type { Logger } from '../../src/logging/logger';
import type { DatabaseClient } from '../../src/db';

class TestQueue implements QueueConsumer<FetchPlayerOsuTrackMessage> {
  private handler:
    | ((message: QueueMessage<FetchPlayerOsuTrackMessage>) => Promise<void>)
    | null = null;

  async start(
    handler: (
      message: QueueMessage<FetchPlayerOsuTrackMessage>
    ) => Promise<void>
  ) {
    this.handler = handler;
  }

  async stop() {
    this.handler = null;
  }

  async emit(message: QueueMessage<FetchPlayerOsuTrackMessage>) {
    if (!this.handler) {
      throw new Error('TestQueue.emit called before start');
    }

    await this.handler(message);
  }
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

describe('osu!track end-to-end', () => {
  it('fetches stats history and acknowledges messages', async () => {
    const requests: URL[] = [];
    const responseBody = [
      {
        count300: '42',
        count100: '10',
        count50: '2',
        playcount: '300',
        ranked_score: '1234567',
        total_score: '2345678',
        pp_rank: '789',
        level: '99.12',
        pp_raw: '6543.21',
        accuracy: '97.5',
        count_rank_ss: '5',
        count_rank_s: '12',
        count_rank_a: '30',
        timestamp: '2024-05-01T01:02:03.000Z',
      },
    ];

    const queue = new TestQueue();
    const rateLimiter = new FixedWindowRateLimiter({
      requests: 60,
      windowMs: 60_000,
    });
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      );
      requests.push(url);

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = new OsuTrackClient({
      fetchImpl,
    });

    let acked = 0;
    let nacked = 0;

    let processedResolve: (() => void) | null = null;
    const processed = new Promise<void>((resolve) => {
      processedResolve = resolve;
    });

    let received: {
      message: FetchPlayerOsuTrackMessage;
      results: Array<{ mode: number; updates: UserStatUpdate[] }>;
    } | null = null;

    const worker = new OsuTrackPlayerWorker({
      queue,
      client,
      rateLimiter,
      logger: noopLogger,
      // Only a failed fetch writes to the database.
      db: {} as DatabaseClient,
      maintenanceWindowEnabled: false,
      onPlayer: async ({ message, results: playerResults }) => {
        received = {
          message,
          results: playerResults,
        };
        processedResolve?.();
      },
    });

    await worker.start();

    const message: QueueMessage<FetchPlayerOsuTrackMessage> = {
      payload: {
        osuPlayerId: 19351718,
        requestedAt: '2024-05-01T00:00:00.000Z',
        correlationId: 'test-correlation',
        priority: MessagePriority.Normal,
      },
      metadata: {
        requestedAt: '2024-05-01T00:00:00.000Z',
        correlationId: 'test-correlation',
        priority: MessagePriority.Normal,
      },
      ack: async () => {
        acked += 1;
      },
      nack: async () => {
        nacked += 1;
      },
    };

    try {
      await queue.emit(message);
      await processed;

      expect(requests).toHaveLength(4);
      const requestedModes = requests.map((request) =>
        request?.searchParams.get('mode')
      );
      expect(requestedModes).toEqual(['0', '1', '2', '3']);

      expect(acked).toBe(1);
      expect(nacked).toBe(0);
      expect(received).not.toBeNull();
      expect(received!.results).toHaveLength(4);
      const [first] = received!.results;
      expect(first.mode).toBe(0);
      expect(first.updates).toHaveLength(1);
      const [firstUpdate] = first.updates;
      expect(firstUpdate.playCount).toBe(300);
      expect(firstUpdate.totalScore).toBe(2345678);
      expect(firstUpdate.rankedScore).toBe(1234567);
      expect(firstUpdate.rank).toBe(789);
      expect(firstUpdate.accuracy).toBeCloseTo(97.5);
      expect(firstUpdate.level).toBeCloseTo(99.12);
      expect(firstUpdate.pp).toBeCloseTo(6543.21);
      expect(firstUpdate.count300).toBe(42);
      expect(firstUpdate.count100).toBe(10);
      expect(firstUpdate.count50).toBe(2);
      expect(firstUpdate.countSs).toBe(5);
      expect(firstUpdate.countS).toBe(12);
      expect(firstUpdate.countA).toBe(30);
      expect(firstUpdate.timestamp.toISOString()).toBe(
        '2024-05-01T01:02:03.000Z'
      );
    } finally {
      await worker.stop();
    }
  });
});
