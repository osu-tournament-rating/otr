import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';

import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { MessagePriority } from '@otr/core';
import { ApprovalStatus, FilteringFailReason, Ruleset } from '@otr/core/osu';

import { filterRegistrantsHandler } from '../filteringProcedures';
import {
  approveFilterRequestHandler,
  denyFilterRequestHandler,
  listMyFilterRequestsHandler,
} from '../filtering/requestProcedures';
import {
  adminSession,
  createTestDb,
  deleteJobs,
  queuedFetches,
  queuedLookups,
  removePlayers,
  seedAdminUser,
  seedUser,
  testDatabaseUrl,
  transactionFaults,
  userSession,
} from './test-utils';

const REQUESTER_OSU_ID = 991_203_100;
const ADMIN_OSU_ID = 991_203_101;
const KNOWN_OSU_IDS = Array.from({ length: 7 }, (_, i) => 991_203_110 + i);
const UNKNOWN_OSU_IDS = Array.from({ length: 4 }, (_, i) => 991_203_130 + i);
/** One more than a user's request may check. */
const OVER_USER_LIMIT = Array.from({ length: 1001 }, (_, i) => 991_204_000 + i);
const ALL_OSU_IDS = [...KNOWN_OSU_IDS, ...UNKNOWN_OSU_IDS, ...OVER_USER_LIMIT];

/** 6 known and 4 unknown: 40%, over the 30% that holds a request. */
const FLAGGED = [...KNOWN_OSU_IDS.slice(0, 6), ...UNKNOWN_OSU_IDS];
/** 7 known and 3 unknown: exactly 30%, which runs. */
const AT_THRESHOLD = [...KNOWN_OSU_IDS, ...UNKNOWN_OSU_IDS.slice(0, 3)];

