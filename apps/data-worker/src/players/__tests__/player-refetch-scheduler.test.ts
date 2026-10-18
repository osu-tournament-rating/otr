import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue } from '@otr/core/jobs';
import { Ruleset } from '@otr/core/osu';

import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import { PlayerRefetchScheduler } from '../player-refetch-scheduler';

const url = process.env.SEARCH_TEST_DATABASE_URL;

const FALLBACK_DAYS = 14;

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

/** Player fetch jobs queued for these players, oldest first. */
const queuedPlayerFetches = async (
  db: { execute: DatabaseClient['execute'] },
  osuIds: number[]
) => {
  const { rows } = await db.execute<{
    osu_player_id: string;
    priority: number;
  }>(
    sql`SELECT payload->>'osuPlayerId' AS osu_player_id, priority FROM jobs
      WHERE queue = 'data.osu' AND payload->>'type' = 'player'
        AND (payload->>'osuPlayerId')::bigint IN (${sql.join(
          osuIds.map((id) => sql`${id}`),
          sql`, `
        )})
      ORDER BY id`
  );
  return rows.map((row) => ({
    osuPlayerId: Number(row.osu_player_id),
    priority: row.priority as MessagePriority,
  }));
};

/** osu!track fetch jobs queued for these players, oldest first. */
const queuedOsuTrackFetches = async (
  db: { execute: DatabaseClient['execute'] },
  osuIds: number[]
) => {
  const { rows } = await db.execute<{
    osu_player_id: string;
    priority: number;
    payload: Record<string, unknown>;
  }>(
    sql`SELECT payload->>'osuPlayerId' AS osu_player_id, priority, payload FROM jobs
      WHERE queue = ${JobQueue.OsuTrackFetch}
        AND (payload->>'osuPlayerId')::bigint IN (${sql.join(
          osuIds.map((id) => sql`${id}`),
          sql`, `
        )})
      ORDER BY id`
  );
  return rows.map((row) => ({
    osuPlayerId: Number(row.osu_player_id),
    priority: row.priority as MessagePriority,
    payload: row.payload,
  }));
};

const removePlayerFetches = (
  db: { execute: DatabaseClient['execute'] },
  osuIds: number[]
) =>
  db.execute(sql`DELETE FROM jobs
    WHERE (
        (queue = 'data.osu' AND payload->>'type' = 'player')
        OR queue = ${JobQueue.OsuTrackFetch}
      )
      AND (payload->>'osuPlayerId')::bigint IN (${sql.join(
        osuIds.map((id) => sql`${id}`),
        sql`, `
      )})`);

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

type SeededPlayer = {
  osuId: number;
  lastFetch: number;
  ratings: Array<[Ruleset, number]>;
  fetching?: boolean;
  // Cadence the player should be published under, or null when this run skips them.
  expected: number | null;
};

const seed: SeededPlayer[] = [
  {
    osuId: 999_300_001,
    lastFetch: 2,
    ratings: [[Ruleset.Osu, 100]],
    expected: 1,
  },
  {
    osuId: 999_300_002,
    lastFetch: 0.5,
    ratings: [[Ruleset.Osu, 100]],
    expected: null,
  },
  {
    osuId: 999_300_003,
    lastFetch: 2,
    ratings: [[Ruleset.Osu, 3000]],
    expected: null,
  },
  {
    osuId: 999_300_004,
    lastFetch: 4,
    ratings: [[Ruleset.Osu, 3000]],
    expected: 3,
  },
  {
    osuId: 999_300_005,
    lastFetch: 8,
    ratings: [[Ruleset.Osu, 15000]],
    expected: 7,
  },
  {
    osuId: 999_300_006,
    lastFetch: 8,
    ratings: [[Ruleset.Osu, 50000]],
    expected: null,
  },
  {
    osuId: 999_300_007,
    lastFetch: 20,
    ratings: [[Ruleset.Osu, 50000]],
    expected: FALLBACK_DAYS,
  },
  { osuId: 999_300_008, lastFetch: 20, ratings: [], expected: FALLBACK_DAYS },
  {
    osuId: 999_300_009,
    lastFetch: 4,
    ratings: [[Ruleset.Taiko, 3000]],
    expected: null,
  },
  {
    osuId: 999_300_010,
    lastFetch: 8,
    ratings: [[Ruleset.Taiko, 3000]],
    expected: 7,
  },
  {
    osuId: 999_300_011,
    lastFetch: 2,
    ratings: [
      [Ruleset.Osu, 50000],
      [Ruleset.Mania7k, 300],
    ],
    expected: 1,
  },
  {
    osuId: 999_300_012,
    lastFetch: 2,
    ratings: [[Ruleset.Osu, 100]],
    fetching: true,
    expected: null,
  },
  {
    osuId: 999_300_013,
    lastFetch: 2,
    ratings: [[Ruleset.Osu, 500]],
    expected: 1,
  },
  {
    osuId: 999_300_014,
    lastFetch: 2,
    ratings: [[Ruleset.Osu, 501]],
    expected: null,
  },
  {
    osuId: 999_300_015,
    lastFetch: 4,
    ratings: [[Ruleset.Osu, 5000]],
    expected: 3,
  },
  {
    osuId: 999_300_016,
    lastFetch: 4,
    ratings: [[Ruleset.Osu, 5001]],
    expected: null,
  },
  {
    osuId: 999_300_017,
    lastFetch: 8,
    ratings: [[Ruleset.Osu, 20000]],
    expected: 7,
  },
  {
    osuId: 999_300_018,
    lastFetch: 8,
    ratings: [[Ruleset.Osu, 20001]],
    expected: null,
  },
  {
    osuId: 999_300_019,
    lastFetch: 2,
    ratings: [[Ruleset.Taiko, 500]],
    expected: 1,
  },
  {
    osuId: 999_300_020,
    lastFetch: 2,
    ratings: [[Ruleset.Taiko, 501]],
    expected: null,
  },
];

