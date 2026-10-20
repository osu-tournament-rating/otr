import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq, inArray, like } from 'drizzle-orm';

import { withAuditUserId } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { AuditEntityType, Ruleset, VerificationStatus } from '@otr/core/osu';

import type { DatabaseClient } from '@/lib/db';

import { getAuditEventFeed } from '../../auditProcedures';
import { manageTournamentMatchesAdminHandler } from '../../tournaments/matchAdminProcedures';
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

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

const NAME = 'audit-event-feed-';
const ADMIN_OSU_ID = 991_203_000;
const OSU_ID_BASE = 991_203_100;
const BEATMAP_OSU_ID = 991_203_900;

describe.skipIf(!testDatabaseUrl)('audit event feed', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let adminUserId = 0;
  let seeded: SeededTournament;
  let beatmapId = 0;

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME}%`));
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, [BEATMAP_OSU_ID]));
  };

  beforeEach(async () => {
    await removeSeed();
    // A fresh admin each test, so the feed shows only this test's events.
    adminUserId = await seedAdminUser(db, ADMIN_OSU_ID);
    seeded = await seedTournamentTree(db, {
      name: `${NAME}tournament`,
      osuIdBase: OSU_ID_BASE,
      matches: 2,
      playerId: await playerIdOfUser(db, adminUserId),
    });

    const [beatmap] = await db
      .insert(schema.beatmaps)
      .values({
        osuId: BEATMAP_OSU_ID,
        ruleset: Ruleset.Osu,
        rankedStatus: 1,
        diffName: `${NAME}beatmap`,
        totalLength: 60,
        drainLength: 60,
        bpm: 180,
        countCircle: 1,
        countSlider: 0,
        countSpinner: 0,
        cs: 4,
        hp: 5,
        od: 8,
        ar: 9,
        sr: 5,
        dataFetchStatus: DataFetchStatus.Fetched,
      })
      .returning({ id: schema.beatmaps.id });
    beatmapId = beatmap!.id;
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [ADMIN_OSU_ID]);
    await pool.end();
  });

  /** Runs `change` as one admin event. */
  const asAdmin = (change: (tx: Transaction) => Promise<unknown>) =>
    db.transaction((tx) => withAuditUserId(tx, adminUserId, () => change(tx)));

  /** The admin's events with no entity type picked, newest first. */
  const feed = () =>
    call(
      getAuditEventFeed,
      { adminUserId, limit: 10 },
      { context: { db, headers: new Headers() } }
    );

  it('shows game, score and beatmap changes with no entity type picked', async () => {
    await asAdmin((tx) =>
      tx
        .update(schema.gameScores)
        .set({ verificationStatus: VerificationStatus.Rejected })
        .where(eq(schema.gameScores.id, seeded.scoreIds[0]!))
    );
    await asAdmin((tx) =>
      tx
        .update(schema.games)
        .set({ mods: 8 })
        .where(eq(schema.games.id, seeded.gameIds[0]!))
    );
    await asAdmin((tx) =>
      tx
        .update(schema.beatmaps)
        .set({ diffName: `${NAME}beatmap edited` })
        .where(eq(schema.beatmaps.id, beatmapId))
    );

    const { events } = await feed();

    expect(
      events.map(({ action, topEntity }) => [
        action,
        topEntity.entityType,
        topEntity.entityId,
      ])
    ).toEqual([
      ['update', AuditEntityType.Beatmap, beatmapId],
      ['update', AuditEntityType.Game, seeded.gameIds[0]],
      ['rejection', AuditEntityType.Score, seeded.scoreIds[0]],
    ]);
  });

  it('headlines a match removal that moves the tournament dates as a deletion', async () => {
    const [firstMatchId] = seeded.matchIds;

    await manageTournamentMatchesAdminHandler({
      input: {
        tournamentId: seeded.tournamentId,
        addMatchOsuIds: [],
        removeMatchIds: [firstMatchId!],
      },
      context: { db, session: adminSession(adminUserId) },
    });

    const [tournament] = await db
      .select({ startTime: schema.tournaments.startTime })
      .from(schema.tournaments)
      .where(eq(schema.tournaments.id, seeded.tournamentId));
    // The removal moved the start to the second match's day.
    expect(new Date(tournament!.startTime!).toISOString()).toBe(
      '2026-01-02T00:00:00.000Z'
    );

    const { events } = await feed();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'deletion',
      topEntity: { entityType: AuditEntityType.Match, entityId: firstMatchId },
      parentTournament: { id: seeded.tournamentId },
    });
  });
});
