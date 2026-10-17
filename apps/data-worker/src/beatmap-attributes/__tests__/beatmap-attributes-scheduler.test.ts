import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import {
  MessagePriority,
  type ProcessBeatmapAttributesMessage,
} from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
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

class FakePublisher {
  readonly published: Array<{ beatmapId: number; priority?: number }> = [];
  countCalls = 0;

  constructor(private readonly queued = 0) {}

  async messageCount() {
    this.countCalls += 1;
    return this.queued;
  }

  async publish(
    payload: { beatmapId: number; checksum?: string },
    options?: { metadata?: { priority?: MessagePriority } }
  ) {
    this.published.push({
      beatmapId: payload.beatmapId,
      priority: options?.metadata?.priority,
    });
    return payload as unknown as ProcessBeatmapAttributesMessage;
  }
}

const unusedDb = new Proxy(
  {},
  {
    get() {
      throw new Error('The sweep should not have queried the database');
    },
  }
) as DatabaseClient;

describe('BeatmapAttributesScheduler guards', () => {
  const sweep = (
    publisher: FakePublisher,
    options: { now: Date; maintenanceWindowEnabled?: boolean }
  ) =>
    new BeatmapAttributesScheduler({
      db: unusedDb,
      logger: silentLogger,
      publisher,
      maintenanceWindowEnabled: options.maintenanceWindowEnabled ?? true,
      now: () => options.now,
    }).sweep();

  it('skips inside the maintenance window', async () => {
    const publisher = new FakePublisher();

    expect(await sweep(publisher, { now: MAINTENANCE })).toMatchObject({
      skipped: 'maintenance',
    });
    expect(publisher.countCalls).toBe(0);
  });

  it('skips while the queue still holds messages', async () => {
    const publisher = new FakePublisher(1);

    expect(
      await sweep(publisher, {
        now: MAINTENANCE,
        maintenanceWindowEnabled: false,
      })
    ).toMatchObject({ skipped: 'queue_not_empty' });
    expect(await sweep(publisher, { now: OUTSIDE_MAINTENANCE })).toMatchObject({
      skipped: 'queue_not_empty',
    });
    expect(publisher.published).toEqual([]);
  });

  it('looks for beatmaps needing attributes again only an hour after finding none', async () => {
    // Each query answers with the next list of beatmap ids.
    const answers = [[1], [], [], [], [], [], []];
    let queries = 0;
    const db = {
      execute: async () => {
        queries += 1;
        return {
          rows: (answers.shift() ?? []).map((id) => ({ beatmap_id: id })),
        };
      },
    } as unknown as DatabaseClient;
    let now = OUTSIDE_MAINTENANCE.getTime();
    const scheduler = new BeatmapAttributesScheduler({
      db,
      logger: silentLogger,
      publisher: new FakePublisher(),
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

  afterAll(async () => {
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

  it('queues up to a batch at low priority, attributes first', async () => {
    const needingAttributes = await findBeatmapsNeedingAttributes(
      db,
      SWEEP_BATCH_SIZE
    );
    const missingFiles = await findBeatmapsMissingFiles(
      db,
      SWEEP_BATCH_SIZE - needingAttributes.length
    );
    const publisher = new FakePublisher();

    const result = await new BeatmapAttributesScheduler({
      db,
      logger: silentLogger,
      publisher,
      maintenanceWindowEnabled: true,
      now: () => OUTSIDE_MAINTENANCE,
    }).sweep();

    expect(result).toEqual({
      needingAttributes: needingAttributes.length,
      missingFiles: missingFiles.length,
    });
    expect(publisher.published.map((job) => job.beatmapId)).toEqual([
      ...needingAttributes,
      ...missingFiles,
    ]);
    expect(publisher.published.length).toBeLessThanOrEqual(SWEEP_BATCH_SIZE);
    expect(
      publisher.published.every((job) => job.priority === MessagePriority.Low)
    ).toBe(true);
  });
});
