import { afterAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';

import {
  createTestDb,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
} from './test-utils';

const CREATOR_OSU_ID = 991_204_100;
const REGISTRANT_OSU_ID = 991_204_101;

describe.skipIf(!testDatabaseUrl)('filter reports', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let reportId = 0;

  afterAll(async () => {
    if (reportId) {
      await db
        .delete(schema.filterReports)
        .where(eq(schema.filterReports.id, reportId));
    }
    await removePlayers(db, [CREATOR_OSU_ID, REGISTRANT_OSU_ID]);
    await pool.end();
  });

  // Deleting an account deletes its `users` row (lib/auth/auth.ts). Hosts
  // post the report ID as their screening record, so the report stays.
  it('keep their results when the creator deletes their account', async () => {
    const creatorId = await seedAdminUser(db, CREATOR_OSU_ID);
    await removePlayers(db, [REGISTRANT_OSU_ID]);
    const [registrant] = await db
      .insert(schema.players)
      .values({ osuId: REGISTRANT_OSU_ID })
      .returning({ id: schema.players.id });
    const [report] = await db
      .insert(schema.filterReports)
      .values({
        userId: creatorId,
        ruleset: Ruleset.Osu,
        maxRating: 2000,
        playersPassed: 1,
        playersFailed: 0,
      })
      .returning({ id: schema.filterReports.id });
    reportId = report!.id;
    await db.insert(schema.filterReportPlayers).values({
      filterReportId: reportId,
      playerId: registrant!.id,
      isSuccess: true,
      failureReason: 0,
    });

    await db.delete(schema.users).where(eq(schema.users.id, creatorId));

    expect(
      await db
        .select({ userId: schema.filterReports.userId })
        .from(schema.filterReports)
        .where(eq(schema.filterReports.id, reportId))
    ).toEqual([{ userId: null }]);
    expect(
      await db
        .select({ playerId: schema.filterReportPlayers.playerId })
        .from(schema.filterReportPlayers)
        .where(eq(schema.filterReportPlayers.filterReportId, reportId))
    ).toEqual([{ playerId: registrant!.id }]);
  });
});