describe.skipIf(!url)('osu! auto-refetch tiers', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  const osuIds = seed.map((player) => player.osuId);

  let published: Array<{ osuPlayerId: number; priority?: MessagePriority }> =
    [];

  const remove = async () => {
    await removePlayerFetches(db, osuIds);
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, osuIds));
  };

  beforeAll(async () => {
    await remove();

    for (const player of seed) {
      const [row] = await db
        .insert(schema.players)
        .values({
          osuId: player.osuId,
          username: `tier-${player.osuId}`,
          osuLastFetch: daysAgo(player.lastFetch),
          dataFetchStatus: player.fetching
            ? DataFetchStatus.Fetching
            : DataFetchStatus.Fetched,
        })
        .returning({ id: schema.players.id });

      if (player.ratings.length > 0) {
        await db.insert(schema.playerRatings).values(
          player.ratings.map(([ruleset, globalRank]) => ({
            playerId: row!.id,
            ruleset,
            rating: 1000,
            volatility: 100,
            percentile: 0.5,
            globalRank,
            countryRank: globalRank,
          }))
        );
      }
    }

    const scheduler = new PlayerRefetchScheduler({
      db: db as unknown as DatabaseClient,
      logger: silentLogger,
      config: {
        osu: {
          enabled: true,
          intervalMinutes: 30,
          outdatedDays: FALLBACK_DAYS,
        },
        osuTrack: { enabled: false, intervalMinutes: 30, outdatedDays: 60 },
      },
    });

    await scheduler.start();
    await scheduler.stop();

    published = await queuedPlayerFetches(db, osuIds);
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  const enqueued = () =>
    published
      .map((entry) => entry.osuPlayerId)
      .filter((osuPlayerId) => osuIds.includes(osuPlayerId));

  it('enqueues only players past their tier cadence', () => {
    const expected = seed
      .filter((player) => player.expected !== null)
      .map((player) => player.osuId);

    expect(new Set(enqueued())).toEqual(new Set(expected));
  });

  it('publishes the daily tier at normal priority and the rest at low', () => {
    for (const player of seed) {
      if (player.expected === null) {
        continue;
      }

      const entry = published.find(
        (candidate) => candidate.osuPlayerId === player.osuId
      );

      expect(entry?.priority).toBe(
        player.expected === 1 ? MessagePriority.Normal : MessagePriority.Low
      );
    }
  });

  it('publishes the shortest cadence first', () => {
    const cadences = enqueued().map(
      (osuPlayerId) =>
        seed.find((player) => player.osuId === osuPlayerId)!.expected!
    );

    expect(cadences).toEqual([...cadences].sort((a, b) => a - b));
  });
});

type LeaseCase = {
  osuId: number;
  status: DataFetchStatus;
  // Days since the last fetch or lease start; null for never.
  lastFetch: number | null;
  publish: 'ok' | 'fail';
  enqueued: boolean;
};

