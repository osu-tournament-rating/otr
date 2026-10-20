import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { inArray, sql } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import { Ruleset } from '@otr/core/osu';

import {
  createJobsTestDb,
  silentLogger,
  testDatabaseUrl,
} from '../../../jobs/__tests__/test-db';
import type { RateLimiter } from '../../../rate-limiter';

// The client module reads worker env at import time.
mock.module('../../client', () => ({
  APIError: class APIError extends Error {},
}));

const { BeatmapFetchService } = await import('../beatmap-fetch-service');
const { TournamentDataCompletionService } =
  await import('../tournament-data-completion-service');

const BEATMAPSET_OSU_ID = 999_318_301;
const BEATMAP_OSU_IDS = [999_318_201, 999_318_202] as const;

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

type Mapper = {
  osuId: number;
  // Absent for a mapper the database has never seen.
  seed?: {
    status: DataFetchStatus;
    lastFetchDays: number;
    osuRank?: number;
  };
  queued: boolean;
};

// Rank 100 refetches daily. Unrated players wait 30 days, past the 14-day
// fallback for rated players outside the rank tiers.
const mappers = {
  new: { osuId: 999_318_401, queued: true },
  ratedRecent: {
    osuId: 999_318_402,
    seed: {
      status: DataFetchStatus.Fetched,
      lastFetchDays: 1 / 24,
      osuRank: 100,
    },
    queued: false,
  },
  ratedDue: {
    osuId: 999_318_403,
    seed: { status: DataFetchStatus.Fetched, lastFetchDays: 2, osuRank: 100 },
    queued: true,
  },
  unratedRecent: {
    osuId: 999_318_404,
    seed: { status: DataFetchStatus.Fetched, lastFetchDays: 20 },
    queued: false,
  },
  unratedDue: {
    osuId: 999_318_405,
    seed: { status: DataFetchStatus.Fetched, lastFetchDays: 31 },
    queued: true,
  },
  fetching: {
    osuId: 999_318_406,
    seed: { status: DataFetchStatus.Fetching, lastFetchDays: 1 / 24 },
    queued: false,
  },
} satisfies Record<string, Mapper>;

const allMappers: Mapper[] = Object.values(mappers);
const osuIds = allMappers.map((mapper) => mapper.osuId);

const rateLimiter: RateLimiter = { schedule: (task) => task() };

const difficulty = (id: number, owners: Mapper[]) => ({
  id,
  user_id: owners[0]!.osuId,
  owners: owners.map((owner) => ({ id: owner.osuId, username: 'mapper' })),
  mode_int: 0,
  status: 'ranked',
  version: `Difficulty ${id}`,
  total_length: 60,
  hit_length: 60,
  bpm: 180,
  count_circles: 10,
  count_sliders: 1,
  count_spinners: 0,
  cs: 4,
  drain: 5,
  accuracy: 8,
  ar: 9,
  difficulty_rating: 5,
  max_combo: 100,
});

const difficulties = [
  difficulty(BEATMAP_OSU_IDS[0], [
    mappers.ratedDue,
    mappers.ratedRecent,
    mappers.new,
  ]),
  difficulty(BEATMAP_OSU_IDS[1], [
    mappers.unratedRecent,
    mappers.unratedDue,
    mappers.fetching,
  ]),
];

const api = {
  getBeatmap: async (id: number) => ({
    ...difficulties.find((beatmap) => beatmap.id === id)!,
    beatmapset_id: BEATMAPSET_OSU_ID,
  }),
  getBeatmapset: async () => ({
    id: BEATMAPSET_OSU_ID,
    user_id: mappers.ratedDue.osuId,
    creator: 'mapper',
    artist: 'Artist',
    title: 'Title',
    status: 'ranked',
    ranked_date: '2024-01-01T00:00:00Z',
    submitted_date: '2023-12-01T00:00:00Z',
    beatmaps: difficulties,
  }),
} as unknown as API;

