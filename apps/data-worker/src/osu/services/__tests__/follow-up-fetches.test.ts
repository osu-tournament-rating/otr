import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { inArray, like, sql } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import * as schema from '@otr/core/db/schema';
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

const { MatchFetchService } = await import('../match-fetch-service');
const { BeatmapFetchService } = await import('../beatmap-fetch-service');
const { TournamentDataCompletionService } =
  await import('../tournament-data-completion-service');

const NAME_PREFIX = 'follow-up-fetches-';
const MATCH_OSU_ID = 999_317_001;
const GAME_OSU_ID = 999_317_101;
const BEATMAP_OSU_ID = 999_317_201;
const BEATMAPSET_OSU_ID = 999_317_301;
const MAPPER_OSU_ID = 999_317_401;

const rateLimiter: RateLimiter = { schedule: (task) => task() };

describe.skipIf(!testDatabaseUrl)(
  'follow-up fetches the worker queues with the data it saves',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);
    const completion = new TournamentDataCompletionService({
      db,
      logger: silentLogger,
    });
    let executors: unknown[] = [];

    const queuedPayloads = async () => {
      const { rows } = await db.execute<{ payload: Record<string, unknown> }>(
        sql`SELECT payload FROM jobs WHERE queue = ${JobQueue.OsuFetch}
          AND ((payload->>'beatmapId')::bigint = ${BEATMAP_OSU_ID}
            OR (payload->>'osuPlayerId')::bigint = ${MAPPER_OSU_ID})`
      );
      return rows.map((row) => row.payload);
    };

    const cleanUp = async () => {
      await db.execute(sql`DELETE FROM jobs WHERE queue = ${JobQueue.OsuFetch}
        AND ((payload->>'beatmapId')::bigint = ${BEATMAP_OSU_ID}
          OR (payload->>'osuPlayerId')::bigint = ${MAPPER_OSU_ID})`);
      await db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
      await db
        .delete(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, [BEATMAP_OSU_ID]));
      await db
        .delete(schema.beatmapsets)
        .where(inArray(schema.beatmapsets.osuId, [BEATMAPSET_OSU_ID]));
      await db
        .delete(schema.players)
        .where(inArray(schema.players.osuId, [MAPPER_OSU_ID]));
    };

    beforeEach(async () => {
      executors = [];
      await cleanUp();
    });

    afterAll(async () => {
      await cleanUp();
      await pool.end();
    });

    it("queues a stable match's unfetched beatmaps in the transaction that stores its games", async () => {
      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: `${NAME_PREFIX}tournament`,
          abbreviation: 'FUF',
          forumUrl: 'https://osu.ppy.sh/community/forums/topics/999317',
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
        })
        .returning({ id: schema.tournaments.id });
      await db
        .insert(schema.matches)
        .values({ osuId: MATCH_OSU_ID, tournamentId: tournament!.id });

      const service = new MatchFetchService({
        db,
        api: {
          getMatch: async () => ({
            match: { id: MATCH_OSU_ID, name: `${NAME_PREFIX}match` },
            first_event_id: 1,
            latest_event_id: 1,
            users: [],
            events: [
              {
                id: 1,
                detail: { type: 'other' },
                game: {
                  id: GAME_OSU_ID,
                  beatmap_id: BEATMAP_OSU_ID,
                  mode_int: 0,
                  scores: [],
                },
              },
            ],
          }),
        } as unknown as API,
        rateLimiter,
        logger: silentLogger,
        publishBeatmapFetches: async (executor, osuBeatmapIds) => {
          executors.push(executor);
          await enqueueJobs(
            executor,
            JobQueue.OsuFetch,
            osuBeatmapIds.map((beatmapId) => ({
              payload: { type: 'beatmap' as const, beatmapId },
            }))
          );
        },
        dataCompletion: completion,
      });

      expect(await service.fetchAndPersist(MATCH_OSU_ID, false)).toBe(true);

      expect(await queuedPayloads()).toEqual([
        { type: 'beatmap', beatmapId: BEATMAP_OSU_ID },
      ]);
      expect(executors).toHaveLength(1);
      expect(executors[0]).not.toBe(db);
    });

    it("queues a beatmap's mappers in the transaction that stores the beatmap", async () => {
      const difficulty = {
        id: BEATMAP_OSU_ID,
        user_id: MAPPER_OSU_ID,
        mode_int: 0,
        status: 'ranked',
        version: 'Follow-up',
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
      };

      const service = new BeatmapFetchService({
        db,
        api: {
          getBeatmap: async () => ({
            ...difficulty,
            beatmapset_id: BEATMAPSET_OSU_ID,
          }),
          getBeatmapset: async () => ({
            id: BEATMAPSET_OSU_ID,
            user_id: MAPPER_OSU_ID,
            creator: `${NAME_PREFIX}mapper`,
            artist: 'Artist',
            title: 'Title',
            status: 'ranked',
            ranked_date: '2024-01-01T00:00:00Z',
            submitted_date: '2023-12-01T00:00:00Z',
            beatmaps: [difficulty],
          }),
        } as unknown as API,
        rateLimiter,
        logger: silentLogger,
        dataCompletion: completion,
        publishPlayerFetches: async (executor, osuPlayerIds) => {
          executors.push(executor);
          await enqueueJobs(
            executor,
            JobQueue.OsuFetch,
            osuPlayerIds.map((osuPlayerId) => ({
              payload: { type: 'player' as const, osuPlayerId },
            }))
          );
        },
      });

      expect(await service.fetchAndPersist(BEATMAP_OSU_ID)).toBe(true);

      expect(await queuedPayloads()).toEqual([
        { type: 'player', osuPlayerId: MAPPER_OSU_ID },
      ]);
      expect(executors).toHaveLength(1);
      expect(executors[0]).not.toBe(db);
    });
  }
);
