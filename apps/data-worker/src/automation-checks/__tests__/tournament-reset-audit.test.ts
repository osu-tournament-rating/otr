import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  createJobsTestDb,
  silentLogger,
  testDatabaseUrl,
} from '../../jobs/__tests__/test-db';
import {
  GameAutomationChecks,
  MatchAutomationChecks,
  ScoreAutomationChecks,
  TournamentAutomationCheckService,
  TournamentAutomationChecks,
} from '../index';

// Far above real osu! ids and other test files' ranges.
const OSU_ID = 97_000_300_000;
const ABBREVIATION = 'RESETAUD';

describe.skipIf(!testDatabaseUrl)(
  'audit rows of a reset that overturns verified data',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);
    const service = new TournamentAutomationCheckService({
      db,
      logger: silentLogger,
      tournamentChecks: new TournamentAutomationChecks(),
      matchChecks: new MatchAutomationChecks(),
      gameChecks: new GameAutomationChecks(),
      scoreChecks: new ScoreAutomationChecks(),
    });

    let adminUserId = 0;
    let tournamentId = 0;
    let matchId = 0;
    let gameId = 0;
    let scoreId = 0;

    const cleanUp = async () => {
      await db
        .delete(schema.tournaments)
        .where(eq(schema.tournaments.abbreviation, ABBREVIATION));
      const players = db
        .select({ id: schema.players.id })
        .from(schema.players)
        .where(eq(schema.players.osuId, OSU_ID));
      await db
        .delete(schema.users)
        .where(inArray(schema.users.playerId, players));
      await db.delete(schema.players).where(eq(schema.players.osuId, OSU_ID));
    };

    beforeEach(async () => {
      await cleanUp();

      const [player] = await db
        .insert(schema.players)
        .values({ osuId: OSU_ID })
        .returning({ id: schema.players.id });
      const [user] = await db
        .insert(schema.users)
        .values({ playerId: player!.id, scopes: ['admin'] })
        .returning({ id: schema.users.id });
      adminUserId = user!.id;

      const { Verified } = VerificationStatus;
      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: 'reset audit test',
          abbreviation: ABBREVIATION,
          forumUrl: `https://osu.ppy.sh/community/forums/topics/${OSU_ID}`,
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 1,
          verificationStatus: Verified,
          verifiedByUserId: adminUserId,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;

      const [match] = await db
        .insert(schema.matches)
        .values({
          osuId: OSU_ID,
          name: `${ABBREVIATION}: (red) vs (blue)`,
          tournamentId,
          verificationStatus: Verified,
          verifiedByUserId: adminUserId,
        })
        .returning({ id: schema.matches.id });
      matchId = match!.id;

      const [game] = await db
        .insert(schema.games)
        .values({
          osuId: OSU_ID,
          ruleset: Ruleset.Osu,
          scoringType: 3,
          teamType: 0,
          mods: 0,
          matchId,
          verificationStatus: Verified,
        })
        .returning({ id: schema.games.id });
      gameId = game!.id;

      const [score] = await db
        .insert(schema.gameScores)
        .values({
          rawScore: 100_000,
          placement: 1,
          accuracy: 0.95,
          maxCombo: 100,
          pass: true,
          isPerfectCombo: false,
          legacyPerfect: false,
          grade: 1,
          mods: 0,
          legacyTotalScore: 0,
          team: 0,
          ruleset: Ruleset.Osu,
          verificationStatus: Verified,
          rejectionReason: 0,
          gameId,
          playerId: player!.id,
        })
        .returning({ id: schema.gameScores.id });
      scoreId = score!.id;
    });

    afterAll(async () => {
      await cleanUp();
      await pool.end();
    });

    /** The action user on each audit row the reset wrote, per table. */
    const resetAuditUsers = async () => {
      const { rows } = await db.execute<{
        entity: string;
        action_user_id: number | null;
      }>(sql`
        SELECT 'tournament' AS entity, action_user_id FROM tournament_audits
          WHERE reference_id_lock = ${tournamentId} AND action_type = 1
        UNION ALL
        SELECT 'match', action_user_id FROM match_audits
          WHERE reference_id_lock = ${matchId} AND action_type = 1
        UNION ALL
        SELECT 'game', action_user_id FROM game_audits
          WHERE reference_id_lock = ${gameId} AND action_type = 1
        UNION ALL
        SELECT 'score', action_user_id FROM game_score_audits
          WHERE reference_id_lock = ${scoreId} AND action_type = 1
        ORDER BY 1`);
      return rows.map((row) => [row.entity, row.action_user_id]);
    };

    it('names the admin who asked for the reset', async () => {
      await service.processAutomationChecks(tournamentId, true, adminUserId);

      expect(await resetAuditUsers()).toEqual([
        ['game', adminUserId],
        ['match', adminUserId],
        ['score', adminUserId],
        ['tournament', adminUserId],
      ]);
    });
  }
);
