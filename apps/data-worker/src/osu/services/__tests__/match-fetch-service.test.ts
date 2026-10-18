import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { API } from 'osu-api-v2-js';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';

import type { DatabaseClient } from '../../../db';
import type { Logger } from '../../../logging/logger';
import type { RateLimiter } from '../../../rate-limiter';
import type { TournamentDataCompletionService } from '../tournament-data-completion-service';

// The client module reads worker env at import time.
mock.module('../../client', () => ({
  APIError: class APIError extends Error {},
}));

const { MatchFetchService } = await import('../match-fetch-service');

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const NAME_PREFIX = 'match-fetch-merged-';
const HOLDER_OSU_ID = 999_217_001;
const FETCHED_OSU_ID = 999_217_002;
const HELD_GAME_OSU_ID = 999_217_101;
const NEW_GAME_OSU_ID = 999_217_102;

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

const rateLimiter: RateLimiter = { schedule: (task) => task() };

/** osu!'s response for the fetched match: one game another match holds, one new. */
const fetchedMatchResponse = {
  match: { id: FETCHED_OSU_ID, name: `${NAME_PREFIX}from osu!` },
  first_event_id: 1,
  latest_event_id: 2,
  users: [],
  events: [HELD_GAME_OSU_ID, NEW_GAME_OSU_ID].map((gameId, index) => ({
    id: index + 1,
    detail: { type: 'other' },
    game: { id: gameId, beatmap_id: 1, mode_int: 0, scores: [] },
  })),
};

/** osu!'s response for the fetched lazer room, with the same two games. */
const fetchedRoomResponse = {
  room: {
    id: FETCHED_OSU_ID,
    name: `${NAME_PREFIX}room from osu!`,
    type: 'head_to_head',
  },
  events: [{ id: 1, event_type: 'room_disbanded' }],
  playlist_items: [HELD_GAME_OSU_ID, NEW_GAME_OSU_ID].map((id) => ({
    id,
    beatmap_id: 1,
    ruleset_id: 0,
  })),
  users: [],
};

describe.skipIf(!url)(
  'MatchFetchService with games another match holds',
  () => {
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
    let tournamentId = 0;
    let holderId = 0;
    let fetchedId = 0;
    const completedTournaments: number[] = [];

    const service = new MatchFetchService({
      db,
      api: {
        getMatch: async () => fetchedMatchResponse,
        getRoomEvents: async () => fetchedRoomResponse,
      } as unknown as API,
      rateLimiter,
      logger: silentLogger,
      publishBeatmapFetch: async () => {},
      dataCompletion: {
        checkAndTriggerAutomationChecksIfComplete: async (id: number) => {
          completedTournaments.push(id);
        },
        updateMatchFetchStatus: async () => {},
      } as unknown as TournamentDataCompletionService,
    });

    const seedGame = (matchId: number, osuId: number) =>
      db.insert(schema.games).values({
        osuId,
        ruleset: Ruleset.Osu,
        scoringType: 3,
        teamType: 0,
        mods: 0,
        matchId,
      });

    const gamesOf = (matchId: number) =>
      db
        .select({ osuId: schema.games.osuId })
        .from(schema.games)
        .where(eq(schema.games.matchId, matchId));

    const removeSeed = async () => {
      // Cascades to matches, games and merges
      await db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    };

    beforeEach(async () => {
      await removeSeed();
      completedTournaments.length = 0;

      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: `${NAME_PREFIX}tournament`,
          abbreviation: 'MFM',
          forumUrl: 'https://osu.ppy.sh/community/forums/topics/999217',
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;

      const matches = await db
        .insert(schema.matches)
        .values([
          { osuId: HOLDER_OSU_ID, name: `${NAME_PREFIX}holder`, tournamentId },
          { osuId: FETCHED_OSU_ID, tournamentId },
        ])
        .returning({ id: schema.matches.id, osuId: schema.matches.osuId });
      holderId = matches.find((m) => m.osuId === HOLDER_OSU_ID)!.id;
      fetchedId = matches.find((m) => m.osuId === FETCHED_OSU_ID)!.id;

      await seedGame(holderId, HELD_GAME_OSU_ID);
    });

    afterAll(async () => {
      await removeSeed();
      await pool.end();
    });

    it('records the fetched match as merged into the match holding its games, and stores none of them', async () => {
      expect(await service.fetchAndPersist(FETCHED_OSU_ID, false)).toBe(true);

      const merges = await db
        .select({
          matchId: schema.matchMerges.matchId,
          mergedMatchId: schema.matchMerges.mergedMatchId,
          osuId: schema.matchMerges.osuId,
          isLazer: schema.matchMerges.isLazer,
          name: schema.matchMerges.name,
        })
        .from(schema.matchMerges)
        .where(eq(schema.matchMerges.osuId, FETCHED_OSU_ID));
      expect(merges).toEqual([
        {
          matchId: holderId,
          mergedMatchId: fetchedId,
          osuId: FETCHED_OSU_ID,
          isLazer: false,
          name: `${NAME_PREFIX}from osu!`,
        },
      ]);

      const fetched = await db
        .select({ id: schema.matches.id })
        .from(schema.matches)
        .where(eq(schema.matches.id, fetchedId));
      expect(fetched).toEqual([]);

      expect(await gamesOf(holderId)).toEqual([{ osuId: HELD_GAME_OSU_ID }]);
      const newGame = await db
        .select({ id: schema.games.id })
        .from(schema.games)
        .where(inArray(schema.games.osuId, [NEW_GAME_OSU_ID]));
      expect(newGame).toEqual([]);

      expect(completedTournaments).toEqual([tournamentId]);
    });

    it('keeps the holding match’s copy of a game the fetched match also stored', async () => {
      await seedGame(fetchedId, HELD_GAME_OSU_ID);

      await service.fetchAndPersist(FETCHED_OSU_ID, false);

      expect(await gamesOf(holderId)).toEqual([{ osuId: HELD_GAME_OSU_ID }]);
      const copies = await db
        .select({ id: schema.games.id })
        .from(schema.games)
        .where(eq(schema.games.osuId, HELD_GAME_OSU_ID));
      expect(copies).toHaveLength(1);
    });

    it('records a fetched lazer room as merged into the match holding its games', async () => {
      const [room] = await db
        .insert(schema.matches)
        .values({ osuId: FETCHED_OSU_ID, isLazer: true, tournamentId })
        .returning({ id: schema.matches.id });

      expect(await service.fetchAndPersist(FETCHED_OSU_ID, true)).toBe(true);

      const merges = await db
        .select({
          matchId: schema.matchMerges.matchId,
          mergedMatchId: schema.matchMerges.mergedMatchId,
          isLazer: schema.matchMerges.isLazer,
          name: schema.matchMerges.name,
        })
        .from(schema.matchMerges)
        .where(eq(schema.matchMerges.osuId, FETCHED_OSU_ID));
      expect(merges).toEqual([
        {
          matchId: holderId,
          mergedMatchId: room!.id,
          isLazer: true,
          name: `${NAME_PREFIX}room from osu!`,
        },
      ]);
      expect(await gamesOf(holderId)).toEqual([{ osuId: HELD_GAME_OSU_ID }]);
    });
  }
);
