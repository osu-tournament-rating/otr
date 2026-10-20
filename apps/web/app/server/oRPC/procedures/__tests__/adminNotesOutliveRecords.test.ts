import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq, inArray, like } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { AuditEntityType } from '@otr/core/osu';

import { getEntityAuditTimeline } from '../auditProcedures';
import { mergeMatchAdminHandler } from '../matches/matchAdminHandlers';
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

const NAME = 'admin-notes-outlive-';
const ADMIN_OSU_ID = 991_205_000;
const OSU_ID_BASE = 991_205_100;

describe.skipIf(!testDatabaseUrl)('admin notes on deleted records', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let adminUserId = 0;
  let seeded: SeededTournament;

  const removeSeed = () =>
    db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME}%`));

  beforeEach(async () => {
    await removeSeed();
    adminUserId ||= await seedAdminUser(db, ADMIN_OSU_ID);
    seeded = await seedTournamentTree(db, {
      name: `${NAME}tournament`,
      osuIdBase: OSU_ID_BASE,
      matches: 2,
      playerId: await playerIdOfUser(db, adminUserId),
    });
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [ADMIN_OSU_ID]);
    await pool.end();
  });

  const note = (text: string) => ({
    note: `${NAME}${text}`,
    adminUserId,
  });

  it('keeps every note when the tournament is deleted with its matches, games and scores', async () => {
    const [matchId] = seeded.matchIds;
    const [gameId] = seeded.gameIds;
    const [scoreId] = seeded.scoreIds;
    await db.insert(schema.tournamentAdminNotes).values({
      ...note('tournament'),
      referenceId: seeded.tournamentId,
    });
    await db
      .insert(schema.matchAdminNotes)
      .values({ ...note('match'), referenceId: matchId! });
    await db
      .insert(schema.gameAdminNotes)
      .values({ ...note('game'), referenceId: gameId! });
    await db
      .insert(schema.gameScoreAdminNotes)
      .values({ ...note('score'), referenceId: scoreId! });

    await db
      .delete(schema.tournaments)
      .where(eq(schema.tournaments.id, seeded.tournamentId));

    const kept = await Promise.all([
      db
        .select({ referenceId: schema.tournamentAdminNotes.referenceId })
        .from(schema.tournamentAdminNotes)
        .where(
          eq(schema.tournamentAdminNotes.referenceId, seeded.tournamentId)
        ),
      db
        .select({ referenceId: schema.matchAdminNotes.referenceId })
        .from(schema.matchAdminNotes)
        .where(inArray(schema.matchAdminNotes.referenceId, [matchId!])),
      db
        .select({ referenceId: schema.gameAdminNotes.referenceId })
        .from(schema.gameAdminNotes)
        .where(inArray(schema.gameAdminNotes.referenceId, [gameId!])),
      db
        .select({ referenceId: schema.gameScoreAdminNotes.referenceId })
        .from(schema.gameScoreAdminNotes)
        .where(inArray(schema.gameScoreAdminNotes.referenceId, [scoreId!])),
    ]);

    expect(kept).toEqual([
      [{ referenceId: seeded.tournamentId }],
      [{ referenceId: matchId }],
      [{ referenceId: gameId }],
      [{ referenceId: scoreId }],
    ]);
  });

  it("shows a merged match's notes on its audit page", async () => {
    const [parentId, childId] = seeded.matchIds as [number, number];
    await db
      .insert(schema.matchAdminNotes)
      .values({ ...note('why this match was merged'), referenceId: childId });

    await mergeMatchAdminHandler({
      input: { id: parentId, childMatchIds: [childId] },
      context: { db, session: adminSession(adminUserId) },
    });

    const timeline = await call(
      getEntityAuditTimeline,
      { entityType: AuditEntityType.Match, entityId: childId },
      { context: { db, headers: new Headers() } }
    );

    expect(
      timeline.items.flatMap((item) =>
        item.type === 'note' ? [item.data.note] : []
      )
    ).toEqual([`${NAME}why this match was merged`]);
  });
});