describe.skipIf(!testDatabaseUrl)(
  'mapper refetches from a beatmap fetch',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);

    type FetchState = { osuId: number; status: number; lastFetch: string };
    let before: FetchState[] = [];
    let after: FetchState[] = [];
    let queued: number[] = [];

    const fetchStates = () =>
      db
        .select({
          osuId: schema.players.osuId,
          status: schema.players.dataFetchStatus,
          lastFetch: schema.players.osuLastFetch,
        })
        .from(schema.players)
        .where(inArray(schema.players.osuId, osuIds));

    const playerJobsSql = sql`queue = ${JobQueue.OsuFetch}
    AND payload->>'type' = 'player'
    AND (payload->>'osuPlayerId')::bigint IN (${sql.join(
      osuIds.map((id) => sql`${id}`),
      sql`, `
    )})`;

    const cleanUp = async () => {
      await db.execute(sql`DELETE FROM jobs WHERE ${playerJobsSql}`);
      await db
        .delete(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, [...BEATMAP_OSU_IDS]));
      await db
        .delete(schema.beatmapsets)
        .where(inArray(schema.beatmapsets.osuId, [BEATMAPSET_OSU_ID]));
      await db
        .delete(schema.players)
        .where(inArray(schema.players.osuId, osuIds));
    };

    beforeAll(async () => {
      await cleanUp();

      for (const mapper of allMappers) {
        if (!mapper.seed) {
          continue;
        }

        const [row] = await db
          .insert(schema.players)
          .values({
            osuId: mapper.osuId,
            username: `mapper-${mapper.osuId}`,
            dataFetchStatus: mapper.seed.status,
            osuLastFetch: daysAgo(mapper.seed.lastFetchDays),
          })
          .returning({ id: schema.players.id });

        if (mapper.seed.osuRank !== undefined) {
          await db.insert(schema.playerRatings).values({
            playerId: row!.id,
            ruleset: Ruleset.Osu,
            rating: 1000,
            volatility: 100,
            percentile: 0.5,
            globalRank: mapper.seed.osuRank,
            countryRank: mapper.seed.osuRank,
          });
        }
      }

      before = await fetchStates();

      const service = new BeatmapFetchService({
        db,
        api,
        rateLimiter,
        logger: silentLogger,
        dataCompletion: new TournamentDataCompletionService({
          db,
          logger: silentLogger,
        }),
        osuRefetchCadence: { outdatedDays: 14, unratedDays: 30 },
        publishPlayerFetches: async (executor, osuPlayerIds) => {
          await enqueueJobs(
            executor,
            JobQueue.OsuFetch,
            osuPlayerIds.map((osuPlayerId) => ({
              payload: { type: 'player' as const, osuPlayerId },
            }))
          );
        },
      });

      expect(await service.fetchAndPersist(BEATMAP_OSU_IDS[0])).toBe(true);

      after = await fetchStates();
      const { rows } = await db.execute<{ osu_player_id: string }>(
        sql`SELECT payload->>'osuPlayerId' AS osu_player_id FROM jobs
        WHERE ${playerJobsSql}`
      );
      queued = rows.map((row) => Number(row.osu_player_id));
    });

    afterAll(async () => {
      await cleanUp();
      await pool.end();
    });

    it('queues new and overdue mappers, and no mapper fetched recently or being fetched', () => {
      expect(new Set(queued)).toEqual(
        new Set(
          allMappers
            .filter((mapper) => mapper.queued)
            .map((mapper) => mapper.osuId)
        )
      );
      expect(queued).toHaveLength(3);
    });

    it('claims a fetch lease only on the existing mappers it queues', () => {
      const skipped = allMappers
        .filter((mapper) => !mapper.queued)
        .map((mapper) => mapper.osuId);
      const stateOf = (states: FetchState[], osuId: number) =>
        states.find((state) => state.osuId === osuId);

      expect(skipped).toHaveLength(3);
      for (const osuId of skipped) {
        expect(stateOf(after, osuId)).toEqual(stateOf(before, osuId));
      }

      for (const mapper of [mappers.ratedDue, mappers.unratedDue]) {
        expect(stateOf(after, mapper.osuId)?.status).toBe(
          DataFetchStatus.Fetching
        );
        expect(stateOf(after, mapper.osuId)?.lastFetch).not.toBe(
          stateOf(before, mapper.osuId)?.lastFetch
        );
      }
    });
  }
);
