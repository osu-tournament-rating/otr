import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import type { UserStatUpdate } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue } from '@otr/core/jobs';
import { Ruleset } from '@otr/core/osu';

import {
  createJobsTestDb,
  silentLogger,
  testDatabaseUrl,
} from '../../jobs/__tests__/test-db';
import type { RateLimiter } from '../../rate-limiter';
import { processOsuTrackPlayerResults } from '../persistence';

// The client module reads worker env at import time.
mock.module('../../osu/client', () => ({
  APIError: class APIError extends Error {},
}));

const { PlayerFetchService } =
  await import('../../osu/services/player-fetch-service');

// Far above any real osu! id and clear of other test files' ranges.
const SEED_OSU_ID_BASE = 90_000_110_000;
const SEED_OSU_ID_END = SEED_OSU_ID_BASE + 100;

const rateLimiter: RateLimiter = { schedule: (task) => task() };

// The rulesets a profile fetch saves when osu! reports no mania variants.
const PROFILE_RULESETS = [
  Ruleset.Osu,
  Ruleset.Taiko,
  Ruleset.Catch,
  Ruleset.ManiaOther,
];

const rankUpdate = (rank: number): UserStatUpdate => ({
  count300: 0,
  count100: 0,
  count50: 0,
  playCount: 0,
  rankedScore: 0,
  totalScore: 0,
  rank,
  level: 0,
  pp: 0,
  accuracy: 0,
  countSs: 0,
  countS: 0,
  countA: 0,
  timestamp: new Date('2025-03-01T00:00:00.000Z'),
});

