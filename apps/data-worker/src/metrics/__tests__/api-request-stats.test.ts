import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';

import {
  createJobsTestDb,
  resetJobTables,
  testDatabaseUrl,
} from '../../jobs/__tests__/test-db';
import { ApiRequestStats } from '../api-request-stats';

describe.skipIf(!testDatabaseUrl)('ApiRequestStats', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);

  beforeEach(() => resetJobTables(db));
  afterAll(() => pool.end());

  const totals = async () => {
    const { rows } = await db.execute<Record<string, unknown>>(sql`
      SELECT day::text, service, endpoint, status, count,
        total_duration_ms::int AS total, max_duration_ms AS max
      FROM api_request_stats_daily ORDER BY day, endpoint, status`);
    return rows;
  };

  it('adds each flush to the day, endpoint and status it was recorded under', async () => {
    const stats = new ApiRequestStats();
    const day1 = new Date('2026-10-17T23:59:59Z');
    const day2 = new Date('2026-10-18T00:00:01Z');

    stats.record('osu', 'getMatch', 'success', 100, day1);
    stats.record('osu', 'getMatch', 'success', 300, day1);
    stats.record('osu', 'getMatch', 'error', 50, day1);
    stats.record('osu', 'getMatch', 'success', 10, day2);
    await stats.flush(db);
    stats.record('osu', 'getMatch', 'success', 500, day1);
    await stats.flush(db);

    expect(await totals()).toEqual([
      {
        day: '2026-10-17',
        service: 'osu',
        endpoint: 'getMatch',
        status: 'error',
        count: 1,
        total: 50,
        max: 50,
      },
      {
        day: '2026-10-17',
        service: 'osu',
        endpoint: 'getMatch',
        status: 'success',
        count: 3,
        total: 900,
        max: 500,
      },
      {
        day: '2026-10-18',
        service: 'osu',
        endpoint: 'getMatch',
        status: 'success',
        count: 1,
        total: 10,
        max: 10,
      },
    ]);
  });

  it('keeps unsaved counts for the next flush when a flush fails', async () => {
    const stats = new ApiRequestStats();
    const day = new Date('2026-10-17T12:00:00Z');
    stats.record('osutrack', 'statsHistory', 'success', 20, day);

    await expect(
      stats.flush({
        execute: async () => {
          throw new Error('database unavailable');
        },
      })
    ).rejects.toThrow('database unavailable');
    stats.record('osutrack', 'statsHistory', 'success', 40, day);
    await stats.flush(db);

    expect(await totals()).toEqual([
      {
        day: '2026-10-17',
        service: 'osutrack',
        endpoint: 'statsHistory',
        status: 'success',
        count: 2,
        total: 60,
        max: 40,
      },
    ]);
  });
});