const osuLeaseCases: LeaseCase[] = [
  // Stale lease
  {
    osuId: 999_301_001,
    status: DataFetchStatus.Fetching,
    lastFetch: 8,
    publish: 'ok',
    enqueued: true,
  },
  // Fresh lease
  {
    osuId: 999_301_002,
    status: DataFetchStatus.Fetching,
    lastFetch: 2,
    publish: 'ok',
    enqueued: false,
  },
  {
    osuId: 999_301_003,
    status: DataFetchStatus.Fetched,
    lastFetch: 2,
    publish: 'fail',
    enqueued: false,
  },
  {
    osuId: 999_301_004,
    status: DataFetchStatus.Fetching,
    lastFetch: 8,
    publish: 'fail',
    enqueued: false,
  },
];

const osuTrackLeaseCases: LeaseCase[] = [
  {
    osuId: 999_301_011,
    status: DataFetchStatus.Fetching,
    lastFetch: 8,
    publish: 'ok',
    enqueued: true,
  },
  // Marked Fetching before leases recorded a start
  {
    osuId: 999_301_012,
    status: DataFetchStatus.Fetching,
    lastFetch: null,
    publish: 'ok',
    enqueued: true,
  },
  {
    osuId: 999_301_013,
    status: DataFetchStatus.Fetching,
    lastFetch: 2,
    publish: 'ok',
    enqueued: false,
  },
  {
    osuId: 999_301_014,
    status: DataFetchStatus.Fetched,
    lastFetch: 90,
    publish: 'fail',
    enqueued: false,
  },
  {
    osuId: 999_301_015,
    status: DataFetchStatus.Fetching,
    lastFetch: 8,
    publish: 'fail',
    enqueued: false,
  },
  {
    osuId: 999_301_016,
    status: DataFetchStatus.NotFetched,
    lastFetch: null,
    publish: 'fail',
    enqueued: false,
  },
];

