import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, like } from 'drizzle-orm';

import { withAuditUserId } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Mods, Ruleset, Team, VerificationStatus } from '@otr/core/osu';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

import { resetEditedFieldsHandler } from '../shared/resetEditedFields';
import { updateTournamentAdminHandler } from '../tournaments/adminProcedures';
import {
  adminSession,
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
} from './test-utils';

const NAME_PREFIX = 'admin-edits-';
const ADMIN_OSU_ID = 999_617_000;
const PLAYER_OSU_ID = 999_617_001;
const MATCH_OSU_ID = 999_617_101;
const GAME_OSU_ID = 999_617_201;

describe.skipIf(!testDatabaseUrl)('admin edits', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let adminUserId = 0;
  let tournamentId = 0;
  let matchId = 0;
  let gameId = 0;
  let scoreId = 0;

  const removeSeed = async () => {
    await deleteJobs(db, adminUserId);
    // Cascades to matches, games and scores
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await removePlayers(db, [PLAYER_OSU_ID]);
  };

  const scoreRow = async () => {
    const [score] = await db
      .select()
      .from(schema.gameScores)
      .where(eq(schema.gameScores.id, scoreId));
    return score!;
  };

  beforeEach(async () => {
    await removeSeed();
    adminUserId = await seedAdminUser(db, ADMIN_OSU_ID);

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}tournament`,
        abbreviation: 'AE',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999617',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.ManiaOther,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;

    const [match] = await db
      .insert(schema.matches)
      .values({
        osuId: MATCH_OSU_ID,
        tournamentId,
        dataFetchStatus: DataFetchStatus.Fetched,
      })
      .returning({ id: schema.matches.id });
    matchId = match!.id;

    const [game] = await db
      .insert(schema.games)
      .values({
        osuId: GAME_OSU_ID,
        ruleset: Ruleset.ManiaOther,
        scoringType: 3,
        teamType: 0,
        mods: 0,
        matchId,
      })
      .returning({ id: schema.games.id });
    gameId = game!.id;

    const [player] = await db
      .insert(schema.players)
      .values({ osuId: PLAYER_OSU_ID })
      .returning({ id: schema.players.id });

    const [score] = await db
      .insert(schema.gameScores)
      .values({
        gameId,
        playerId: player!.id,
        rawScore: 500_000,
        placement: 0,
        accuracy: 0.95,
        maxCombo: 300,
        pass: true,
        isPerfectCombo: false,
        legacyPerfect: false,
        grade: 3,
        mods: Mods.None,
        legacyTotalScore: 0,
        team: Team.NoTeam,
        ruleset: Ruleset.ManiaOther,
        verificationStatus: VerificationStatus.None,
        rejectionReason: 0,
      })
      .returning({ id: schema.gameScores.id });
    scoreId = score!.id;
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [ADMIN_OSU_ID]);
    await pool.end();
  });

  /** Saves the score the way its edit dialog does: every field, some changed. */
  const saveScore = (changes: Partial<typeof schema.gameScores.$inferInsert>) =>
    db.transaction((tx) =>
      withAuditUserId(tx, adminUserId, async () => {
        const current = await tx
          .select()
          .from(schema.gameScores)
          .where(eq(schema.gameScores.id, scoreId));
        const {
          id: _id,
          score: _score,
          editedFields: _editedFields,
          ...fields
        } = current[0]!;
        await tx
          .update(schema.gameScores)
          .set({ ...fields, ...changes })
          .where(eq(schema.gameScores.id, scoreId));
      })
    );

  it('locks only the fields an admin save changes, with mods and lazer mods together', async () => {
    await saveScore({ mods: Mods.Hidden, team: Team.Red });

    expect((await scoreRow()).editedFields).toEqual([
      'lazer_mods',
      'mods',
      'team',
    ]);
  });

  it('resets the named fields and queues a refetch of the match', async () => {
    await saveScore({ mods: Mods.Hidden, team: Team.Red });

    await resetEditedFieldsHandler({
      table: 'game_scores',
      input: { id: scoreId, fields: ['mods'] },
      context: { db, session: adminSession(adminUserId) },
    });

    expect((await scoreRow()).editedFields).toEqual(['team']);
    expect(
      (await queuedFetches(db, adminUserId)).map((job) => job.payload)
    ).toEqual([{ type: 'match', osuMatchId: MATCH_OSU_ID, isLazer: false }]);
    const [match] = await db
      .select({ dataFetchStatus: schema.matches.dataFetchStatus })
      .from(schema.matches)
      .where(eq(schema.matches.id, matchId));
    expect(match?.dataFetchStatus).toBe(DataFetchStatus.NotFetched);
  });

  it('refuses a field the table does not lock, and a non-admin', async () => {
    await expect(
      resetEditedFieldsHandler({
        table: 'game_scores',
        input: { id: scoreId, fields: ['verification_status'] },
        context: { db, session: adminSession(adminUserId) },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await expect(
      resetEditedFieldsHandler({
        table: 'games',
        input: { id: gameId, fields: ['mods'] },
        context: {
          db,
          session: { dbUser: { id: adminUserId, scopes: [] } },
        },
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await queuedFetches(db, adminUserId)).toEqual([]);
  });

  it("writes a tournament's new mania variant to its games and scores without locking them", async () => {
    await updateTournamentAdminHandler({
      input: {
        id: tournamentId,
        name: `${NAME_PREFIX}tournament`,
        abbreviation: 'AE',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/999617',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Mania4k,
        lobbySize: 1,
        verificationStatus: VerificationStatus.None,
        rejectionReason: 0,
        startTime: null,
        endTime: null,
        children: 'none',
      },
      context: { db, session: adminSession(adminUserId) },
    });

    const [game] = await db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, gameId));
    expect(game).toMatchObject({ ruleset: Ruleset.Mania4k, editedFields: [] });
    expect(await scoreRow()).toMatchObject({
      ruleset: Ruleset.Mania4k,
      editedFields: [],
    });
  });
});
