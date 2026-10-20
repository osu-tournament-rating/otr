import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import {
  ADMIN_EDIT_FIELD_GROUPS,
  excludeMergedGames,
  mergeMatchesInto,
  withAuditUserId,
} from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import {
  Mods,
  Ruleset,
  ScoreRejectionReason,
  Team,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu/enums';

import type { DatabaseClient } from '../../../db';
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

const { MatchFetchService } = await import('../match-fetch-service');

const NAME_PREFIX = 'refetch-admin-edits-';
const MATCH_OSU_ID = 999_517_001;
const OTHER_MATCH_OSU_ID = 999_517_002;
const GAME_OSU_ID = 999_517_101;
const SECOND_GAME_OSU_ID = 999_517_102;
const OTHER_MATCH_GAME_OSU_ID = 999_517_103;
const BEATMAP_OSU_ID = 999_517_201;
const ADMIN_OSU_ID = 999_517_300;
const PLAYER_OSU_IDS = [999_517_301, 999_517_302];

interface OsuScore {
  player: number;
  maxCombo?: number;
  team?: 'red' | 'blue' | 'none';
}

interface OsuGame {
  osuId: number;
  startTime?: string;
  teamType?: 'head-to-head' | 'team-vs';
  scores: OsuScore[];
}

/** A stable match as the osu! API returns it, every event on one page. */
const stableMatch = (osuId: number, name: string, games: OsuGame[]) => ({
  match: { id: osuId, name },
  first_event_id: 1,
  latest_event_id: games.length,
  users: PLAYER_OSU_IDS.map((id, index) => ({
    id,
    username: `${NAME_PREFIX}player-${index}`,
    country_code: 'US',
  })),
  events: games.map((game, index) => ({
    id: index + 1,
    detail: { type: 'other' },
    game: {
      id: game.osuId,
      beatmap_id: BEATMAP_OSU_ID,
      mode_int: 0,
      scoring_type: 'scorev2',
      team_type: game.teamType ?? 'head-to-head',
      mods: [],
      start_time: game.startTime ?? '2025-10-04T12:00:00Z',
      end_time: '2025-10-04T12:05:00Z',
      scores: game.scores.map((score) => ({
        user_id: PLAYER_OSU_IDS[score.player],
        total_score: 500_000 + score.player,
        legacy_total_score: 0,
        accuracy: 0.95,
        max_combo: score.maxCombo ?? 300,
        mods: [],
        rank: 'A',
        passed: true,
        is_perfect_combo: false,
        legacy_perfect: false,
        statistics: { great: 280, ok: 10, meh: 0, miss: 2 },
        match: { team: score.team ?? 'none', pass: true },
      })),
    },
  })),
});

type OsuMatch = ReturnType<typeof stableMatch>;

const rateLimiter: RateLimiter = { schedule: (task) => task() };

describe.skipIf(!testDatabaseUrl)('refetching a match', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);
  let osuMatches = new Map<number, OsuMatch>();
  let tournamentId = 0;
  let adminUserId = 0;

  const service = new MatchFetchService({
    db,
    api: {
      getMatch: async (osuId: number) => osuMatches.get(osuId),
    } as unknown as API,
    rateLimiter,
    logger: silentLogger,
    publishBeatmapFetches: async () => {},
    dataCompletion: {
      updateMatchFetchStatus: async () => {},
      checkAndTriggerAutomationChecksIfComplete: async () => {},
    } as unknown as TournamentDataCompletionService,
  });

  const serve = (osuId: number, name: string, games: OsuGame[]) =>
    osuMatches.set(osuId, stableMatch(osuId, name, games));

  const fetchMatch = async (osuId = MATCH_OSU_ID) => {
    expect(await service.fetchAndPersist(osuId, false)).toBe(true);
  };

  /** Runs `write` as the admin, the way every admin procedure writes. */
  const asAdmin = (write: (tx: DatabaseClient) => Promise<unknown>) =>
    db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, () =>
        write(tx as unknown as DatabaseClient)
      )
    );

  const matchRow = async (osuId = MATCH_OSU_ID) => {
    const [match] = await db
      .select()
      .from(schema.matches)
      .where(
        and(eq(schema.matches.osuId, osuId), eq(schema.matches.isLazer, false))
      );
    return match!;
  };

  const gamesOf = (matchId: number) =>
    db
      .select()
      .from(schema.games)
      .where(eq(schema.games.matchId, matchId))
      .orderBy(asc(schema.games.osuId));

  const gameRow = async (osuId: number) => {
    const [game] = await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.osuId, osuId));
    return game!;
  };

  const playerId = async (index: number) => {
    const [player] = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(eq(schema.players.osuId, PLAYER_OSU_IDS[index]!));
    return player!.id;
  };

  const scoresOf = (gameId: number) =>
    db
      .select()
      .from(schema.gameScores)
      .where(eq(schema.gameScores.gameId, gameId))
      .orderBy(asc(schema.gameScores.playerId));

  const removeSeed = async () => {
    // Cascades to matches, games, scores, merges and exclusions
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    const players = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(inArray(schema.players.osuId, [ADMIN_OSU_ID, ...PLAYER_OSU_IDS]));
    const playerIds = players.map((player) => player.id);
    if (playerIds.length > 0) {
      await db
        .delete(schema.users)
        .where(inArray(schema.users.playerId, playerIds));
      await db
        .delete(schema.players)
        .where(inArray(schema.players.id, playerIds));
    }
    await db
      .delete(schema.beatmaps)
      .where(eq(schema.beatmaps.osuId, BEATMAP_OSU_ID));
  };

  beforeEach(async () => {
    await removeSeed();
    osuMatches = new Map();

    const [admin] = await db
      .insert(schema.players)
      .values({ osuId: ADMIN_OSU_ID, username: `${NAME_PREFIX}admin` })
      .returning({ id: schema.players.id });
    const [user] = await db
      .insert(schema.users)
      .values({ playerId: admin!.id, scopes: ['admin'] })
      .returning({ id: schema.users.id });
    adminUserId = user!.id;

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}tournament`,
        abbreviation: 'RAE',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999517',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;

    await db.insert(schema.matches).values([
      { osuId: MATCH_OSU_ID, tournamentId },
      { osuId: OTHER_MATCH_OSU_ID, tournamentId },
    ]);
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it('keeps the fields an admin edited and refreshes the rest from osu!', async () => {
    serve(MATCH_OSU_ID, `${NAME_PREFIX}osu name`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }] },
    ]);
    await fetchMatch();
    const match = await matchRow();
    const game = await gameRow(GAME_OSU_ID);
    const [score] = await scoresOf(game.id);

    await asAdmin(async (tx) => {
      await tx
        .update(schema.matches)
        .set({ name: `${NAME_PREFIX}renamed` })
        .where(eq(schema.matches.id, match.id));
      await tx
        .update(schema.games)
        .set({ teamType: TeamType.TeamVs, mods: Mods.Hidden, lazerMods: null })
        .where(eq(schema.games.id, game.id));
      await tx
        .update(schema.gameScores)
        .set({ accuracy: 0.5, team: Team.Red, mods: Mods.Easy })
        .where(eq(schema.gameScores.id, score!.id));
    });

    // osu! now reports a later start and a higher combo.
    serve(MATCH_OSU_ID, `${NAME_PREFIX}osu name`, [
      {
        osuId: GAME_OSU_ID,
        startTime: '2025-10-04T12:01:00Z',
        scores: [{ player: 0, maxCombo: 450 }],
      },
    ]);
    await fetchMatch();

    const refetchedMatch = await matchRow();
    expect(refetchedMatch.name).toBe(`${NAME_PREFIX}renamed`);
    expect(refetchedMatch.editedFields).toEqual(['name']);

    const refetchedGame = await gameRow(GAME_OSU_ID);
    expect(refetchedGame.teamType).toBe(TeamType.TeamVs);
    expect(refetchedGame.mods).toBe(Mods.Hidden);
    expect(new Date(refetchedGame.startTime).toISOString()).toBe(
      '2025-10-04T12:01:00.000Z'
    );
    expect(refetchedGame.editedFields).toEqual([
      'lazer_mods',
      'mods',
      'team_type',
    ]);

    const [refetchedScore] = await scoresOf(game.id);
    expect(refetchedScore).toMatchObject({
      accuracy: 0.5,
      team: Team.Red,
      mods: Mods.Easy,
      maxCombo: 450,
      editedFields: ['accuracy', 'lazer_mods', 'mods', 'team'],
    });
  });

  it("keeps a rejected score's rejection reason", async () => {
    serve(MATCH_OSU_ID, `${NAME_PREFIX}match`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }] },
    ]);
    await fetchMatch();
    const game = await gameRow(GAME_OSU_ID);
    const [score] = await scoresOf(game.id);

    await asAdmin((tx) =>
      tx
        .update(schema.gameScores)
        .set({
          verificationStatus: VerificationStatus.Rejected,
          rejectionReason: ScoreRejectionReason.InvalidMods,
        })
        .where(eq(schema.gameScores.id, score!.id))
    );

    await fetchMatch();

    const [refetched] = await scoresOf(game.id);
    expect(refetched?.verificationStatus).toBe(VerificationStatus.Rejected);
    expect(refetched?.rejectionReason).toBe(ScoreRejectionReason.InvalidMods);
  });

  it('does not add back a game or a score an admin deleted', async () => {
    serve(MATCH_OSU_ID, `${NAME_PREFIX}match`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }, { player: 1 }] },
      { osuId: SECOND_GAME_OSU_ID, scores: [{ player: 0 }] },
    ]);
    await fetchMatch();
    const game = await gameRow(GAME_OSU_ID);
    const secondPlayerId = await playerId(1);

    await asAdmin(async (tx) => {
      await tx
        .delete(schema.games)
        .where(eq(schema.games.osuId, SECOND_GAME_OSU_ID));
      await tx
        .delete(schema.gameScores)
        .where(
          and(
            eq(schema.gameScores.gameId, game.id),
            eq(schema.gameScores.playerId, secondPlayerId)
          )
        );
    });

    await fetchMatch();

    const match = await matchRow();
    expect((await gamesOf(match.id)).map((row) => row.osuId)).toEqual([
      GAME_OSU_ID,
    ]);
    expect((await scoresOf(game.id)).map((row) => row.playerId)).toEqual([
      await playerId(0),
    ]);
  });

  it('refreshes a merged-away game’s scores in the game it was merged into, without adding it back', async () => {
    serve(MATCH_OSU_ID, `${NAME_PREFIX}match`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }] },
      { osuId: SECOND_GAME_OSU_ID, scores: [{ player: 1 }] },
    ]);
    await fetchMatch();
    const parent = await gameRow(GAME_OSU_ID);
    const child = await gameRow(SECOND_GAME_OSU_ID);

    // The steps of the game merge procedure.
    await asAdmin(async (tx) => {
      await tx
        .update(schema.gameScores)
        .set({ gameId: parent.id })
        .where(eq(schema.gameScores.gameId, child.id));
      await excludeMergedGames(tx, parent, [child]);
      await tx.delete(schema.games).where(eq(schema.games.id, child.id));
    });

    serve(MATCH_OSU_ID, `${NAME_PREFIX}match`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }] },
      { osuId: SECOND_GAME_OSU_ID, scores: [{ player: 1, maxCombo: 999 }] },
    ]);
    await fetchMatch();

    const match = await matchRow();
    expect((await gamesOf(match.id)).map((row) => row.osuId)).toEqual([
      GAME_OSU_ID,
    ]);
    const scores = await scoresOf(parent.id);
    expect(
      scores.map((row) => ({ playerId: row.playerId, maxCombo: row.maxCombo }))
    ).toEqual([
      { playerId: await playerId(0), maxCombo: 300 },
      { playerId: await playerId(1), maxCombo: 999 },
    ]);
  });

  it('refreshes the games of a match merged into it, and keeps that match’s deleted games out', async () => {
    serve(MATCH_OSU_ID, `${NAME_PREFIX}match`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }] },
    ]);
    serve(OTHER_MATCH_OSU_ID, `${NAME_PREFIX}other match`, [
      { osuId: OTHER_MATCH_GAME_OSU_ID, scores: [{ player: 1 }] },
      { osuId: SECOND_GAME_OSU_ID, scores: [{ player: 1 }] },
    ]);
    await fetchMatch(MATCH_OSU_ID);
    await fetchMatch(OTHER_MATCH_OSU_ID);
    const parent = await matchRow(MATCH_OSU_ID);
    const child = await matchRow(OTHER_MATCH_OSU_ID);

    await asAdmin(async (tx) => {
      await tx
        .delete(schema.games)
        .where(eq(schema.games.osuId, SECOND_GAME_OSU_ID));
      await mergeMatchesInto(tx, parent.id, [
        { ...child, tournamentId: child.tournamentId },
      ]);
    });

    serve(OTHER_MATCH_OSU_ID, `${NAME_PREFIX}other match`, [
      {
        osuId: OTHER_MATCH_GAME_OSU_ID,
        teamType: 'team-vs',
        scores: [{ player: 1, maxCombo: 777 }],
      },
      { osuId: SECOND_GAME_OSU_ID, scores: [{ player: 1 }] },
    ]);
    await fetchMatch(MATCH_OSU_ID);

    const games = await gamesOf(parent.id);
    expect(games.map((row) => row.osuId)).toEqual([
      GAME_OSU_ID,
      OTHER_MATCH_GAME_OSU_ID,
    ]);
    const mergedGame = games.find(
      (row) => row.osuId === OTHER_MATCH_GAME_OSU_ID
    )!;
    expect(mergedGame.teamType).toBe(TeamType.TeamVs);
    expect((await scoresOf(mergedGame.id)).map((row) => row.maxCombo)).toEqual([
      777,
    ]);
  });

  it('lets system writes change placement and status but not an edited field', async () => {
    serve(MATCH_OSU_ID, `${NAME_PREFIX}match`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }] },
    ]);
    await fetchMatch();
    const game = await gameRow(GAME_OSU_ID);
    const [score] = await scoresOf(game.id);

    await asAdmin((tx) =>
      tx
        .update(schema.gameScores)
        .set({ team: Team.Red })
        .where(eq(schema.gameScores.id, score!.id))
    );

    // As the processor and the automated checks write: no admin.
    await db
      .update(schema.gameScores)
      .set({
        team: Team.Blue,
        placement: 3,
        verificationStatus: VerificationStatus.PreVerified,
        editedFields: [],
      })
      .where(eq(schema.gameScores.id, score!.id));

    const [written] = await scoresOf(game.id);
    expect(written).toMatchObject({
      team: Team.Red,
      placement: 3,
      verificationStatus: VerificationStatus.PreVerified,
      editedFields: ['team'],
    });
  });

  it('still lets an admin delete a match, whose games and scores go with it', async () => {
    serve(MATCH_OSU_ID, `${NAME_PREFIX}match`, [
      { osuId: GAME_OSU_ID, scores: [{ player: 0 }] },
    ]);
    await fetchMatch();
    const match = await matchRow();

    await asAdmin((tx) =>
      tx.delete(schema.matches).where(eq(schema.matches.id, match.id))
    );

    expect(await gamesOf(match.id)).toEqual([]);
  });

  it("locks the field groups admin-edits.ts lists, in the database's trigger", async () => {
    // tgargs holds the arguments as NUL-terminated strings.
    const triggers = await db.execute<{ table_name: string; args: string[] }>(
      sql`SELECT
            tgrelid::regclass::text AS table_name,
            array_remove(string_to_array(encode(tgargs, 'escape'), '\\000'), '') AS args
          FROM pg_trigger
          WHERE tgname LIKE '%keep_admin_edits'`
    );

    const actual: Record<string, readonly (readonly string[])[]> =
      Object.fromEntries(
        triggers.rows.map((row) => [
          row.table_name,
          row.args.map((group) => group.split(' ')),
        ])
      );
    expect(actual).toEqual(ADMIN_EDIT_FIELD_GROUPS);
  });
});