describe.skipIf(!url)('auto-refetch fetch leases', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  const cases = [...osuLeaseCases, ...osuTrackLeaseCases];
  const osuIds = cases.map((entry) => entry.osuId);

  const seededAt = new Map<number, string | null>();
  const published = { osu: [] as number[], osuTrack: [] as number[] };
  let osuTrackJobs: Awaited<ReturnType<typeof queuedOsuTrackFetches>> = [];
  let runStartedMs = 0;

  // Both kinds of fetch are queued in the jobs table; a trigger makes the
  // insert fail for the players whose enqueue should fail.
  const failingOsuIds = cases
    .filter((entry) => entry.publish === 'fail')
    .map((entry) => String(entry.osuId));

  const remove = async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS refetch_test_fail_enqueue ON jobs`
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS refetch_test_fail_enqueue()`);
    await removePlayerFetches(db, osuIds);
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, osuIds));
  };

  const epochMs = (
    column:
      | typeof schema.players.osuLastFetch
      | typeof schema.players.osuTrackLastFetch
  ) =>
    sql<number | null>`extract(epoch from ${column}) * 1000`.mapWith((value) =>
      value === null ? null : Number(value)
    );

  const readPlayer = async (osuId: number) => {
    const [row] = await db
      .select({
        status: schema.players.dataFetchStatus,
        lastFetchMs: epochMs(schema.players.osuLastFetch),
        osuTrackStatus: schema.players.osuTrackDataFetchStatus,
        osuTrackLastFetchMs: epochMs(schema.players.osuTrackLastFetch),
      })
      .from(schema.players)
      .where(eq(schema.players.osuId, osuId));

    return row!;
  };

  const msOf = (iso: string | null | undefined) =>
    iso ? new Date(iso).getTime() : null;

  beforeAll(async () => {
    await remove();

    for (const entry of osuLeaseCases) {
      const lastFetch = daysAgo(entry.lastFetch!);
      seededAt.set(entry.osuId, lastFetch);
      await db.insert(schema.players).values({
        osuId: entry.osuId,
        dataFetchStatus: entry.status,
        osuLastFetch: lastFetch,
        // Rank 100 refetches daily, so every row is past its cadence.
        osuTrackDataFetchStatus: DataFetchStatus.Fetched,
        osuTrackLastFetch: daysAgo(0),
      });
    }

    const osuIdsWithRatings = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(
        inArray(
          schema.players.osuId,
          osuLeaseCases.map((entry) => entry.osuId)
        )
      );

    await db.insert(schema.playerRatings).values(
      osuIdsWithRatings.map(({ id }) => ({
        playerId: id,
        ruleset: Ruleset.Osu,
        rating: 1000,
        volatility: 100,
        percentile: 0.5,
        globalRank: 100,
        countryRank: 100,
      }))
    );

    for (const entry of osuTrackLeaseCases) {
      const lastFetch =
        entry.lastFetch === null ? null : daysAgo(entry.lastFetch);
      seededAt.set(entry.osuId, lastFetch);
      await db.insert(schema.players).values({
        osuId: entry.osuId,
        dataFetchStatus: DataFetchStatus.Fetched,
        osuLastFetch: daysAgo(0),
        osuTrackDataFetchStatus: entry.status,
        osuTrackLastFetch: lastFetch,
      });
    }

    await db.execute(sql`
      CREATE FUNCTION refetch_test_fail_enqueue() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'jobs table unavailable';
      END;
      $$`);
    await db.execute(sql`
      CREATE TRIGGER refetch_test_fail_enqueue BEFORE INSERT ON jobs
      FOR EACH ROW
      WHEN (NEW.payload->>'osuPlayerId' IN (${sql.raw(failingOsuIds.map((id) => `'${id}'`).join(', '))}))
      EXECUTE FUNCTION refetch_test_fail_enqueue()`);

    const scheduler = new PlayerRefetchScheduler({
      db: db as unknown as DatabaseClient,
      logger: silentLogger,
      config: {
        osu: { enabled: true, intervalMinutes: 30, outdatedDays: 14 },
        osuTrack: { enabled: true, intervalMinutes: 30, outdatedDays: 60 },
      },
    });

    // Postgres keeps microseconds; allow for the truncation to milliseconds.
    runStartedMs = Date.now() - 1;
    await scheduler.start();
    await scheduler.stop();

    published.osu = (await queuedPlayerFetches(db, osuIds)).map(
      (entry) => entry.osuPlayerId
    );
    osuTrackJobs = await queuedOsuTrackFetches(db, osuIds);
    published.osuTrack = osuTrackJobs.map((entry) => entry.osuPlayerId);
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  it('queues osu!track fetches at low priority', () => {
    expect(osuTrackJobs).toEqual(
      osuTrackLeaseCases
        .filter((entry) => entry.enqueued)
        .map((entry) => ({
          osuPlayerId: entry.osuId,
          priority: MessagePriority.Low,
          payload: { osuPlayerId: entry.osuId },
        }))
    );
  });

  for (const [source, sourceCases] of [
    ['osu', osuLeaseCases],
    ['osuTrack', osuTrackLeaseCases],
  ] as const) {
    describe(source, () => {
      const current = async (osuId: number) => {
        const row = await readPlayer(osuId);
        return source === 'osu'
          ? { status: row.status, lastFetchMs: row.lastFetchMs }
          : {
              status: row.osuTrackStatus,
              lastFetchMs: row.osuTrackLastFetchMs,
            };
      };

      it('enqueues expired leases and skips fresh ones', () => {
        const expected = sourceCases
          .filter((entry) => entry.enqueued)
          .map((entry) => entry.osuId);
        const enqueued = published[source].filter((osuId) =>
          osuIds.includes(osuId)
        );

        expect(new Set(enqueued)).toEqual(new Set(expected));
      });

      it('renews the lease of every enqueued player', async () => {
        for (const entry of sourceCases.filter((c) => c.enqueued)) {
          const row = await current(entry.osuId);

          expect(row.status).toBe(DataFetchStatus.Fetching);
          expect(row.lastFetchMs!).toBeGreaterThanOrEqual(runStartedMs);
        }
      });

      it('leaves a fresh lease untouched', async () => {
        for (const entry of sourceCases.filter(
          (c) => c.status === DataFetchStatus.Fetching && c.lastFetch === 2
        )) {
          const row = await current(entry.osuId);

          expect(row.status).toBe(DataFetchStatus.Fetching);
          expect(row.lastFetchMs).toBe(msOf(seededAt.get(entry.osuId)));
        }
      });

      it('restores the previous state when queueing fails', async () => {
        for (const entry of sourceCases.filter((c) => c.publish === 'fail')) {
          const row = await current(entry.osuId);

          expect(row.status).toBe(entry.status);
          expect(row.lastFetchMs).toBe(msOf(seededAt.get(entry.osuId)));
        }
      });
    });
  }
});
