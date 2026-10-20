import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { APIError } from 'osu-api-v2-js';
import type { Counter } from 'prom-client';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJobs, JobQueue, JobStatus } from '@otr/core/jobs';

import {
  createJobsTestDb,
  jobRows,
  resetJobTables,
  silentLogger,
  testDatabaseUrl,
} from '../../../jobs/__tests__/test-db';
import { osuApiRequests, osuLookupRequests } from '../../../metrics';
import { apiRequestStats } from '../../../metrics/api-request-stats';

// The client module reads the worker's environment at import time, which CI
// doesn't set. The fetch helpers only need its error class.
mock.module('../../client', () => ({ APIError }));

const { JobRunner } = await import('../../../jobs/runner');
const { UserOsuTokens } = await import('../../user-tokens');
const { OsuLookupWorker, SIGN_IN_WAIT_MS } =
  await import('../osu-lookup-worker');

// Far above real osu! ids and other test files' ranges.
const BASE = 97_000_000_000;
const REQUESTER_OSU_ID = BASE;
const OTHER_REQUESTER_OSU_ID = BASE + 1;
const LOOKED_UP = Array.from({ length: 19 }, (_, i) => BASE + 100 + i);
const ALREADY_FETCHED = BASE + 200;
const ALL_PLAYERS = [
  REQUESTER_OSU_ID,
  OTHER_REQUESTER_OSU_ID,
  ...LOOKED_UP,
  ALREADY_FETCHED,
];

const CLIENT = { clientId: '41', clientSecret: 'site-secret' };
const HOUR_MS = 60 * 60_000;
// One player's 4 requests, one per ruleset, at 60 requests a minute
const PLAYER_AT_SPEED_MS = (60_000 * 4) / 60;

const counterTotal = async (counter: Counter<string>) =>
  (await counter.get()).values.reduce((sum, { value }) => sum + value, 0);

/**
 * A stand-in for osu!: its token endpoint refreshes the refresh tokens it
 * was told about, and its user endpoint answers only bearer tokens it
 * issued. It records every request and the token each one carried.
 */
const createFakeOsu = () => {
  const state = {
    /** Refreshes still answer, but osu! accepts none of the tokens, as after a user revokes access. */
    revoked: false,
    accessTokens: new Set<string>(),
    /** Refresh token -> the pair a refresh with it returns. */
    refreshes: new Map<string, { access: string; refresh: string }>(),
    lookups: [] as Array<{ osuId: number; token: string }>,
    refreshRequests: [] as URLSearchParams[],
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === 'POST' && url.pathname === '/oauth/token') {
        const form = new URLSearchParams(await request.text());
        state.refreshRequests.push(form);

        if (
          form.get('client_id') !== CLIENT.clientId ||
          form.get('client_secret') !== CLIENT.clientSecret
        ) {
          return Response.json({ error: 'invalid_client' }, { status: 401 });
        }

        const next = state.refreshes.get(form.get('refresh_token') ?? '');
        if (form.get('grant_type') !== 'refresh_token' || !next) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }

        state.refreshes.delete(form.get('refresh_token')!);
        if (!state.revoked) {
          state.accessTokens.add(next.access);
        }
        return Response.json({
          token_type: 'Bearer',
          expires_in: 86_400,
          access_token: next.access,
          refresh_token: next.refresh,
        });
      }

      const user = /^\/api\/v2\/users\/(\d+)\/(\w+)$/.exec(url.pathname);
      if (request.method === 'GET' && user) {
        const token =
          request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
        const osuId = Number(user[1]);
        state.lookups.push({ osuId, token });

        if (state.revoked || !state.accessTokens.has(token)) {
          return Response.json({ authentication: 'basic' }, { status: 401 });
        }

        return Response.json({
          id: osuId,
          username: `looked-up-${osuId}`,
          country_code: 'NZ',
          previous_usernames: [],
          statistics: { pp: 1000, global_rank: 5000 },
        });
      }

      return new Response('Not found', { status: 404 });
    },
  });

  return { state, url: `http://127.0.0.1:${server.port}`, server };
};

