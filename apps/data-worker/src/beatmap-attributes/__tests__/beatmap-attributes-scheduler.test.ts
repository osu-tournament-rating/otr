import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { is, sql, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJob, JobQueue, JobStatus } from '@otr/core/jobs';
import { Mods, Ruleset, VerificationStatus } from '@otr/core/osu';

import type { DatabaseClient } from '../../db';
import {
  BeatmapAttributesScheduler,
  NEEDING_ATTRIBUTES_RECHECK_MS,
  SWEEP_BATCH_SIZE,
  findBeatmapsMissingFiles,
  findBeatmapsNeedingAttributes,
} from '../beatmap-attributes-scheduler';
import { CALCULATOR } from '../calculator';
import { AttributeTestSeed, createTestDb, silentLogger } from './db-fixtures';

const url = process.env.SEARCH_TEST_DATABASE_URL;

// Large enough for every candidate in a production-sized database.
const EVERYTHING = 10_000_000;

// Tuesday 12:00 UTC, inside the maintenance window.
const MAINTENANCE = new Date('2026-10-13T12:00:00Z');
const OUTSIDE_MAINTENANCE = new Date('2026-10-14T12:00:00Z');

const dialect = new PgDialect();

// The sweep's check for a ready attribute job, which reads the jobs table.
const isReadyJobCheck = (query: unknown) =>
  is(query, SQL) && dialect.sqlToQuery(query).sql.includes('from jobs');

const unusedDb = new Proxy(
  {},
  {
    get() {
      throw new Error('The sweep should not have queried the database');
    },
  }
) as DatabaseClient;

describe('BeatmapAttributesScheduler guards', () => {
  it('skips inside the maintenance window', async () => {
    // Any query, including the check for ready jobs, reads unusedDb and throws.
    expect(
      await new BeatmapAttributesScheduler({
        db: unusedDb,
        logger: silentLogger,
        maintenanceWindowEnabled: true,
        now: () => MAINTENANCE,
      }).sweep()
    ).toMatchObject({
      skipped: 'maintenance',
    });
  });

  it('looks for beatmaps needing attributes again only an hour after finding none', async () => {
    // Each query answers with the next list of beatmap ids.
    const answers = [[1], [], [], [], [], [], []];
    let queries = 0;
    const db = {
      execute: async (query: unknown) => {
        if (isReadyJobCheck(query)) {
          return { rows: [{ ready: false }] };
        }
        queries += 1;
        return {
          rows: (answers.shift() ?? []).map((id) => ({ beatmap_id: id })),
        };
      },
      // The sweep queues the jobs it found in a transaction of their own.
      transaction: async () => {},
    } as unknown as DatabaseClient;
    let now = OUTSIDE_MAINTENANCE.getTime();
    const scheduler = new BeatmapAttributesScheduler({
      db,
      logger: silentLogger,
      maintenanceWindowEnabled: true,
      now: () => new Date(now),
    });
    const sweepAfter = async (ms: number) => {
      now += ms;
      const before = queries;
      await scheduler.sweep();
      return queries - before;
    };

    // Both parts while something needs attributes, and once more after that.
    expect(await sweepAfter(0)).toBe(2);
    expect(await sweepAfter(10 * 60_000)).toBe(2);
    // Only missing files until the hour is up.
    expect(await sweepAfter(10 * 60_000)).toBe(1);
    expect(await sweepAfter(NEEDING_ATTRIBUTES_RECHECK_MS - 10 * 60_000)).toBe(
      2
    );
  });
});