describe.skipIf(!testDatabaseUrl)('registrant filter limits', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const maintenanceWindowEnabled = process.env.MAINTENANCE_WINDOW_ENABLED;
  let requesterId = 0;
  let adminId = 0;

  const removeSeed = async () => {
    for (const userId of [requesterId, adminId]) {
      if (!userId) continue;
      await deleteJobs(db, userId);
      await db
        .delete(schema.filterRequests)
        .where(eq(schema.filterRequests.userId, userId));
      await db
        .delete(schema.filterReports)
        .where(eq(schema.filterReports.userId, userId));
      await db
        .update(schema.users)
        .set({ osuSignInNeededAt: null })
        .where(eq(schema.users.id, userId));
    }
    await removePlayers(db, ALL_OSU_IDS);
  };

  const filter = (
    osuPlayerIds: number[],
    {
      session = userSession(requesterId),
      justification,
      client = db,
      extra = {},
    }: {
      session?: ReturnType<typeof userSession>;
      justification?: string;
      client?: DatabaseClient;
      extra?: Record<string, unknown>;
    } = {}
  ) =>
    filterRegistrantsHandler({
      input: {
        ruleset: Ruleset.Osu,
        minRating: null,
        maxRating: 5000,
        osuPlayerIds,
        justification,
        ...extra,
      },
      context: { db: client, headers: new Headers(), session },
    });

  const seedReport = (userId: number, hoursAgo: number) =>
    db
      .insert(schema.filterReports)
      .values({
        userId,
        ruleset: Ruleset.Osu,
        playersPassed: 0,
        playersFailed: 0,
        created: sql`CURRENT_TIMESTAMP - make_interval(hours => ${hoursAgo})`,
      })
      .returning({
        id: schema.filterReports.id,
        created: schema.filterReports.created,
      })
      .then((rows) => rows[0]!);

  const savedOsuIds = async (osuIds: number[]) =>
    (
      await db
        .select({ osuId: schema.players.osuId })
        .from(schema.players)
        .where(inArray(schema.players.osuId, osuIds))
    )
      .map((row) => row.osuId)
      .sort();

  /** Each player's fetch status, by osu! id. */
  const fetchStatuses = async (osuIds: number[]) =>
    Object.fromEntries(
      (
        await db
          .select({
            osuId: schema.players.osuId,
            status: schema.players.dataFetchStatus,
          })
          .from(schema.players)
          .where(inArray(schema.players.osuId, osuIds))
      ).map((row) => [row.osuId, row.status])
    );

  const lookupPayloads = (osuIds: number[]) =>
    osuIds.map((osuPlayerId) => ({ osuPlayerId }));

  const heldRequests = (userId: number) =>
    db
      .select()
      .from(schema.filterRequests)
      .where(eq(schema.filterRequests.userId, userId));

  beforeAll(async () => {
    // The window's clock would fail these on Tuesday mornings.
    process.env.MAINTENANCE_WINDOW_ENABLED = 'false';
    requesterId = await seedUser(db, REQUESTER_OSU_ID);
    adminId = await seedAdminUser(db, ADMIN_OSU_ID);
  });

  beforeEach(async () => {
    await removeSeed();
    await db
      .insert(schema.players)
      .values(KNOWN_OSU_IDS.map((osuId) => ({ osuId })));
  });

  afterAll(async () => {
    if (maintenanceWindowEnabled === undefined) {
      Reflect.deleteProperty(process.env, 'MAINTENANCE_WINDOW_ENABLED');
    } else {
      process.env.MAINTENANCE_WINDOW_ENABLED = maintenanceWindowEnabled;
    }
    await removeSeed();
    await removePlayers(db, [REQUESTER_OSU_ID, ADMIN_OSU_ID]);
    await pool.end();
  });

  describe('more than 30% unknown players', () => {
    it('asks for a justification and saves nothing without one', async () => {
      await expect(filter(FLAGGED)).rejects.toMatchObject({
        status: 422,
        data: {
          code: 'JUSTIFICATION_REQUIRED',
          unknownPlayerCount: 4,
          playerCount: 10,
        },
      });

      expect(await heldRequests(requesterId)).toEqual([]);
    });

    it('holds the request with its justification and looks nobody up', async () => {
      const result = await filter(FLAGGED, {
        justification: 'Most registrants are new to tournaments',
      });

      expect(result).toMatchObject({
        status: 'pending',
        request: {
          status: ApprovalStatus.Pending,
          playerCount: 10,
          unknownPlayerCount: 4,
          justification: 'Most registrants are new to tournaments',
          filterReportId: null,
        },
      });
      expect(await savedOsuIds(UNKNOWN_OSU_IDS)).toEqual([]);
      expect(await queuedFetches(db, requesterId)).toEqual([]);
      expect(await queuedLookups(db, requesterId)).toEqual([]);
      expect(
        await db
          .select({ id: schema.filterReports.id })
          .from(schema.filterReports)
          .where(eq(schema.filterReports.userId, requesterId))
      ).toEqual([]);
    });

    it("runs an admin's request at once, looking players up with o!TR's own osu! client", async () => {
      await expect(
        filter(FLAGGED, { session: adminSession(adminId) })
      ).resolves.toMatchObject({ status: 'completed' });

      expect(await savedOsuIds(UNKNOWN_OSU_IDS)).toEqual(UNKNOWN_OSU_IDS);
      expect(
        (await queuedFetches(db, adminId)).map((job) => job.payload)
      ).toEqual(
        UNKNOWN_OSU_IDS.map((osuPlayerId) => ({ type: 'player', osuPlayerId }))
      );
      expect(await queuedLookups(db, adminId)).toEqual([]);
    });
  });

  it("runs a request with exactly 30% unknown, looking each one up with the requester's osu! account", async () => {
    const result = await filter(AT_THRESHOLD);
    const unknown = UNKNOWN_OSU_IDS.slice(0, 3);

    expect(result.status).toBe('completed');
    expect(
      (await queuedLookups(db, requesterId)).map((job) => job.payload)
    ).toEqual(lookupPayloads(unknown));
    // Not with o!TR's own client
    expect(await queuedFetches(db, requesterId)).toEqual([]);
    // The lookup holds each player's fetch lease, so o!TR's own refresh
    // leaves the player to it
    expect(await fetchStatuses(unknown)).toEqual(
      Object.fromEntries(
        unknown.map((osuId) => [osuId, DataFetchStatus.Fetching])
      )
    );
  });

  it("queues an admin's lookups behind tournament fetches", async () => {
    await filter(AT_THRESHOLD, { session: adminSession(adminId) });

    const fetches = await queuedFetches(db, adminId);
    expect(fetches).toHaveLength(3);
    // Below Normal, where tournament fetches queue; higher runs first
    expect(fetches.map((job) => job.priority)).toEqual([
      MessagePriority.Low,
      MessagePriority.Low,
      MessagePriority.Low,
    ]);
  });

  describe('players a request', () => {
    it('refuses more than 1,000 from a user, and saves nothing', async () => {
      await expect(filter(OVER_USER_LIMIT)).rejects.toMatchObject({
        status: 400,
        data: { code: 'TOO_MANY_PLAYER_IDS', maxPlayerIds: 1000 },
      });

      expect(await savedOsuIds(OVER_USER_LIMIT)).toEqual([]);
      expect(await heldRequests(requesterId)).toEqual([]);
    });

    it('checks more than 1,000 for an admin', async () => {
      const result = await filter(OVER_USER_LIMIT, {
        session: adminSession(adminId),
      });

      expect(result).toMatchObject({ status: 'completed' });
      if (result.status !== 'completed') return;
      expect(result.filteringResults).toHaveLength(1001);
    });
  });

  describe('the daily limit', () => {
    it('refuses a third report in 24 hours, counting a held request, until the oldest is a day old', async () => {
      const oldest = await seedReport(requesterId, 23);
      await filter(FLAGGED, { justification: 'New players' });

      const refusal = await filter(KNOWN_OSU_IDS).catch((error) => error);
      expect(refusal).toMatchObject({
        status: 429,
        data: { code: 'DAILY_LIMIT_REACHED' },
      });
      const nextReportAt = new Date(refusal.data.nextReportAt).getTime();
      expect(nextReportAt).toBe(
        new Date(oldest.created).getTime() + 24 * 60 * 60 * 1000
      );

      await db
        .update(schema.filterReports)
        .set({ created: sql`CURRENT_TIMESTAMP - interval '25 hours'` })
        .where(eq(schema.filterReports.id, oldest.id));

      await expect(filter(KNOWN_OSU_IDS)).resolves.toMatchObject({
        status: 'completed',
      });
    });

    it('counts an approved request once, from when it was made', async () => {
      await filter(FLAGGED, { justification: 'New players' });
      const [held] = await heldRequests(requesterId);
      await approveFilterRequestHandler({
        input: { id: held!.id },
        context: {
          db,
          headers: new Headers(),
          session: adminSession(adminId),
        },
      });

      // The held request and this one: two
      await expect(filter(KNOWN_OSU_IDS)).resolves.toMatchObject({
        status: 'completed',
      });
      await expect(filter(KNOWN_OSU_IDS)).rejects.toMatchObject({
        data: { code: 'DAILY_LIMIT_REACHED' },
      });
    });

    it('does not limit admins', async () => {
      await seedReport(adminId, 1);
      await seedReport(adminId, 2);

      await expect(
        filter(KNOWN_OSU_IDS, { session: adminSession(adminId) })
      ).resolves.toMatchObject({ status: 'completed' });
    });

    it('shows the user what is left, and their held requests', async () => {
      await seedReport(requesterId, 3);
      await filter(FLAGGED, { justification: 'New players' });

      const mine = await listMyFilterRequestsHandler({
        context: { db, session: userSession(requesterId) },
      });

      expect(mine.usage).toMatchObject({
        reportsLeft: 0,
        nextReportAt: expect.any(String),
      });
      expect(mine.requests).toEqual([
        expect.objectContaining({ status: ApprovalStatus.Pending }),
      ]);
    });
  });

  it('no longer fails players on the tournament, match and peak criteria the form dropped', async () => {
    const result = await filter(KNOWN_OSU_IDS, {
      extra: {
        peakRating: 100,
        tournamentsPlayed: 5,
        matchesPlayed: 5,
        maxTournamentsPlayed: 0,
      },
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.playersFailed).toBe(0);
    expect(
      result.filteringResults.map((player) => player.failureReason)
    ).toEqual(KNOWN_OSU_IDS.map(() => FilteringFailReason.None));
  });

  describe('admin review of a held request', () => {
    const holdRequest = async () => {
      await filter(FLAGGED, { justification: 'New players' });
      const [held] = await heldRequests(requesterId);
      return held!.id;
    };

    const adminContext = (client: DatabaseClient = db) => ({
      db: client,
      headers: new Headers(),
      session: adminSession(adminId),
    });

    it("runs it for the requester and looks its players up with the requester's osu! account", async () => {
      const id = await holdRequest();

      const { filterReportId } = await approveFilterRequestHandler({
        input: { id },
        context: adminContext(),
      });

      const [report] = await db
        .select({ userId: schema.filterReports.userId })
        .from(schema.filterReports)
        .where(eq(schema.filterReports.id, filterReportId));
      expect(report).toEqual({ userId: requesterId });
      expect(await savedOsuIds(UNKNOWN_OSU_IDS)).toEqual(UNKNOWN_OSU_IDS);
      expect(
        (await queuedLookups(db, requesterId)).map((job) => job.payload)
      ).toEqual(lookupPayloads(UNKNOWN_OSU_IDS));
      expect(await queuedFetches(db, requesterId)).toEqual([]);
      expect(await queuedFetches(db, adminId)).toEqual([]);
      expect((await heldRequests(requesterId))[0]).toMatchObject({
        status: ApprovalStatus.Approved,
        filterReportId,
        reviewedByUserId: adminId,
      });
    });

    it.each(transactionFaults)(
      'keeps it waiting and looks nobody up when %s',
      async (_label, fault, message) => {
        const id = await holdRequest();

        await expect(
          approveFilterRequestHandler({
            input: { id },
            context: adminContext(fault(db)),
          })
        ).rejects.toThrow(message);

        expect(await savedOsuIds(UNKNOWN_OSU_IDS)).toEqual([]);
        expect(await queuedLookups(db, requesterId)).toEqual([]);
        expect((await heldRequests(requesterId))[0]?.status).toBe(
          ApprovalStatus.Pending
        );
      }
    );

    it('denies it without looking anybody up, and refuses to decide it again', async () => {
      const id = await holdRequest();

      await denyFilterRequestHandler({
        input: { id },
        context: adminContext(),
      });

      expect((await heldRequests(requesterId))[0]).toMatchObject({
        status: ApprovalStatus.Denied,
        reviewedByUserId: adminId,
        filterReportId: null,
      });
      expect(await savedOsuIds(UNKNOWN_OSU_IDS)).toEqual([]);
      await expect(
        approveFilterRequestHandler({ input: { id }, context: adminContext() })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('tells the user how many players wait to be looked up with their osu! account, and when they must sign in again', async () => {
    const usage = async () =>
      (
        await listMyFilterRequestsHandler({
          context: { db, session: userSession(requesterId) },
        })
      ).usage;

    expect(await usage()).toMatchObject({
      pendingLookups: 0,
      osuSignInNeeded: false,
    });

    await filter(AT_THRESHOLD);
    expect(await usage()).toMatchObject({
      pendingLookups: 3,
      osuSignInNeeded: false,
    });

    // As the data worker notes it when osu! refuses the user's token
    await db
      .update(schema.users)
      .set({ osuSignInNeededAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.users.id, requesterId));
    expect(await usage()).toMatchObject({
      pendingLookups: 3,
      osuSignInNeeded: true,
    });
  });
});