const waitFor = async (
  condition: () => Promise<boolean>,
  timeoutMs = 10_000
) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe.skipIf(!testDatabaseUrl)("osu! lookups with a user's account", () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);
  const osu = createFakeOsu();
  let runner: InstanceType<typeof JobRunner> | null = null;
  let requesterId = 0;
  let otherRequesterId = 0;

  /** A signed-up user with saved osu! tokens: the access token expires in `expiresInMs`. */
  const seedRequester = async (
    osuId: number,
    tokens: { access: string; refresh: string; expiresInMs: number }
  ) => {
    const [player] = await db
      .insert(schema.players)
      .values({ osuId })
      .returning({ id: schema.players.id });
    const [user] = await db
      .insert(schema.users)
      .values({ playerId: player!.id, scopes: [] })
      .returning({ id: schema.users.id });
    const authUserId = `lookup-test-${osuId}`;
    await db.insert(schema.auth_users).values({
      id: authUserId,
      name: `requester-${osuId}`,
      email: `${authUserId}@example.invalid`,
      playerId: player!.id,
    });
    await db.insert(schema.auth_accounts).values({
      id: `account-${osuId}`,
      accountId: String(osuId),
      providerId: 'osu',
      userId: authUserId,
      accessToken: tokens.access,
      refreshToken: tokens.refresh,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresInMs),
      updatedAt: new Date(),
    });
    return user!.id;
  };

  /** Placeholders and lookups, as the registrant filter leaves them. */
  const queueLookups = async (userId: number, osuIds: number[]) => {
    await db.insert(schema.players).values(
      osuIds.map((osuId) => ({
        osuId,
        dataFetchStatus: DataFetchStatus.Fetching,
        osuLastFetch: sql`CURRENT_TIMESTAMP`,
      }))
    );
    await enqueueJobs(
      db,
      JobQueue.OsuLookup,
      osuIds.map((osuPlayerId) => ({
        payload: { osuPlayerId },
        requestedByUserId: userId,
      }))
    );
  };

  const startWorker = () => {
    runner = new JobRunner({ db, logger: silentLogger, pollMs: 20 });
    runner.register(
      new OsuLookupWorker({
        db,
        tokens: new UserOsuTokens({ db, client: CLIENT, server: osu.url }),
        logger: silentLogger,
        maintenanceWindowEnabled: false,
        server: osu.url,
        startupPauseMs: 0,
      }).registration()
    );
    runner.start();
  };

  const lookupJobs = async (userId: number) =>
    (await jobRows(db)).filter(
      (row) =>
        row.queue === JobQueue.OsuLookup &&
        (row as unknown as { requested_by_user_id: number })
          .requested_by_user_id === userId
    );

  const players = async (osuIds: number[]) =>
    db
      .select({
        osuId: schema.players.osuId,
        username: schema.players.username,
        status: schema.players.dataFetchStatus,
      })
      .from(schema.players)
      .where(inArray(schema.players.osuId, osuIds))
      .orderBy(schema.players.osuId);

  const savedTokens = async (userId: number) => {
    const { rows } = await db.execute<{
      access_token: string;
      refresh_token: string;
    }>(sql`
      SELECT a.access_token, a.refresh_token
      FROM users u
      JOIN auth_users au ON au.player_id = u.player_id
      JOIN auth_accounts a ON a.user_id = au.id
      WHERE u.id = ${userId}`);
    return rows[0];
  };

  const signInNote = async (userId: number) =>
    (
      await db
        .select({ note: schema.users.osuSignInNeededAt })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
    )[0]?.note ?? null;

  const cleanUp = async () => {
    const seeded = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(inArray(schema.players.osuId, ALL_PLAYERS));
    const ids = seeded.map((row) => row.id);
    if (ids.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.playerId, ids));
      // Cascades to the auth users and their accounts
      await db.delete(schema.players).where(inArray(schema.players.id, ids));
    }
  };

  beforeEach(async () => {
    await resetJobTables(db);
    await cleanUp();
    osu.state.revoked = false;
    osu.state.accessTokens = new Set(['access-1']);
    osu.state.refreshes = new Map([
      ['refresh-1', { access: 'access-2', refresh: 'refresh-2' }],
    ]);
    osu.state.lookups = [];
    osu.state.refreshRequests = [];
    requesterId = await seedRequester(REQUESTER_OSU_ID, {
      access: 'access-1',
      refresh: 'refresh-1',
      expiresInMs: HOUR_MS,
    });
  });

  afterEach(async () => {
    await runner?.stop();
    runner = null;
  });

  afterAll(async () => {
    await cleanUp();
    osu.server.stop(true);
    await pool.end();
  });

  it("looks a player up with the requester's own token and saves them", async () => {
    await queueLookups(requesterId, [LOOKED_UP[0]!]);

    startWorker();
    await waitFor(
      async () =>
        (await lookupJobs(requesterId))[0]?.status === JobStatus.Succeeded
    );

    expect(await players([LOOKED_UP[0]!])).toEqual([
      {
        osuId: LOOKED_UP[0]!,
        username: `looked-up-${LOOKED_UP[0]}`,
        status: DataFetchStatus.Fetched,
      },
    ]);
    // One request per ruleset, every one with the user's token
    expect(osu.state.lookups).toHaveLength(4);
    expect(new Set(osu.state.lookups.map((lookup) => lookup.token))).toEqual(
      new Set(['access-1'])
    );
  });

  it("counts requests made with a user's token apart from o!TR's own osu! requests", async () => {
    // Drop what earlier tests recorded into the shared totals
    await apiRequestStats.flush(db);
    await db.execute(sql`DELETE FROM api_request_stats_daily`);
    const otrBefore = await counterTotal(osuApiRequests);
    const userBefore = await counterTotal(osuLookupRequests);
    await queueLookups(requesterId, [LOOKED_UP[0]!]);

    startWorker();
    await waitFor(
      async () =>
        (await lookupJobs(requesterId))[0]?.status === JobStatus.Succeeded
    );
    await apiRequestStats.flush(db);

    expect(await counterTotal(osuApiRequests)).toBe(otrBefore);
    expect(await counterTotal(osuLookupRequests)).toBe(userBefore + 4);
    const { rows } = await db.execute(sql`
      SELECT service, endpoint, status, count FROM api_request_stats_daily`);
    expect(rows).toEqual([
      {
        service: 'osu-lookup',
        endpoint: 'getUser',
        status: 'success',
        count: 4,
      },
    ]);
  });

  it('refreshes an expired token with the site client first, and saves the new pair', async () => {
    await db
      .update(schema.auth_accounts)
      .set({ accessTokenExpiresAt: new Date(Date.now() - HOUR_MS) })
      .where(eq(schema.auth_accounts.id, `account-${REQUESTER_OSU_ID}`));
    await queueLookups(requesterId, [LOOKED_UP[0]!]);

    startWorker();
    await waitFor(
      async () =>
        (await lookupJobs(requesterId))[0]?.status === JobStatus.Succeeded
    );

    expect(
      osu.state.refreshRequests.map((form) => form.get('refresh_token'))
    ).toEqual(['refresh-1']);
    expect(await savedTokens(requesterId)).toEqual({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
    });
    expect(new Set(osu.state.lookups.map((lookup) => lookup.token))).toEqual(
      new Set(['access-2'])
    );
  });

  it('holds every lookup of a user whose token osu! refuses, even fresh, until they sign in again', async () => {
    // osu! accepts neither the saved token nor the one a refresh returns
    osu.state.revoked = true;
    await queueLookups(requesterId, LOOKED_UP.slice(0, 3));
    const started = Date.now();

    startWorker();
    await waitFor(async () => (await signInNote(requesterId)) !== null);
    await waitFor(async () =>
      (await lookupJobs(requesterId)).every(
        (job) => job.status === JobStatus.Pending
      )
    );

    const jobs = await lookupJobs(requesterId);
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job.attempts).toBe(0);
      expect(job.run_after.getTime() - started).toBeGreaterThanOrEqual(
        SIGN_IN_WAIT_MS - 60_000
      );
    }
    // The saved token once, the refreshed one once, then nothing more
    expect(osu.state.lookups.map((lookup) => lookup.token)).toEqual([
      'access-1',
      'access-2',
    ]);
    expect(
      (await players(LOOKED_UP.slice(0, 3))).map((player) => player.status)
    ).toEqual([
      DataFetchStatus.Fetching,
      DataFetchStatus.Fetching,
      DataFetchStatus.Fetching,
    ]);
  });

  it("waits for a sign-in, without calling osu!'s API, when osu! refuses to refresh", async () => {
    await db
      .update(schema.auth_accounts)
      .set({ accessTokenExpiresAt: new Date(Date.now() - HOUR_MS) })
      .where(eq(schema.auth_accounts.id, `account-${REQUESTER_OSU_ID}`));
    osu.state.refreshes = new Map();
    await queueLookups(requesterId, [LOOKED_UP[0]!]);

    startWorker();
    await waitFor(async () => (await signInNote(requesterId)) !== null);

    expect(osu.state.refreshRequests).toHaveLength(1);
    expect(osu.state.lookups).toEqual([]);
  });

  it('a lookup that works again clears the note and wakes the lookups that waited', async () => {
    await queueLookups(requesterId, LOOKED_UP.slice(0, 2));
    await db
      .update(schema.users)
      .set({ osuSignInNeededAt: sql`now()` })
      .where(eq(schema.users.id, requesterId));
    // One lookup waits for the sign-in; the other runs now and works
    await db.execute(sql`
      UPDATE jobs SET run_after = now() + interval '7 days'
      WHERE payload->>'osuPlayerId' = ${String(LOOKED_UP[1])}`);

    startWorker();
    await waitFor(async () =>
      (await lookupJobs(requesterId)).every(
        (job) => job.status === JobStatus.Succeeded
      )
    );

    expect(await signInNote(requesterId)).toBeNull();
  });

  it("never makes more than 60 requests a minute with one user's token, and runs another user's lookups meanwhile", async () => {
    otherRequesterId = await seedRequester(OTHER_REQUESTER_OSU_ID, {
      access: 'other-access',
      refresh: 'other-refresh',
      expiresInMs: HOUR_MS,
    });
    osu.state.accessTokens.add('other-access');
    // 16 players at 4 requests each: 64, one player more than a minute allows
    await queueLookups(requesterId, LOOKED_UP.slice(0, 16));
    await queueLookups(otherRequesterId, [LOOKED_UP[16]!]);
    const started = Date.now();

    startWorker();
    await waitFor(async () => {
      const mine = await lookupJobs(requesterId);
      const theirs = await lookupJobs(otherRequesterId);
      return (
        mine.filter((job) => job.status === JobStatus.Succeeded).length ===
          15 && theirs[0]?.status === JobStatus.Succeeded
      );
    });
    await waitFor(async () =>
      (await lookupJobs(requesterId)).some(
        (job) => job.status === JobStatus.Pending && job.last_error !== null
      )
    );

    const tokens = osu.state.lookups.map((lookup) => lookup.token);
    expect(tokens.filter((token) => token === 'access-1')).toHaveLength(60);
    expect(tokens.filter((token) => token === 'other-access')).toHaveLength(4);
    // The 16th waits, without an attempt, until the first request is a minute old
    const [waiting] = (await lookupJobs(requesterId)).filter(
      (job) => job.status === JobStatus.Pending
    );
    expect(waiting!.attempts).toBe(0);
    expect(waiting!.run_after.getTime()).toBeGreaterThan(started + 50_000);
    expect(waiting!.run_after.getTime()).toBeLessThanOrEqual(
      Date.now() + 61_000
    );
  });

  it("spreads a user's waiting lookups out to their speed, so a later deferral moves none of the others", async () => {
    // 15 players fill the minute; the 16th waits and spreads out the last 3
    await queueLookups(requesterId, LOOKED_UP.slice(0, 19));

    startWorker();
    await waitFor(async () => {
      const jobs = await lookupJobs(requesterId);
      return (
        jobs.filter((job) => job.status === JobStatus.Succeeded).length ===
          15 &&
        jobs.some(
          (job) => job.status === JobStatus.Pending && job.last_error !== null
        )
      );
    });

    const waiting = async () =>
      (await lookupJobs(requesterId))
        .filter((job) => job.status === JobStatus.Pending)
        .sort(
          (a, b) => a.run_after.getTime() - b.run_after.getTime() || a.id - b.id
        );
    const pending = await waiting();
    const deferred = pending.find((job) => job.last_error !== null);
    const rest = pending.filter((job) => job !== deferred);
    expect(rest).toHaveLength(3);
    // The deferred lookup goes first, then the rest one player apart
    const times = [deferred!, ...rest].map((job) => job.run_after.getTime());
    const gaps = times.slice(1).map((time, i) => time - times[i]!);
    // The deferred lookup's own time comes from a statement a moment later
    expect(gaps[0]).toBeGreaterThan(PLAYER_AT_SPEED_MS - 1_000);
    expect(gaps[0]).toBeLessThanOrEqual(PLAYER_AT_SPEED_MS);
    expect(gaps.slice(1)).toEqual([PLAYER_AT_SPEED_MS, PLAYER_AT_SPEED_MS]);

    // Due again while the minute is still full, it waits again alone
    const before = rest.map((job) => ({
      id: job.id,
      runAfter: job.run_after.getTime(),
      updated: (job as unknown as { updated: unknown }).updated,
    }));
    await db.execute(
      sql`UPDATE jobs SET run_after = now() WHERE id = ${deferred!.id}`
    );
    await waitFor(async () => {
      const job = (await lookupJobs(requesterId)).find(
        (row) => row.id === deferred!.id
      );
      return (
        job?.status === JobStatus.Pending &&
        job.run_after.getTime() > Date.now() + 30_000
      );
    });

    const after = (await waiting())
      .filter((job) => job.id !== deferred!.id)
      .map((job) => ({
        id: job.id,
        runAfter: job.run_after.getTime(),
        updated: (job as unknown as { updated: unknown }).updated,
      }));
    expect(after).toEqual(before);
  });

  it('finishes without calling osu! when another fetch already saved the player', async () => {
    await db.insert(schema.players).values({
      osuId: ALREADY_FETCHED,
      dataFetchStatus: DataFetchStatus.Fetched,
    });
    await enqueueJobs(db, JobQueue.OsuLookup, [
      {
        payload: { osuPlayerId: ALREADY_FETCHED },
        requestedByUserId: requesterId,
      },
    ]);

    startWorker();
    await waitFor(
      async () =>
        (await lookupJobs(requesterId))[0]?.status === JobStatus.Succeeded
    );

    expect(osu.state.lookups).toEqual([]);
  });

  it("hands the lookups of a requester who deleted their account to o!TR's own osu! client", async () => {
    await queueLookups(requesterId, [LOOKED_UP[0]!]);
    await db.delete(schema.users).where(eq(schema.users.id, requesterId));

    startWorker();
    await waitFor(
      async () =>
        (await lookupJobs(requesterId))[0]?.status === JobStatus.Cancelled
    );

    expect(osu.state.lookups).toEqual([]);
    const fetches = (await jobRows(db)).filter(
      (row) => row.queue === JobQueue.OsuFetch
    );
    expect(
      fetches.map(({ payload, priority, status }) => ({
        payload,
        priority,
        status,
      }))
    ).toEqual([
      {
        payload: { type: 'player', osuPlayerId: LOOKED_UP[0] },
        priority: MessagePriority.Low,
        status: JobStatus.Pending,
      },
    ]);
    // Under that fetch now, so the refetch and the stranded sweep leave it be
    expect((await players([LOOKED_UP[0]!]))[0]?.status).toBe(
      DataFetchStatus.Fetching
    );
  });

  it("claims no lookup for a minute after the worker starts, so a restart can't add to a user's last minute", () => {
    // A Monday morning, outside the maintenance window
    const start = Date.parse('2026-10-19T10:00:00Z');
    const { pausedUntil } = new OsuLookupWorker({
      db,
      tokens: new UserOsuTokens({ db, client: CLIENT, server: osu.url }),
      logger: silentLogger,
      maintenanceWindowEnabled: true,
      server: osu.url,
      now: () => start,
    }).registration();

    expect(pausedUntil!(new Date(start + 59_000))).toEqual(
      new Date(start + 60_000)
    );
    expect(pausedUntil!(new Date(start + 60_000))).toBeNull();
  });
});
