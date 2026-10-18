import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { sql } from 'drizzle-orm';

import { BeatmapFileDownloader } from '../../beatmap-attributes/downloader';
import {
  createJobsTestDb,
  resetJobTables,
  silentLogger,
  testDatabaseUrl,
} from '../../jobs/__tests__/test-db';
import { OsuTrackClient } from '../../osu-track/client';
import { apiRequestStats } from '../api-request-stats';

// The client module reads worker env at import time.
class FakeAPIError extends Error {
  constructor(readonly response: { status_code: number }) {
    super(`HTTP ${response.status_code}`);
  }
}
mock.module('../../osu/client', () => ({ APIError: FakeAPIError }));

const { withApiMetrics } = await import('../../osu/api-helpers');

describe.skipIf(!testDatabaseUrl)(
  'outbound requests in the daily totals',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);

    beforeEach(async () => {
      // Drop anything other tests recorded into the shared totals.
      await apiRequestStats.flush(db);
      await resetJobTables(db);
    });
    afterAll(() => pool.end());

    const totals = async () => {
      await apiRequestStats.flush(db);
      const { rows } = await db.execute<Record<string, unknown>>(sql`
      SELECT service, endpoint, status, count FROM api_request_stats_daily
      ORDER BY service, endpoint, status`);
      return rows;
    };

    it('counts osu! API calls by endpoint and outcome', async () => {
      await withApiMetrics('getMatch', async () => ({
        status: 'success' as const,
        data: 1,
      }));
      await withApiMetrics('getMatch', async () => ({
        status: 'not_found' as const,
      }));

      expect(await totals()).toEqual([
        { service: 'osu', endpoint: 'getMatch', status: 'not_found', count: 1 },
        { service: 'osu', endpoint: 'getMatch', status: 'success', count: 1 },
      ]);
    });

    it('counts osu!track requests', async () => {
      const client = new OsuTrackClient({
        fetchImpl: async () => Response.json([]),
      });

      await client.fetchUserStatsHistory({ osuPlayerId: 1 });

      expect(await totals()).toEqual([
        {
          service: 'osutrack',
          endpoint: 'statsHistory',
          status: 'success',
          count: 1,
        },
      ]);
    });

    it('counts beatmap file downloads from osu!', async () => {
      const downloader = new BeatmapFileDownloader({
        logger: silentLogger,
        fetchImpl: async () => new Response(null, { status: 404 }),
      });

      await downloader.download(1);

      expect(await totals()).toEqual([
        {
          service: 'osu',
          endpoint: 'beatmapFile',
          status: 'not_found',
          count: 1,
        },
      ]);
    });
  }
);
