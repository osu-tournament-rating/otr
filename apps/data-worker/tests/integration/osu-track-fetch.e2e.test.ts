import { describe, expect, it } from 'bun:test';
import { type UserStatUpdate, MessagePriority } from '@otr/core';
import { JobQueue } from '@otr/core/jobs';

import { FixedWindowRateLimiter } from '../../src/rate-limiter';
import { OsuTrackClient } from '../../src/osu-track/client';
import { OsuTrackPlayerWorker } from '../../src/osu-track/worker';
import type { Logger } from '../../src/logging/logger';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

describe('osu!track end-to-end', () => {
  it('fetches stats history in every mode and passes it on', async () => {
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

    let received: {
      osuPlayerId: number;
      results: Array<{ mode: number; updates: UserStatUpdate[] }>;
    } | null = null;

    const worker = new OsuTrackPlayerWorker({
      client,
      rateLimiter,
      logger: noopLogger,
      maintenanceWindowEnabled: false,
      onPlayer: async ({ osuPlayerId, results: playerResults }) => {
        received = {
          osuPlayerId,
          results: playerResults,
        };
      },
    });

    await worker.handle({
      id: 1,
      queue: JobQueue.OsuTrackFetch,
      payload: { osuPlayerId: 19351718 },
      priority: MessagePriority.Normal,
      attempts: 1,
      maxAttempts: 5,
      correlationId: 'test-correlation',
      tournamentId: null,
      requestedByUserId: null,
      traceContext: null,
      created: '2024-05-01T00:00:00.000Z',
    });

    expect(requests).toHaveLength(4);
    const requestedModes = requests.map((request) =>
      request?.searchParams.get('mode')
    );
    expect(requestedModes).toEqual(['0', '1', '2', '3']);

    expect(received).not.toBeNull();
    expect(received!.osuPlayerId).toBe(19351718);
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
  });
});
