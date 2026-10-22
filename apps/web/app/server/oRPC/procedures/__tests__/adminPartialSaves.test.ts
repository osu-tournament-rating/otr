import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

import { updateGameAdminHandler } from '../games/adminProcedures';
import { updateMatchAdminHandler } from '../matches/matchAdminHandlers';
import { updateScoreAdminHandler } from '../scores/adminProcedures';
import { updateTournamentAdminHandler } from '../tournaments/adminProcedures';
import {
  adminSession,
  createTestDb,
  playerIdOfUser,
  removePlayers,
  seedAdminUser,
  seedTournamentTree,
  testDatabaseUrl,
  type SeededTournament,
} from './test-utils';

const NAME = 'admin-partial-saves-';
const EARLIER_ADMIN_OSU_ID = 991_206_000;
const ADMIN_OSU_ID = 991_206_001;
const OSU_ID_BASE = 991_206_100;
const LAZER_MODS: LazerMod[] = [{ acronym: 'HD' }];

/**
 * Every save names only the fields the admin edited. Whatever else changed
 * since the dialog loaded, such as dates the data worker set or a status
 * another admin chose, must survive it.
 */
describe.skipIf(!testDatabaseUrl)('admin saves of edited fields only', () => {
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
      matches: 2,
      playerId: await playerIdOfUser(db, earlierAdminId),
    });
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [EARLIER_ADMIN_OSU_ID, ADMIN_OSU_ID]);
    await pool.end();
  });

  const context = () => ({ db, session: adminSession(adminId) });

  it('keeps a tournament’s dates, status and reviewer when only its abbreviation is saved', async () => {
    await db
      .update(schema.tournaments)
      .set({
        verificationStatus: VerificationStatus.Verified,
        verifiedByUserId: earlierAdminId,
        rejectionReason: 0,
      })
      .where(eq(schema.tournaments.id, seeded.tournamentId));
    const selectTournament = () =>
      db.query.tournaments.findFirst({
        columns: {
          abbreviation: true,
          startTime: true,
          endTime: true,
          verificationStatus: true,
          verifiedByUserId: true,
        },
        where: eq(schema.tournaments.id, seeded.tournamentId),
      });
    const before = await selectTournament();

    await updateTournamentAdminHandler({
      input: { id: seeded.tournamentId, abbreviation: 'EDITED' },
      context: context(),
    });

    expect(await selectTournament()).toEqual({
      ...before!,
      abbreviation: 'EDITED',
    });
  });

  it('keeps a match’s dates, status and reviewer when only its name is saved', async () => {
    const [matchId] = seeded.matchIds;
    await db
      .update(schema.matches)
      .set({
        verificationStatus: VerificationStatus.Rejected,
        verifiedByUserId: earlierAdminId,
        rejectionReason: 1,
      })
      .where(eq(schema.matches.id, matchId!));
    const selectMatch = () =>
      db.query.matches.findFirst({
        columns: {
          name: true,
          startTime: true,
          endTime: true,
          verificationStatus: true,
          rejectionReason: true,
          verifiedByUserId: true,
        },
        where: eq(schema.matches.id, matchId!),
      });
    const before = await selectMatch();

    await updateMatchAdminHandler({
      input: { id: matchId!, name: `${NAME}edited match` },
      context: context(),
    });

    expect(await selectMatch()).toEqual({
      ...before!,
      name: `${NAME}edited match`,
    });
  });

  it('keeps a game’s status and lazer mods when only its ruleset is saved', async () => {
    const [gameId] = seeded.gameIds;
    await db
      .update(schema.games)
      .set({
        verificationStatus: VerificationStatus.PreRejected,
        rejectionReason: 2,
        lazerMods: LAZER_MODS,
      })
      .where(eq(schema.games.id, gameId!));
    const selectGame = () =>
      db.query.games.findFirst({
        columns: {
          ruleset: true,
          startTime: true,
          verificationStatus: true,
          rejectionReason: true,
          lazerMods: true,
        },
        where: eq(schema.games.id, gameId!),
      });
    const before = await selectGame();

    await updateGameAdminHandler({
      input: { id: gameId!, ruleset: Ruleset.Taiko },
      context: context(),
    });

    expect(await selectGame()).toEqual({ ...before!, ruleset: Ruleset.Taiko });
  });

  it('keeps a score’s status and lazer mods when only its placement is saved', async () => {
    const [scoreId] = seeded.scoreIds;
    await db
      .update(schema.gameScores)
      .set({
        verificationStatus: VerificationStatus.Verified,
        lazerMods: LAZER_MODS,
      })
      .where(eq(schema.gameScores.id, scoreId!));
    const selectScore = () =>
      db.query.gameScores.findFirst({
        columns: {
          placement: true,
          verificationStatus: true,
          lazerMods: true,
        },
        where: eq(schema.gameScores.id, scoreId!),
      });
    const before = await selectScore();

    await updateScoreAdminHandler({
      input: { id: scoreId!, placement: 2 },
      context: context(),
    });

    expect(await selectScore()).toEqual({ ...before!, placement: 2 });
  });
});
