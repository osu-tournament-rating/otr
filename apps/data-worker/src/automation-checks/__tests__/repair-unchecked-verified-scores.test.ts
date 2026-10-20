import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { and, eq, gt, inArray, isNull, like, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import type { LazerMod } from '@otr/core/osu/lazer-mods';
import {
  Mods,
  Ruleset,
  ScoreRejectionReason,
  VerificationStatus,
} from '@otr/core/osu';

import type { DatabaseClient } from '../../db';

// Set by the `checks` job in .github/workflows/ci.yml, which has already run
// this migration on an empty database. The test runs it again over its seed.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const REPAIR_MIGRATION = join(
  import.meta.dir,
  '../../../../web/drizzle/0043_repair_unchecked_verified_scores.sql'
);

const NAME = 'repair-unchecked-verified-scores';
const PLAYER_OSU_IDS = Array.from({ length: 9 }, (_, i) => 991_185_001 + i);
const MATCH_OSU_ID_BASE = 991_185_100;
const GAME_OSU_ID_BASE = 991_185_200;

const { None, PreRejected, PreVerified, Rejected, Verified } =
  VerificationStatus;
const { ScoreBelowMinimum, InvalidMods, RulesetMismatch } =
  ScoreRejectionReason;

type ScoreSeed = {
  rawScore?: number;
  mods?: Mods;
  lazerMods?: LazerMod[];
  ruleset?: Ruleset;
  verificationStatus?: VerificationStatus;
};

