import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import * as schema from '@otr/core/db/schema';
import { JobQueue } from '@otr/core/jobs';

import {
  createJobsTestDb,
  testDatabaseUrl,
} from '../../jobs/__tests__/test-db';
import type { ClaimedJob, JobTransaction } from '../../jobs/types';
import { OsuTrackClient } from '../client';
import { OsuTrackPlayerWorker } from '../worker';
import type { RateLimiter } from '../../rate-limiter';
import type { Logger } from '../../logging/logger';

class StubRateLimiter implements RateLimiter {
  public calls = 0;

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    this.calls += 1;
    return task();
  }
}

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

const job = (osuPlayerId: number): ClaimedJob<JobQueue.OsuTrackFetch> => ({
  id: 1,
  queue: JobQueue.OsuTrackFetch,
  payload: { osuPlayerId },
  priority: MessagePriority.Low,
  attempts: 1,
  maxAttempts: 5,
  correlationId: 'test-correlation',
  tournamentId: null,
  requestedByUserId: null,
  traceContext: null,
  created: '2024-03-15T12:00:00.000Z',
});

const failingClient = () =>
  new OsuTrackClient({
    fetchImpl: async () => new Response('unavailable', { status: 503 }),
  });

describe('OsuTrackPlayerWorker', () => {
  it('fetches every mode through the rate limiter and passes on the updates', async () => {
    const rateLimiter = new StubRateLimiter();

    const fetchImpl = async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify([
          {
            count300: '15',
            count100: '2',
            count50: '1',
            playcount: '120',
            ranked_score: '123456',
            total_score: '789012',
            pp_rank: '3456',
            level: '88.4',
            pp_raw: '5123.45',
            accuracy: '98.11',
            count_rank_ss: '3',
            count_rank_s: '10',
            count_rank_a: '20',
            timestamp: '2024-03-15T12:34:56.000Z',
          },
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    const client = new OsuTrackClient({
      fetchImpl,
    });

    const received: Array<{
      osuPlayerId: number;
      results: Array<{ mode: number; updates: number }>;
    }> = [];

    const worker = new OsuTrackPlayerWorker({
      client,
      rateLimiter,
      logger: noopLogger,
      maintenanceWindowEnabled: false,
      onPlayer: async ({ osuPlayerId, results }) => {
        received.push({
          osuPlayerId,
          results: results.map((entry) => ({
            mode: entry.mode,
            updates: entry.updates.length,
          })),
        });
      },
    });

    await worker.handle(job(7654321));

    expect(rateLimiter.calls).toBe(4);
    expect(received).toHaveLength(1);
    expect(received[0]?.osuPlayerId).toBe(7654321);
    expect(received[0]?.results).toEqual([
      { mode: 0, updates: 1 },
      { mode: 1, updates: 1 },
      { mode: 2, updates: 1 },
      { mode: 3, updates: 1 },
    ]);
  });

  it('leaves a failed fetch to the runner retry policy', async () => {
    let persisted = false;
    const worker = new OsuTrackPlayerWorker({
      client: failingClient(),
      rateLimiter: new StubRateLimiter(),
      logger: noopLogger,
      maintenanceWindowEnabled: false,
      onPlayer: () => {
        persisted = true;
      },
    });

    await expect(worker.handle(job(7654321))).rejects.toThrow();
    expect(persisted).toBe(false);
  });

  it('pauses during the maintenance window', () => {
    const pausedUntil = (enabled: boolean) =>
      new OsuTrackPlayerWorker({
        client: failingClient(),
        rateLimiter: new StubRateLimiter(),
        logger: noopLogger,
        maintenanceWindowEnabled: enabled,
      })
        .registration()
        .pausedUntil?.(new Date('2026-10-13T11:50:00Z'));

    expect(pausedUntil(true)).toEqual(new Date('2026-10-13T12:15:00Z'));
    expect(pausedUntil(false)).toBeNull();
  });
});

// Far above real osu! ids and other test files' ranges.
const OSU_ID = 97_000_000_000;

describe.skipIf(!testDatabaseUrl)(
  'osu!track fetches that run out of attempts',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);

    const worker = new OsuTrackPlayerWorker({
      client: failingClient(),
      rateLimiter: new StubRateLimiter(),
      logger: noopLogger,
      maintenanceWindowEnabled: false,
    });

    const giveUp = (osuPlayerId: number) =>
      db.transaction((tx) =>
        worker.registration().onGiveUp!(
          { ...job(osuPlayerId), attempts: 5 },
          tx as JobTransaction
        )
      );

    const seededLastFetch = '2026-01-01T00:00:00.000Z';

    const seedPlayer = (osuId: number, status: DataFetchStatus) =>
      db.insert(schema.players).values({
        osuId,
        username: 'osu!track give-up test',
        osuTrackDataFetchStatus: status,
        osuTrackLastFetch: seededLastFetch,
      });

    const osuTrackState = async (osuId: number) => {
      const [row] = await db
        .select({
          status: schema.players.osuTrackDataFetchStatus,
          lastFetchMs:
            sql<number>`extract(epoch from ${schema.players.osuTrackLastFetch}) * 1000`.mapWith(
              Number
            ),
        })
        .from(schema.players)
        .where(eq(schema.players.osuId, osuId));
      return row!;
    };

    const cleanUp = async () => {
      await db
        .delete(schema.players)
        .where(inArray(schema.players.osuId, [OSU_ID + 1, OSU_ID + 2]));
    };

    beforeEach(cleanUp);

    afterAll(async () => {
      await cleanUp();
      await pool.end();
    });

    it("frees the player's lease and holds off the next refetch a full interval", async () => {
      await seedPlayer(OSU_ID + 1, DataFetchStatus.Fetching);
      // Postgres keeps microseconds; allow for the truncation to milliseconds.
      const before = Date.now() - 1;

      await giveUp(OSU_ID + 1);

      const state = await osuTrackState(OSU_ID + 1);
      expect(state.status).toBe(DataFetchStatus.Error);
      expect(state.lastFetchMs).toBeGreaterThanOrEqual(before);
    });

    it('leaves a player whose fetch already finished alone', async () => {
      await seedPlayer(OSU_ID + 2, DataFetchStatus.Fetched);

      await giveUp(OSU_ID + 2);

      expect(await osuTrackState(OSU_ID + 2)).toEqual({
        status: DataFetchStatus.Fetched,
        lastFetchMs: new Date(seededLastFetch).getTime(),
      });
    });
  }
);
