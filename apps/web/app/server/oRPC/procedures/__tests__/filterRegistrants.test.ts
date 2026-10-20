import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import { filterRegistrants } from '../filteringProcedures';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';

import {
  adminSession,
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
  transactionFaults,
} from './test-utils';

const USER_OSU_ID = 991_201_900;
const KNOWN_PLAYER_OSU_ID = 991_201_901;
const NEW_PLAYER_OSU_IDS = [991_201_902, 991_201_903];
const REGISTRANTS = [KNOWN_PLAYER_OSU_ID, ...NEW_PLAYER_OSU_IDS];

describe.skipIf(!testDatabaseUrl)('filterRegistrants', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const maintenanceWindowEnabled = process.env.MAINTENANCE_WINDOW_ENABLED;
  let userId = 0;

  const removeSeed = async () => {
    if (userId) {
      await deleteJobs(db, userId);
      await db
        .delete(schema.filterReports)
        .where(eq(schema.filterReports.userId, userId));
    }
    await removePlayers(db, REGISTRANTS);
  };

  beforeAll(() => {
    // The window's clock would fail these on Tuesday mornings.
    process.env.MAINTENANCE_WINDOW_ENABLED = 'false';
  });

  beforeEach(async () => {
    await removeSeed();
    userId ||= await seedAdminUser(db, USER_OSU_ID);
    await db.insert(schema.players).values({ osuId: KNOWN_PLAYER_OSU_ID });
  });

  afterAll(async () => {
    if (maintenanceWindowEnabled === undefined) {
      Reflect.deleteProperty(process.env, 'MAINTENANCE_WINDOW_ENABLED');
    } else {
      process.env.MAINTENANCE_WINDOW_ENABLED = maintenanceWindowEnabled;
    }
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  // The handler alone; middleware has its own tests.
  const filter = (client: DatabaseClient = db) =>
    filterRegistrants['~orpc'].handler({
      context: {
        db: client,
        headers: new Headers(),
        // Two of the three registrants are unknown, which holds a
        // non-admin's request for approval; an admin's runs at once.
        session: adminSession(userId),
      },
      input: { ruleset: Ruleset.Osu, osuPlayerIds: REGISTRANTS },
    } as never);

  const savedPlayerOsuIds = async () =>
    (
      await db
        .select({ osuId: schema.players.osuId })
        .from(schema.players)
        .where(inArray(schema.players.osuId, REGISTRANTS))
    )
      .map((row) => row.osuId)
      .sort();

  it('queues a fetch for each registrant o!TR has never seen', async () => {
    await filter();

    expect(await savedPlayerOsuIds()).toEqual(REGISTRANTS);
    expect(await queuedFetches(db, userId)).toEqual(
      NEW_PLAYER_OSU_IDS.map((osuPlayerId) =>
        expect.objectContaining({
          payload: { type: 'player', osuPlayerId },
          tournamentId: null,
        })
      )
    );
  });

  it.each(transactionFaults)(
    'adds no placeholder player when %s',
    async (_label, fault, message) => {
      await expect(filter(fault(db))).rejects.toThrow(message);

      expect(await savedPlayerOsuIds()).toEqual([KNOWN_PLAYER_OSU_ID]);
      expect(await queuedFetches(db, userId)).toEqual([]);
    }
  );
});
