import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset, Team, VerificationStatus } from '@otr/core/osu';

import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import {
  GameAutomationChecks,
  MatchAutomationChecks,
  ScoreAutomationChecks,
  TournamentAutomationCheckService,
  TournamentAutomationChecks,
} from '../index';
import { MAX_CHECK_RUNS } from '../tournament-automation-check-service';

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const NAME = 'automation-check-writes';
const PLAYER_OSU_IDS = [991_119_001, 991_119_002, 991_119_003, 991_119_004];
const MATCH_OSU_ID = 991_119_100;
const GAME_OSU_ID_BASE = 991_119_200;

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

const { PreVerified, PreRejected, Verified } = VerificationStatus;

/**
 * `db` with `afterRead` run each time the checks finish reading the
 * tournament, before they evaluate it and save what they decided.
 */
const pausedAfterRead = (
  db: DatabaseClient,
  afterRead: (read: number) => Promise<void>
): DatabaseClient => {
  let reads = 0;

  const withHook = <T extends object>(client: T): T =>
    new Proxy(client, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;

        if (property === 'query') {
          const query = value as DatabaseClient['query'];
          return {
            ...query,
            tournaments: {
              ...query.tournaments,
              findFirst: async (
                ...args: Parameters<typeof query.tournaments.findFirst>
              ) => {
                const row = await query.tournaments.findFirst(...args);
                reads += 1;
                await afterRead(reads);
                return row;
              },
            },
          };
        }

        if (property === 'transaction') {
          const transaction = value as DatabaseClient['transaction'];
          return (
            callback: Parameters<typeof transaction>[0],
            config?: Parameters<typeof transaction>[1]
          ) =>
            transaction.call(
              target,
              (tx) => callback(withHook(tx) as typeof tx),
              config
            );
        }

        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  return withHook(db);
};

const checksFor = (db: DatabaseClient) =>
  new TournamentAutomationCheckService({
    db,
    logger: silentLogger,
    tournamentChecks: new TournamentAutomationChecks(),
    matchChecks: new MatchAutomationChecks(),
    gameChecks: new GameAutomationChecks(),
    scoreChecks: new ScoreAutomationChecks(),
  });

describe.skipIf(!url)('TournamentAutomationCheckService writes', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  let tournamentId = 0;
  let lowScoreId = 0;

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME}%`));
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, PLAYER_OSU_IDS));
  };

  /**
   * A tournament the checks pass: one match of four games, two players a
   * side. Every row starts in `status`, and one score in the first game is
   * below the minimum.
   */
  const seed = async (status: VerificationStatus) => {
    const players = await db
      .insert(schema.players)
      .values(PLAYER_OSU_IDS.map((osuId) => ({ osuId })))
      .returning({ id: schema.players.id });

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: NAME,
        abbreviation: 'ACW',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/991119',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 2,
        verificationStatus: status,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;

    const [match] = await db
      .insert(schema.matches)
      .values({
        osuId: MATCH_OSU_ID,
        name: 'ACW: (Red) vs (Blue)',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-01T02:00:00Z',
        tournamentId,
        verificationStatus: status,
      })
      .returning({ id: schema.matches.id });

    for (let index = 0; index < 4; index++) {
      const [game] = await db
        .insert(schema.games)
        .values({
          osuId: GAME_OSU_ID_BASE + index,
          ruleset: Ruleset.Osu,
          scoringType: 3,
          teamType: 2,
          mods: 0,
          startTime: `2024-01-01T00:${10 + index}:00Z`,
          endTime: `2024-01-01T00:${20 + index}:00Z`,
          matchId: match!.id,
          verificationStatus: status,
        })
        .returning({ id: schema.games.id });

      const scores = await db
        .insert(schema.gameScores)
        .values(
          players.map((player, position) => ({
            rawScore: index === 0 && position === 0 ? 500 : 100_000,
            placement: position + 1,
            accuracy: 0.95,
            maxCombo: 100,
            pass: true,
            isPerfectCombo: false,
            legacyPerfect: false,
            grade: 1,
            mods: 0,
            legacyTotalScore: 0,
            team: position < 2 ? Team.Red : Team.Blue,
            ruleset: Ruleset.Osu,
            verificationStatus: status,
            rejectionReason: 0,
            gameId: game!.id,
            playerId: player.id,
          }))
        )
        .returning({ id: schema.gameScores.id });

      if (index === 0) {
        lowScoreId = scores[0]!.id;
      }
    }
  };

  const scoreStatus = async (id: number) => {
    const [row] = await db
      .select({ verificationStatus: schema.gameScores.verificationStatus })
      .from(schema.gameScores)
      .where(eq(schema.gameScores.id, id));
    return row!.verificationStatus;
  };

  beforeEach(removeSeed);

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it('keeps a decision an admin saves while the checks run', async () => {
    await seed(PreVerified);

    // The admin accepts the low score after the checks have read it
    const reads: number[] = [];
    const interleaved = pausedAfterRead(db, async (read) => {
      reads.push(read);
      if (read === 1) {
        await db
          .update(schema.gameScores)
          .set({ verificationStatus: Verified })
          .where(eq(schema.gameScores.id, lowScoreId));
      }
    });

    await checksFor(interleaved).processAutomationChecks(tournamentId);

    expect(await scoreStatus(lowScoreId)).toBe(Verified);
    // The first run met the admin's save and the checks read again
    expect(reads).toEqual([1, 2]);
  });

  it('leaves a check that keeps meeting other writes to the job retry', async () => {
    await seed(PreVerified);

    // Something else saves the low score after every read
    let reads = 0;
    const interleaved = pausedAfterRead(db, async (read) => {
      reads = read;
      await db
        .update(schema.gameScores)
        .set({ accuracy: 0.9 + read / 100 })
        .where(eq(schema.gameScores.id, lowScoreId));
    });

    await expect(
      checksFor(interleaved).processAutomationChecks(tournamentId)
    ).rejects.toThrow();

    expect(reads).toBe(MAX_CHECK_RUNS);
    expect(await scoreStatus(lowScoreId)).toBe(PreVerified);
  });

  it('saves only the results that changed', async () => {
    await seed(PreVerified);

    await checksFor(db).processAutomationChecks(tournamentId);

    const scores = await db
      .select({
        id: schema.gameScores.id,
        verificationStatus: schema.gameScores.verificationStatus,
        updated: schema.gameScores.updated,
      })
      .from(schema.gameScores)
      .innerJoin(schema.games, eq(schema.games.id, schema.gameScores.gameId))
      .innerJoin(schema.matches, eq(schema.matches.id, schema.games.matchId))
      .where(eq(schema.matches.tournamentId, tournamentId));
    const saved = scores.filter((score) => score.updated !== null);

    expect(scores).toHaveLength(16);
    expect(saved).toEqual([
      expect.objectContaining({
        id: lowScoreId,
        verificationStatus: PreRejected,
      }),
    ]);
  });

  it('writes nothing when no result changes', async () => {
    await seed(Verified);
    const rows = async () => ({
      tournaments: await db
        .select({ updated: schema.tournaments.updated })
        .from(schema.tournaments)
        .where(eq(schema.tournaments.id, tournamentId)),
      scores: await db
        .select({
          id: schema.gameScores.id,
          updated: schema.gameScores.updated,
        })
        .from(schema.gameScores)
        .innerJoin(schema.games, eq(schema.games.id, schema.gameScores.gameId))
        .innerJoin(schema.matches, eq(schema.matches.id, schema.games.matchId))
        .where(eq(schema.matches.tournamentId, tournamentId))
        .orderBy(schema.gameScores.id),
    });
    const before = await rows();

    await checksFor(db).processAutomationChecks(tournamentId);

    expect(before.scores).toHaveLength(16);
    expect(await rows()).toEqual(before);
  });
});
