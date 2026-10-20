import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { asc, eq, inArray, like } from 'drizzle-orm';
import type { API, Mod, Multiplayer } from 'osu-api-v2-js';

import * as schema from '@otr/core/db/schema';
import { Mods, Ruleset } from '@otr/core/osu/enums';

import {
  createJobsTestDb,
  silentLogger,
  testDatabaseUrl,
} from '../../../jobs/__tests__/test-db';
import type { RateLimiter } from '../../../rate-limiter';
import type { TournamentDataCompletionService } from '../tournament-data-completion-service';

// The client module reads worker env at import time.
mock.module('../../client', () => ({
  APIError: class APIError extends Error {},
}));

const { convertRoomScore } = await import('../room-fetch-service');
const { MatchFetchService } = await import('../match-fetch-service');

type ModInput = string | Mod;

const toApiMods = (mods: ModInput[]): Mod[] =>
  mods.map((mod) => (typeof mod === 'string' ? { acronym: mod } : mod));

const NAME_PREFIX = 'room-fetch-';
const ROOM_OSU_ID = 999_417_001;
const FIRST_ITEM_OSU_ID = 999_417_101;
const BEATMAP_OSU_ID = 999_417_201;
const PLAYER_OSU_ID = 999_417_301;

/**
 * The score fields the room fetch reads. `satisfies` checks their names and
 * types against the osu! API client, so a renamed field fails to compile.
 */
const createScore = (mods: ModInput[]) =>
  ({
    user_id: PLAYER_OSU_ID,
    total_score: 100_001,
    legacy_total_score: 40_000,
    mods: toApiMods(mods),
    statistics: {},
    accuracy: 0.98,
    pp: null,
    max_combo: 500,
    passed: true,
    rank: 'S',
  }) satisfies Partial<Multiplayer.Room.PlaylistItem.Score>;

const convert = (mods: ModInput[]) =>
  convertRoomScore(
    createScore(mods) as unknown as Multiplayer.Room.PlaylistItem.Score,
    null,
    Ruleset.Osu
  );

describe('convertRoomScore', () => {
  it('stores easy scores with the multiplier', () => {
    const fields = convert(['EZ', 'HD']);

    expect(fields.rawScore).toBe(100_001);
    expect(fields.adjustedScore).toBe(175_002);
    expect(fields.mods).toBe((Mods.Easy | Mods.Hidden) as Mods);
    expect(fields.legacyTotalScore).toBe(40_000);
  });

  it('stores non-easy scores unchanged', () => {
    const fields = convert(['HD']);

    expect(fields.rawScore).toBe(100_001);
    expect(fields.adjustedScore).toBeNull();
    expect(fields.legacyTotalScore).toBe(40_000);
  });

  it('stores every lazer mod with its settings', () => {
    const fields = convert([
      { acronym: 'DT', settings: { speed_change: 1.2 } },
      'DA',
      'BR',
    ]);

    expect(fields.mods).toBe(Mods.DoubleTime);
    expect(fields.lazerMods).toEqual([
      { acronym: 'DT', settings: { speed_change: 1.2 } },
      { acronym: 'DA' },
      { acronym: 'BR' },
    ]);
  });
});

interface RoomGame {
  /** The playlist item's offset from FIRST_ITEM_OSU_ID. */
  item: number;
  requiredMods?: ModInput[];
  scoreMods?: ModInput[];
}

/**
 * A finished room: each game started and completed in turn, between a room
 * creation and a disband event, with one score by one player.
 */
const createRoom = (
  games: RoomGame[],
  roomType: 'head_to_head' | 'team_versus' = 'head_to_head'
) => {
  const events: Multiplayer.Room.Event[] = [];
  const addEvent = (
    eventType: Multiplayer.Room.Event['event_type'],
    playlistItemId: number | null
  ) =>
    events.push({
      id: events.length + 1,
      event_type: eventType,
      playlist_item_id: playlistItemId,
      user_id: null,
      created_at: new Date(Date.UTC(2025, 9, 4, 12, events.length)),
    });

  addEvent('room_created', null);
  for (const game of games) {
    addEvent('game_started', FIRST_ITEM_OSU_ID + game.item);
    addEvent('game_completed', FIRST_ITEM_OSU_ID + game.item);
  }
  addEvent('room_disbanded', null);

  const playlistItems = games.map(
    (game) =>
      ({
        id: FIRST_ITEM_OSU_ID + game.item,
        beatmap_id: BEATMAP_OSU_ID,
        ruleset_id: 0,
        required_mods: toApiMods(game.requiredMods ?? []),
        details: { room_type: roomType, teams: null },
        scores: [createScore(game.scoreMods ?? [])],
      }) as unknown as Multiplayer.Room.PlaylistItem.WithDetailsScores
  );

  return {
    room: {
      id: ROOM_OSU_ID,
      name: `${NAME_PREFIX}TT: (Red) vs (Blue)`,
      type: roomType,
      starts_at: '2025-10-04T12:00:00Z',
      ends_at: '2025-10-04T13:00:00Z',
    },
    users: [{ id: PLAYER_OSU_ID, username: 'room-player', country_code: 'US' }],
    events,
    playlistItems,
  };
};