describe.skipIf(!url)(
  'migration 0043, repair unchecked verified scores',
  () => {
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
    let playerIds: number[] = [];
    let seededTournaments = 0;

    const removeSeed = async () => {
      await db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${NAME}%`));
      await db
        .delete(schema.players)
        .where(inArray(schema.players.osuId, PLAYER_OSU_IDS));
    };

    /** One match with one game, in a tournament of the given statuses. */
    const seedGame = async (
      statuses: {
        tournament: VerificationStatus;
        match: VerificationStatus;
        game: VerificationStatus;
      },
      scores: ScoreSeed[]
    ) => {
      const index = seededTournaments++;
      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: `${NAME} ${index}`,
          abbreviation: 'RUVS',
          forumUrl: `https://osu.ppy.sh/community/forums/topics/991185${index}`,
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
          verificationStatus: statuses.tournament,
        })
        .returning({ id: schema.tournaments.id });
      const [match] = await db
        .insert(schema.matches)
        .values({
          osuId: MATCH_OSU_ID_BASE + index,
          tournamentId: tournament!.id,
          verificationStatus: statuses.match,
        })
        .returning({ id: schema.matches.id });
      const [game] = await db
        .insert(schema.games)
        .values({
          osuId: GAME_OSU_ID_BASE + index,
          ruleset: Ruleset.Osu,
          scoringType: 3,
          teamType: 2,
          mods: 0,
          matchId: match!.id,
          verificationStatus: statuses.game,
        })
        .returning({ id: schema.games.id });

      const rows = await db
        .insert(schema.gameScores)
        .values(
          scores.map((score, position) => ({
            rawScore: score.rawScore ?? 100_000,
            placement: position + 1,
            accuracy: 0.95,
            maxCombo: 100,
            pass: true,
            isPerfectCombo: false,
            legacyPerfect: false,
            grade: 1,
            mods: score.mods ?? Mods.None,
            lazerMods: score.lazerMods ?? null,
            legacyTotalScore: 0,
            team: 1,
            ruleset: score.ruleset ?? Ruleset.Osu,
            verificationStatus: score.verificationStatus ?? None,
            rejectionReason: 0,
            gameId: game!.id,
            playerId: playerIds[position]!,
          }))
        )
        .returning({ id: schema.gameScores.id });

      return rows.map((row) => row.id);
    };

    const statusOf = async (ids: number[]) => {
      const rows = await db
        .select({
          id: schema.gameScores.id,
          verificationStatus: schema.gameScores.verificationStatus,
          rejectionReason: schema.gameScores.rejectionReason,
        })
        .from(schema.gameScores)
        .where(inArray(schema.gameScores.id, ids));
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.map((id) => {
        const row = byId.get(id)!;
        return [row.verificationStatus, row.rejectionReason];
      });
    };

    const runRepair = async () =>
      pool.query(await readFile(REPAIR_MIGRATION, 'utf8'));

    beforeEach(async () => {
      await removeSeed();
      seededTournaments = 0;
      const players = await db
        .insert(schema.players)
        .values(PLAYER_OSU_IDS.map((osuId) => ({ osuId })))
        .returning({ id: schema.players.id });
      playerIds = players.map((player) => player.id);
    });

    afterAll(async () => {
      await removeSeed();
      await pool.end();
    });

    const verifiedGameIn = (tournament: VerificationStatus) => ({
      tournament,
      match: tournament === Verified ? Verified : PreVerified,
      game: Verified,
    });

    it('gives the scores of a verified tournament the status accepting gives', async () => {
      const scores = await seedGame(verifiedGameIn(Verified), [
        {},
        { rawScore: 1000 },
        { rawScore: 1001 },
        { mods: Mods.SuddenDeath },
        { lazerMods: [{ acronym: 'CN' }] },
        { lazerMods: [{ acronym: 'DT' }] },
        { ruleset: Ruleset.Taiko },
        { rawScore: 500, mods: Mods.Relax, ruleset: Ruleset.Taiko },
      ]);

      await runRepair();

      expect(await statusOf(scores)).toEqual([
        [Verified, 0],
        [Rejected, ScoreBelowMinimum],
        [Verified, 0],
        [Rejected, InvalidMods],
        [Rejected, InvalidMods],
        [Verified, 0],
        [Rejected, RulesetMismatch],
        [Rejected, ScoreBelowMinimum | InvalidMods | RulesetMismatch],
      ]);
    });

    it('gives the scores of a tournament under review their pre-status', async () => {
      const scores = await seedGame(verifiedGameIn(PreVerified), [
        {},
        { rawScore: 900 },
      ]);

      await runRepair();

      expect(await statusOf(scores)).toEqual([
        [PreVerified, 0],
        [PreRejected, ScoreBelowMinimum],
      ]);
    });

    it('leaves scores a check or an admin decided, and rejected tournaments', async () => {
      const decided = await seedGame(verifiedGameIn(Verified), [
        { verificationStatus: PreVerified },
        { verificationStatus: Rejected },
      ]);
      const undecidedGame = await seedGame(
        { tournament: Verified, match: Verified, game: PreVerified },
        [{}]
      );
      const rejectedTournament = await seedGame(verifiedGameIn(Rejected), [{}]);

      await runRepair();

      expect(await statusOf(decided)).toEqual([
        [PreVerified, 0],
        [Rejected, 0],
      ]);
      expect(await statusOf(undecidedGame)).toEqual([[None, 0]]);
      expect(await statusOf(rejectedTournament)).toEqual([[None, 0]]);
    });

    it('records each repair as a System change, once', async () => {
      const scores = await seedGame(verifiedGameIn(Verified), [{}, {}]);
      const [{ maxId }] = (
        await db.execute<{ maxId: number | null }>(
          sql`SELECT MAX(id) AS "maxId" FROM game_score_audits`
        )
      ).rows as [{ maxId: number | null }];
      const audits = () =>
        db
          .select({ referenceId: schema.gameScoreAudits.referenceId })
          .from(schema.gameScoreAudits)
          .where(
            and(
              gt(schema.gameScoreAudits.id, maxId ?? 0),
              isNull(schema.gameScoreAudits.actionUserId),
              inArray(schema.gameScoreAudits.referenceId, scores)
            )
          );

      await runRepair();
      await runRepair();

      expect(await statusOf(scores)).toEqual([
        [Verified, 0],
        [Verified, 0],
      ]);
      expect((await audits()).map((row) => row.referenceId).sort()).toEqual(
        [...scores].sort()
      );
    });

    it('lets the next rating run refresh the tournament stats', async () => {
      const [score] = await seedGame(verifiedGameIn(Verified), [{}]);

      await runRepair();

      const [row] = await db
        .select({ updated: schema.gameScores.updated })
        .from(schema.gameScores)
        .where(eq(schema.gameScores.id, score!));
      expect(row!.updated).not.toBeNull();
    });
  }
);