// The CI `checks` job's test task sets SEARCH_TEST_DATABASE_URL.
describe.skipIf(!testDatabaseUrl)(
  'osu!track ranks dropped before a profile fetch',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);
    let nextOsuId = SEED_OSU_ID_BASE;

    const profileService = new PlayerFetchService({
      db,
      api: {
        getUser: async (osuPlayerId: number) => ({
          id: osuPlayerId,
          username: `after-profile-${osuPlayerId}`,
          country_code: 'US',
          statistics: { pp: 1000, global_rank: 5_000 },
        }),
      } as unknown as API,
      rateLimiter,
      logger: silentLogger,
    });

    const seedPlayer = async (values: {
      osuTrackDataFetchStatus: DataFetchStatus;
      osuTrackLastFetch: string | null;
      rulesetData?: { rulesets: Ruleset[]; created: string };
    }) => {
      const osuId = nextOsuId++;
      const [player] = await db
        .insert(schema.players)
        .values({
          osuId,
          osuTrackDataFetchStatus: values.osuTrackDataFetchStatus,
          osuTrackLastFetch: values.osuTrackLastFetch,
        })
        .returning({ id: schema.players.id });

      if (values.rulesetData) {
        const { rulesets, created } = values.rulesetData;
        await db.insert(schema.playerOsuRulesetData).values(
          rulesets.map((ruleset) => ({
            playerId: player!.id,
            ruleset,
            pp: 900,
            globalRank: 6_000,
            created,
          }))
        );
      }

      return osuId;
    };

    const osuTrackState = async (osuId: number) => {
      const [player] = await db
        .select({
          status: schema.players.osuTrackDataFetchStatus,
          lastFetch: schema.players.osuTrackLastFetch,
        })
        .from(schema.players)
        .where(eq(schema.players.osuId, osuId));
      return player!;
    };

    const queuedOsuTrackFetches = async (osuId: number) => {
      const { rows } = await db.execute<{ payload: unknown }>(
        sql`SELECT payload FROM jobs WHERE queue = ${JobQueue.OsuTrackFetch}
          AND (payload->>'osuPlayerId')::bigint = ${osuId}`
      );
      return rows.map((row) => row.payload);
    };

    const removeSeed = async () => {
      await db.execute(sql`DELETE FROM jobs WHERE queue = ${JobQueue.OsuTrackFetch}
        AND (payload->>'osuPlayerId')::bigint >= ${SEED_OSU_ID_BASE}
        AND (payload->>'osuPlayerId')::bigint < ${SEED_OSU_ID_END}`);
      await db
        .delete(schema.players)
        .where(
          and(
            gte(schema.players.osuId, SEED_OSU_ID_BASE),
            lt(schema.players.osuId, SEED_OSU_ID_END)
          )
        );
    };

    beforeEach(removeSeed);

    afterAll(async () => {
      await removeSeed();
      await pool.end();
    });

    it("queues osu!track again after a new player's first profile fetch, so its ranks are saved", async () => {
      const osuId = await seedPlayer({
        osuTrackDataFetchStatus: DataFetchStatus.NotFetched,
        osuTrackLastFetch: null,
      });
      const results = [{ mode: 0, updates: [rankUpdate(12_000)] }];

      // osu!track runs first, with no ruleset data to save onto.
      await processOsuTrackPlayerResults({
        db,
        logger: silentLogger,
        osuPlayerId: osuId,
        results,
      });
      await profileService.fetchAndPersist(osuId);

      expect(await queuedOsuTrackFetches(osuId)).toEqual([
        { osuPlayerId: osuId },
      ]);
      expect((await osuTrackState(osuId)).status).toBe(
        DataFetchStatus.Fetching
      );

      // The queued fetch saves the rank the first one dropped.
      await processOsuTrackPlayerResults({
        db,
        logger: silentLogger,
        osuPlayerId: osuId,
        results,
      });

      const [osuData] = await db
        .select({ rank: schema.playerOsuRulesetData.earliestGlobalRank })
        .from(schema.playerOsuRulesetData)
        .innerJoin(
          schema.players,
          eq(schema.players.id, schema.playerOsuRulesetData.playerId)
        )
        .where(
          and(
            eq(schema.players.osuId, osuId),
            eq(schema.playerOsuRulesetData.ruleset, Ruleset.Osu)
          )
        );
      expect(osuData?.rank).toBe(12_000);
    });

    it('queues osu!track again when a profile fetch adds a ruleset after the last osu!track fetch', async () => {
      const osuId = await seedPlayer({
        osuTrackDataFetchStatus: DataFetchStatus.Fetched,
        osuTrackLastFetch: '2026-02-01T00:00:00.000Z',
        rulesetData: {
          rulesets: PROFILE_RULESETS.filter(
            (ruleset) => ruleset !== Ruleset.ManiaOther
          ),
          created: '2026-01-01T00:00:00.000Z',
        },
      });

      await profileService.fetchAndPersist(osuId);

      expect(await queuedOsuTrackFetches(osuId)).toEqual([
        { osuPlayerId: osuId },
      ]);
    });

    it.each([
      [
        'osu!track ran after every ruleset row existed',
        {
          osuTrackDataFetchStatus: DataFetchStatus.Fetched,
          osuTrackLastFetch: '2026-02-01T00:00:00.000Z',
          rulesetData: {
            rulesets: PROFILE_RULESETS,
            created: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      [
        'an osu!track fetch is already queued',
        {
          osuTrackDataFetchStatus: DataFetchStatus.Fetching,
          osuTrackLastFetch: '2026-02-01T00:00:00.000Z',
        },
      ],
      [
        'osu!track was never fetched',
        {
          osuTrackDataFetchStatus: DataFetchStatus.NotFetched,
          osuTrackLastFetch: null,
        },
      ],
    ])('queues no osu!track fetch when %s', async (_, seed) => {
      const osuId = await seedPlayer(seed);
      const before = await osuTrackState(osuId);

      await profileService.fetchAndPersist(osuId);

      expect(await queuedOsuTrackFetches(osuId)).toEqual([]);
      expect(await osuTrackState(osuId)).toEqual(before);
    });
  }
);
