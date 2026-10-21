import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { API } from 'osu-api-v2-js';

import { dbSchema } from '@otr/core/db';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import * as schema from '@otr/core/db/schema';
import {
  GameRejectionReason,
  Mods,
  Ruleset,
  ScoreGrade,
  ScoreRejectionReason,
  ScoringType,
  Team,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu';

import type { DatabaseClient } from '../../../db';
import type { Logger } from '../../../logging/logger';
import type { RateLimiter } from '../../../rate-limiter';
import type { TournamentDataCompletionService } from '../tournament-data-completion-service';

// The client module reads worker env at import time.
mock.module('../../client', () => ({
  APIError: class APIError extends Error {},
}));

const { MatchFetchService } = await import('../match-fetch-service');
const { APIError } = await import('../../client');

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
      publishBeatmapFetches: async () => {},
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

const STABLE_PREFIX = 'match-fetch-stable-';
const STABLE_MATCH_OSU_ID = 999_218_001;
const RED_PLAYER = {
  id: 999_218_101,
  username: 'stable-red',
  country_code: 'US',
};
const BLUE_PLAYER = {
  id: 999_218_102,
  username: 'stable-blue',
  country_code: 'KR',
};
const FIRST_BEATMAP_OSU_ID = 999_218_301;
const SECOND_BEATMAP_OSU_ID = 999_218_302;
const STABLE_GAME_OSU_IDS = [999_218_201, 999_218_202, 999_218_203];

/** A stable score as osu!'s match endpoint returns it. */
const stableScore = (
  player: { id: number },
  team: 'red' | 'blue',
  totalScore: number,
  mods: string[]
) => ({
  user_id: player.id,
  total_score: totalScore,
  legacy_total_score: totalScore,
  accuracy: 0.97,
  max_combo: 412,
  mods,
  rank: 'A',
  passed: true,
  is_perfect_combo: false,
  legacy_perfect: false,
  statistics: { great: 380, ok: 12, meh: 3, miss: 2 },
  match: { slot: team === 'red' ? 0 : 1, team, pass: true },
});

const stableGameEvent = (
  eventId: number,
  gameId: number,
  beatmapId: number,
  redTotal: number
) => ({
  id: eventId,
  detail: { type: 'other' },
  timestamp: '2026-10-01T18:05:00+00:00',
  game: {
    id: gameId,
    beatmap_id: beatmapId,
    mode_int: 0,
    scoring_type: 'scorev2',
    team_type: 'team-vs',
    mods: ['NF'],
    start_time: '2026-10-01T18:05:00+00:00',
    end_time: '2026-10-01T18:09:00+00:00',
    scores: [
      stableScore(RED_PLAYER, 'red', redTotal, ['NF', 'HD']),
      stableScore(BLUE_PLAYER, 'blue', 400_000, ['NF', 'EZ']),
    ],
  },
});

/**
 * Stands in for osu!'s match endpoint. The match has events 1 to 5, and the
 * first page holds only 2 and 3, so its other games are reached only by
 * paging `before` and `after` that page, as osu! pages a long match.
 */
const stableMatchApi = (options: { redTotal?: number; error?: Error }) => {
  const redTotal = options.redTotal ?? 500_000;
  const events = [
    { id: 1, detail: { type: 'match-created' }, timestamp: '' },
    stableGameEvent(2, STABLE_GAME_OSU_IDS[0]!, FIRST_BEATMAP_OSU_ID, redTotal),
    stableGameEvent(
      3,
      STABLE_GAME_OSU_IDS[1]!,
      SECOND_BEATMAP_OSU_ID,
      redTotal
    ),
    stableGameEvent(4, STABLE_GAME_OSU_IDS[2]!, FIRST_BEATMAP_OSU_ID, redTotal),
    { id: 5, detail: { type: 'match-disbanded' }, timestamp: '' },
  ];

  return {
    getMatch: async (
      _osuId: number,
      query?: { before?: number; after?: number }
    ) => {
      if (options.error) throw options.error;
      const page =
        query?.before !== undefined
          ? events.filter((event) => event.id < query.before!)
          : query?.after !== undefined
            ? events.filter((event) => event.id > query.after!)
            : events.filter((event) => event.id === 2 || event.id === 3);
      return {
        match: {
          id: STABLE_MATCH_OSU_ID,
          name: `${STABLE_PREFIX}OWC: (Red) vs (Blue)`,
          start_time: '2026-10-01T18:00:00+00:00',
          end_time: '2026-10-01T18:40:00+00:00',
        },
        first_event_id: 1,
        latest_event_id: 5,
        users: [RED_PLAYER, BLUE_PLAYER],
        events: page,
      };
    },
  } as unknown as API;
};

/**
 * An osu! API error with the HTTP status osu! answered, made from the mocked
 * client's `APIError`, a plain `Error` subclass.
 */
const osuError = (status: number) =>
  Object.assign(
    new (APIError as unknown as new (message: string) => Error)(
      `osu! answered ${status}`
    ),
    { response: { status_code: status } }
  );

describe.skipIf(!url)('MatchFetchService fetching a stable match', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  const playerOsuIds = [RED_PLAYER.id, BLUE_PLAYER.id];
  const beatmapOsuIds = [FIRST_BEATMAP_OSU_ID, SECOND_BEATMAP_OSU_ID];
  let matchId = 0;
  let queuedBeatmaps: number[][] = [];
  let statusUpdates: Array<[number, number]> = [];

  const serviceFor = (api: API) =>
    new MatchFetchService({
      db,
      api,
      rateLimiter,
      logger: silentLogger,
      publishBeatmapFetches: async (_tx, osuBeatmapIds) => {
        queuedBeatmaps.push(osuBeatmapIds);
      },
      dataCompletion: {
        checkAndTriggerAutomationChecksIfComplete: async () => {},
        updateMatchFetchStatus: async (id: number, status: number) => {
          statusUpdates.push([id, status]);
        },
      } as unknown as TournamentDataCompletionService,
    });

  const storedGames = () =>
    db
      .select({
        osuId: schema.games.osuId,
        beatmapOsuId: schema.beatmaps.osuId,
        ruleset: schema.games.ruleset,
        scoringType: schema.games.scoringType,
        teamType: schema.games.teamType,
        mods: schema.games.mods,
        verificationStatus: schema.games.verificationStatus,
        rejectionReason: schema.games.rejectionReason,
      })
      .from(schema.games)
      .innerJoin(
        schema.beatmaps,
        eq(schema.beatmaps.id, schema.games.beatmapId)
      )
      .where(eq(schema.games.matchId, matchId))
      .orderBy(schema.games.osuId);

  const storedScores = () =>
    db
      .select({
        gameOsuId: schema.games.osuId,
        playerOsuId: schema.players.osuId,
        rawScore: schema.gameScores.rawScore,
        score: schema.gameScores.score,
        team: schema.gameScores.team,
        mods: schema.gameScores.mods,
        accuracy: schema.gameScores.accuracy,
        grade: schema.gameScores.grade,
        statGreat: schema.gameScores.statGreat,
        statMiss: schema.gameScores.statMiss,
        pass: schema.gameScores.pass,
        verificationStatus: schema.gameScores.verificationStatus,
        rejectionReason: schema.gameScores.rejectionReason,
      })
      .from(schema.gameScores)
      .innerJoin(schema.games, eq(schema.games.id, schema.gameScores.gameId))
      .innerJoin(
        schema.players,
        eq(schema.players.id, schema.gameScores.playerId)
      )
      .where(eq(schema.games.matchId, matchId))
      .orderBy(schema.games.osuId, schema.players.osuId);

  const removeSeed = async () => {
    // Cascades to matches, games and scores
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${STABLE_PREFIX}%`));
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, playerOsuIds));
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, beatmapOsuIds));
  };

  beforeEach(async () => {
    await removeSeed();
    queuedBeatmaps = [];
    statusUpdates = [];

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${STABLE_PREFIX}tournament`,
        abbreviation: 'MFS',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999218',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    const [match] = await db
      .insert(schema.matches)
      .values({ osuId: STABLE_MATCH_OSU_ID, tournamentId: tournament!.id })
      .returning({ id: schema.matches.id });
    matchId = match!.id;
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it('stores the match, every game on every page, their scores and players, and queues their beatmaps', async () => {
    expect(
      await serviceFor(stableMatchApi({})).fetchAndPersist(
        STABLE_MATCH_OSU_ID,
        false
      )
    ).toBe(true);

    const [match] = await db
      .select({
        name: schema.matches.name,
        startTime: schema.matches.startTime,
        endTime: schema.matches.endTime,
      })
      .from(schema.matches)
      .where(eq(schema.matches.id, matchId));
    expect(match!.name).toBe(`${STABLE_PREFIX}OWC: (Red) vs (Blue)`);
    expect(new Date(match!.startTime!).toISOString()).toBe(
      '2026-10-01T18:00:00.000Z'
    );
    expect(new Date(match!.endTime!).toISOString()).toBe(
      '2026-10-01T18:40:00.000Z'
    );
    expect(statusUpdates).toEqual([[matchId, DataFetchStatus.Fetched]]);

    const game = {
      ruleset: Ruleset.Osu,
      scoringType: ScoringType.ScoreV2,
      teamType: TeamType.TeamVs,
      mods: Mods.NoFail,
      verificationStatus: VerificationStatus.None,
      rejectionReason: GameRejectionReason.None,
    };
    expect(await storedGames()).toEqual([
      {
        osuId: STABLE_GAME_OSU_IDS[0]!,
        beatmapOsuId: FIRST_BEATMAP_OSU_ID,
        ...game,
      },
      {
        osuId: STABLE_GAME_OSU_IDS[1]!,
        beatmapOsuId: SECOND_BEATMAP_OSU_ID,
        ...game,
      },
      {
        osuId: STABLE_GAME_OSU_IDS[2]!,
        beatmapOsuId: FIRST_BEATMAP_OSU_ID,
        ...game,
      },
    ]);

    const scores = await storedScores();
    expect(scores).toHaveLength(6);
    const score = {
      accuracy: 0.97,
      grade: ScoreGrade.A,
      statGreat: 380,
      statMiss: 2,
      pass: true,
      verificationStatus: VerificationStatus.None,
      rejectionReason: ScoreRejectionReason.None,
    };
    expect(scores.slice(0, 2)).toEqual([
      {
        gameOsuId: STABLE_GAME_OSU_IDS[0]!,
        playerOsuId: RED_PLAYER.id,
        rawScore: 500_000,
        score: 500_000,
        team: Team.Red,
        mods: Mods.NoFail | Mods.Hidden,
        ...score,
      },
      {
        gameOsuId: STABLE_GAME_OSU_IDS[0]!,
        playerOsuId: BLUE_PLAYER.id,
        rawScore: 400_000,
        // Easy scores count 1.75 times over: 400,000 × 1.75
        score: 700_000,
        team: Team.Blue,
        mods: Mods.NoFail | Mods.Easy,
        ...score,
      },
    ]);

    const players = await db
      .select({
        osuId: schema.players.osuId,
        username: schema.players.username,
        country: schema.players.country,
      })
      .from(schema.players)
      .where(inArray(schema.players.osuId, playerOsuIds))
      .orderBy(schema.players.osuId);
    expect(players).toEqual([
      { osuId: RED_PLAYER.id, username: 'stable-red', country: 'US' },
      { osuId: BLUE_PLAYER.id, username: 'stable-blue', country: 'KR' },
    ]);

    // Each new beatmap once, queued with the games and marked as fetching
    expect(queuedBeatmaps).toEqual([beatmapOsuIds]);
    const beatmaps = await db
      .select({ dataFetchStatus: schema.beatmaps.dataFetchStatus })
      .from(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, beatmapOsuIds));
    expect(beatmaps).toEqual([
      { dataFetchStatus: DataFetchStatus.Fetching },
      { dataFetchStatus: DataFetchStatus.Fetching },
    ]);
  });

  it('updates the stored games and scores when the match is fetched again', async () => {
    await serviceFor(stableMatchApi({})).fetchAndPersist(
      STABLE_MATCH_OSU_ID,
      false
    );

    await serviceFor(stableMatchApi({ redTotal: 650_000 })).fetchAndPersist(
      STABLE_MATCH_OSU_ID,
      false
    );

    expect(await storedGames()).toHaveLength(3);
    const scores = await storedScores();
    expect(scores).toHaveLength(6);
    expect(
      scores
        .filter((score) => score.playerOsuId === RED_PLAYER.id)
        .map((score) => score.rawScore)
    ).toEqual([650_000, 650_000, 650_000]);
  });

  it('stores the games and scores of a rejected match as rejected', async () => {
    await db
      .update(schema.matches)
      .set({ verificationStatus: VerificationStatus.Rejected })
      .where(eq(schema.matches.id, matchId));

    await serviceFor(stableMatchApi({})).fetchAndPersist(
      STABLE_MATCH_OSU_ID,
      false
    );

    const games = await storedGames();
    expect(games).toHaveLength(3);
    for (const game of games) {
      expect(game.verificationStatus).toBe(VerificationStatus.Rejected);
      expect(
        game.rejectionReason & GameRejectionReason.RejectedMatch
      ).toBeTruthy();
    }
    const scores = await storedScores();
    expect(scores).toHaveLength(6);
    for (const score of scores) {
      expect(score.verificationStatus).toBe(VerificationStatus.Rejected);
      expect(
        score.rejectionReason & ScoreRejectionReason.RejectedGame
      ).toBeTruthy();
    }
  });

  it.each([
    ['missing from osu!', 404, DataFetchStatus.NotFound],
    ['refused by osu!', 401, DataFetchStatus.Error],
  ])(
    'records a match %s and stores nothing',
    async (_case, httpStatus, fetchStatus) => {
      expect(
        await serviceFor(
          stableMatchApi({ error: osuError(httpStatus) })
        ).fetchAndPersist(STABLE_MATCH_OSU_ID, false)
      ).toBe(false);

      expect(statusUpdates).toEqual([[matchId, fetchStatus]]);
      expect(await storedGames()).toEqual([]);
      expect(queuedBeatmaps).toEqual([]);
    }
  );
});