type Room = ReturnType<typeof createRoom>;

/**
 * The room as osu! serves it: the newest `pageSize` events of those before
 * `before`, with the playlist items they mention.
 */
const roomPage = (room: Room, pageSize: number, before = Infinity) => {
  const events = room.events
    .filter((event) => event.id < before)
    .slice(-pageSize);
  const itemIds = new Set(events.map((event) => event.playlist_item_id));

  return {
    room: room.room,
    users: room.users,
    events,
    playlist_items: room.playlistItems.filter((item) => itemIds.has(item.id)),
    first_event_id: room.events[0]!.id,
    last_event_id: room.events.at(-1)!.id,
  };
};

const rateLimiter: RateLimiter = { schedule: (task) => task() };

describe.skipIf(!testDatabaseUrl)('lazer room fetches', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);
  let matchId = 0;
  let queued: Array<{ executor: unknown; osuBeatmapIds: number[] }> = [];

  const serviceFor = (room: Room) =>
    new MatchFetchService({
      db,
      api: {
        getRoomEvents: async () => roomPage(room, 100),
      } as unknown as API,
      rateLimiter,
      logger: silentLogger,
      publishBeatmapFetches: async (executor, osuBeatmapIds) => {
        queued.push({ executor, osuBeatmapIds });
      },
      dataCompletion: {
        updateMatchFetchStatus: async () => {},
        checkAndTriggerAutomationChecksIfComplete: async () => {},
      } as unknown as TournamentDataCompletionService,
    });

  const fetchRoom = (room: Room) =>
    serviceFor(room).fetchAndPersist(ROOM_OSU_ID, true);

  const storedGames = () =>
    db
      .select({
        id: schema.games.id,
        osuId: schema.games.osuId,
        mods: schema.games.mods,
        lazerMods: schema.games.lazerMods,
      })
      .from(schema.games)
      .where(eq(schema.games.matchId, matchId))
      .orderBy(asc(schema.games.osuId));

  const storedScore = async () => {
    const [score] = await db
      .select({
        rawScore: schema.gameScores.rawScore,
        adjustedScore: schema.gameScores.adjustedScore,
        legacyTotalScore: schema.gameScores.legacyTotalScore,
        lazerMods: schema.gameScores.lazerMods,
      })
      .from(schema.gameScores)
      .innerJoin(schema.games, eq(schema.games.id, schema.gameScores.gameId))
      .where(eq(schema.games.matchId, matchId));
    return score;
  };

  const removeSeed = async () => {
    // Cascades to matches, games and scores
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, [PLAYER_OSU_ID]));
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, [BEATMAP_OSU_ID]));
  };

  beforeEach(async () => {
    await removeSeed();
    queued = [];

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}tournament`,
        abbreviation: 'RF',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999417',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
        isLazer: true,
      })
      .returning({ id: schema.tournaments.id });
    const [match] = await db
      .insert(schema.matches)
      .values({
        osuId: ROOM_OSU_ID,
        isLazer: true,
        tournamentId: tournament!.id,
      })
      .returning({ id: schema.matches.id });
    matchId = match!.id;
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it("stores the game's required lazer mods with their settings", async () => {
    const room = createRoom([
      {
        item: 0,
        requiredMods: [
          { acronym: 'DT', settings: { speed_change: 1.2 } },
          'BR',
        ],
      },
    ]);

    expect(await fetchRoom(room)).toBe(true);

    const [game] = await storedGames();
    expect(game?.mods).toBe(Mods.DoubleTime);
    expect(game?.lazerMods).toEqual([
      { acronym: 'DT', settings: { speed_change: 1.2 } },
      { acronym: 'BR' },
    ]);
  });

  it("queues the fetch of a game's unfetched beatmap in the transaction that stores the game", async () => {
    expect(
      await fetchRoom(createRoom([{ item: 0, requiredMods: ['BR'] }]))
    ).toBe(true);

    expect(queued).toHaveLength(1);
    expect(queued[0]!.osuBeatmapIds).toEqual([BEATMAP_OSU_ID]);
    expect(queued[0]!.executor).not.toBe(db);
  });

  it('applies the multiplier when updating an existing score', async () => {
    await fetchRoom(createRoom([{ item: 0, scoreMods: ['HD'] }]));
    await fetchRoom(createRoom([{ item: 0, scoreMods: ['EZ'] }]));

    const score = await storedScore();
    expect(score?.rawScore).toBe(100_001);
    expect(score?.adjustedScore).toBe(175_002);
    expect(score?.legacyTotalScore).toBe(40_000);
  });

  it('replaces the lazer mods when updating an existing score', async () => {
    await fetchRoom(createRoom([{ item: 0, scoreMods: ['HD'] }]));
    await fetchRoom(createRoom([{ item: 0, scoreMods: ['HD', 'BR'] }]));

    const score = await storedScore();
    expect(score?.lazerMods).toEqual([{ acronym: 'HD' }, { acronym: 'BR' }]);
  });
});