describe.skipIf(!url)('beatmap attribute sweep', () => {
  const { pool, db } = createTestDb(url!);
  const seed = new AttributeTestSeed(db, 2);

  const needing: number[] = [];
  const current: number[] = [];
  const missingFirst: number[] = [];
  const missingLater: number[] = [];
  const notMissing: number[] = [];

  const storeFile = (
    beatmapId: number,
    checksum: string | null,
    fetchStatus: DataFetchStatus = DataFetchStatus.Fetched
  ) =>
    db.insert(schema.beatmapFiles).values({ beatmapId, checksum, fetchStatus });

  const insertRows = (beatmapId: number, mods: number[], calculator: string) =>
    db.insert(schema.beatmapAttributes).values(
      mods.map((key) => ({
        beatmapId,
        mods: key,
        sr: 1,
        ar: 1,
        cs: 1,
        od: 1,
        hp: 1,
        calculator,
      }))
    );

  /** An osu! standard beatmap with a stored file whose games need NM and HD. */
  const storedBeatmap = async (
    checksum: string | null = 'a'.repeat(32),
    fetchStatus: DataFetchStatus = DataFetchStatus.Fetched
  ) => {
    const beatmap = await seed.beatmap();
    await seed.game({ beatmapId: beatmap.id, scores: [Mods.Hidden] });
    await storeFile(beatmap.id, checksum, fetchStatus);
    return beatmap.id;
  };

  beforeAll(async () => {
    await seed.removeLeftovers();

    // Attributes needed
    needing.push(await storedBeatmap());

    const outdated = await storedBeatmap();
    await insertRows(outdated, [Mods.None, Mods.Hidden], 'rosu-pp-js@0.0.0');
    needing.push(outdated);

    const missingKey = await storedBeatmap();
    await insertRows(missingKey, [Mods.None], CALCULATOR);
    needing.push(missingKey);

    const upToDate = await storedBeatmap();
    await insertRows(upToDate, [Mods.None, Mods.Hidden], CALCULATOR);
    current.push(upToDate);

    current.push(await storedBeatmap('c'.repeat(32), DataFetchStatus.Error));
    current.push(await storedBeatmap(null, DataFetchStatus.NotFound));

    const taiko = await seed.beatmap({ ruleset: Ruleset.Taiko });
    await storeFile(taiko.id, 'd'.repeat(32));
    current.push(taiko.id);

    // Files missing, in the order the sweep queues them.
    const verified = await seed.beatmap();
    await seed.game({ beatmapId: verified.id, scores: [Mods.None] });
    missingFirst.push(verified.id);

    const pooled = await seed.beatmap();
    await seed.pool(pooled.id);

    const taikoPlayed = await seed.beatmap({ ruleset: Ruleset.Taiko });
    await seed.game({
      beatmapId: taikoPlayed.id,
      ruleset: Ruleset.Taiko,
      scores: [Mods.None],
    });

    const unverified = await seed.beatmap();
    await seed.game({
      beatmapId: unverified.id,
      verificationStatus: VerificationStatus.PreVerified,
      scores: [Mods.None],
    });

    // Newest first.
    missingLater.push(unverified.id, taikoPlayed.id, pooled.id);

    const notFetched = await seed.beatmap({
      dataFetchStatus: DataFetchStatus.NotFetched,
    });
    await seed.game({ beatmapId: notFetched.id, scores: [Mods.None] });
    notMissing.push(notFetched.id);

    notMissing.push((await seed.beatmap()).id);
  });

  const clearJobs = async () => {
    await db.execute(
      sql`DELETE FROM jobs WHERE queue = ${JobQueue.BeatmapAttributes}`
    );
  };

  beforeEach(clearJobs);

  afterAll(async () => {
    await clearJobs();
    await seed.remove();
    await pool.end();
  });

  const seeded = (ids: number[], of: number[]) =>
    ids.filter((id) => of.includes(id));

  it('finds osu! standard beatmaps with a usable file and missing or outdated attributes', async () => {
    const found = await findBeatmapsNeedingAttributes(db, EVERYTHING);

    expect(seeded(found, [...needing, ...current])).toEqual(needing);
  });

  it('finds fetched beatmaps in a game or a pool without a stored file', async () => {
    const all = [
      ...needing,
      ...current,
      ...missingFirst,
      ...missingLater,
      ...notMissing,
    ];
    const found = await findBeatmapsMissingFiles(db, EVERYTHING);

    expect(seeded(found, all)).toEqual([...missingFirst, ...missingLater]);
  });

  const sweep = () =>
    new BeatmapAttributesScheduler({
      db,
      logger: silentLogger,
      maintenanceWindowEnabled: true,
      now: () => OUTSIDE_MAINTENANCE,
    }).sweep();

  /** Attribute jobs in the order the runner claims them. */
  const queuedJobs = async () => {
    const { rows } = await db.execute<{
      beatmap_id: number;
      priority: number;
      max_attempts: number;
    }>(sql`
      SELECT (payload->>'beatmapId')::integer AS beatmap_id, priority, max_attempts
      FROM jobs
      WHERE queue = ${JobQueue.BeatmapAttributes} AND status = ${JobStatus.Pending}
      ORDER BY priority DESC, run_after, id`);
    return rows;
  };

  it.each([
    ['a ready job', JobStatus.Pending, 0, true],
    ['a retry in its backoff', JobStatus.Pending, 60 * 60_000, false],
    ['a running job', JobStatus.Running, 0, false],
  ] as const)(
    'skips only while an attribute job is ready: %s',
    async (_name, status, delayMs, skipped) => {
      await enqueueJob(db, JobQueue.BeatmapAttributes, {
        payload: { beatmapId: needing[0]! },
        // Left to the database's clock when the job is due now.
        runAfter: delayMs > 0 ? new Date(Date.now() + delayMs) : undefined,
      });
      await db.execute(
        sql`UPDATE jobs SET status = ${status} WHERE queue = ${JobQueue.BeatmapAttributes}`
      );

      const result = await sweep();

      expect(result.skipped === 'queue_not_empty').toBe(skipped);
    }
  );

  it('queues up to a batch at low priority with one attempt, attributes first', async () => {
    const needingAttributes = await findBeatmapsNeedingAttributes(
      db,
      SWEEP_BATCH_SIZE
    );
    const missingFiles = await findBeatmapsMissingFiles(
      db,
      SWEEP_BATCH_SIZE - needingAttributes.length
    );

    const result = await sweep();
    const queued = await queuedJobs();

    expect(result).toEqual({
      needingAttributes: needingAttributes.length,
      missingFiles: missingFiles.length,
    });
    expect(queued.map((job) => job.beatmap_id)).toEqual([
      ...needingAttributes,
      ...missingFiles,
    ]);
    expect(queued.length).toBeLessThanOrEqual(SWEEP_BATCH_SIZE);
    expect(
      queued.every(
        (job) => job.priority === MessagePriority.Low && job.max_attempts === 1
      )
    ).toBe(true);
  });
});
