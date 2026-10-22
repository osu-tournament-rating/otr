import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  acceptTournamentPreVerificationStatusesHandler,
  updateTournamentAdminHandler,
} from '../adminProcedures';
import {
  adminSession,
  createTestDb,
  playerIdOfUser,
  removePlayers,
  seedAdminUser,
  seedTournamentTree,
  testDatabaseUrl,
  type SeededTournament,
} from '../../__tests__/test-utils';

const NAME = 'match-reviewer-credit-';
const EARLIER_ADMIN_OSU_ID = 991_204_000;
const ADMIN_OSU_ID = 991_204_001;
const OSU_ID_BASE = 991_204_100;

const { Verified, Rejected, PreVerified, PreRejected } = VerificationStatus;

describe.skipIf(!testDatabaseUrl)(
  'the reviewer a tournament decision credits on its matches',
  () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    let earlierAdminId = 0;
    let adminId = 0;
    let seeded: SeededTournament;

    const removeSeed = () =>
      db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${NAME}%`));

    beforeEach(async () => {
      await removeSeed();
      earlierAdminId ||= await seedAdminUser(db, EARLIER_ADMIN_OSU_ID);
      adminId ||= await seedAdminUser(db, ADMIN_OSU_ID);
      seeded = await seedTournamentTree(db, {
        name: `${NAME}tournament`,
        osuIdBase: OSU_ID_BASE,
        matches: 3,
        playerId: await playerIdOfUser(db, earlierAdminId),
      });
    });

    afterAll(async () => {
      await removeSeed();
      await removePlayers(db, [EARLIER_ADMIN_OSU_ID, ADMIN_OSU_ID]);
      await pool.end();
    });

    /** Gives each match a status and the reviewer the earlier admin's review left. */
    const reviewMatches = async (statuses: VerificationStatus[]) => {
      for (const [index, status] of statuses.entries()) {
        const reviewed = status === Verified || status === Rejected;
        await db
          .update(schema.matches)
          .set({
            verificationStatus: status,
            verifiedByUserId: reviewed ? earlierAdminId : null,
          })
          .where(eq(schema.matches.id, seeded.matchIds[index]!));
      }
    };

    const matchReviews = async () => {
      const rows = await db
        .select({
          id: schema.matches.id,
          status: schema.matches.verificationStatus,
          reviewer: schema.matches.verifiedByUserId,
        })
        .from(schema.matches)
        .where(inArray(schema.matches.id, seeded.matchIds))
        .orderBy(schema.matches.id);
      return rows.map(({ status, reviewer }) => [status, reviewer]);
    };

    const updateTournament = (
      verificationStatus: VerificationStatus,
      children?: 'set'
    ) =>
      updateTournamentAdminHandler({
        input: {
          id: seeded.tournamentId,
          name: `${NAME}tournament`,
          abbreviation: 'SEED',
          forumUrl: `https://osu.ppy.sh/community/forums/topics/${OSU_ID_BASE}`,
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
          verificationStatus,
          rejectionReason: 0,
          startTime: null,
          endTime: null,
          children,
        },
        context: { db, session: adminSession(adminId) },
      });

    it('credits the admin who rejects the tournament on the matches it rejects', async () => {
      await reviewMatches([Verified, Rejected, PreVerified]);

      await updateTournament(Rejected);

      expect(await matchReviews()).toEqual([
        [Rejected, adminId],
        // Already rejected, so the earlier rejection stands.
        [Rejected, earlierAdminId],
        [Rejected, adminId],
      ]);
    });

    it('credits the admin who verifies all children on the matches it verifies', async () => {
      await reviewMatches([Rejected, Verified, PreRejected]);

      await updateTournament(Verified, 'set');

      expect(await matchReviews()).toEqual([
        [Verified, adminId],
        [Verified, earlierAdminId],
        [Verified, adminId],
      ]);
    });

    it('credits the admin whose accepted pre-rejection rejects the matches', async () => {
      await reviewMatches([Verified, Verified, PreVerified]);
      await db
        .update(schema.tournaments)
        .set({ verificationStatus: PreRejected })
        .where(eq(schema.tournaments.id, seeded.tournamentId));

      await acceptTournamentPreVerificationStatusesHandler({
        input: { id: seeded.tournamentId },
        context: { db, session: adminSession(adminId) },
      });

      expect(await matchReviews()).toEqual([
        [Rejected, adminId],
        [Rejected, adminId],
        [Rejected, adminId],
      ]);
    });
  }
);
