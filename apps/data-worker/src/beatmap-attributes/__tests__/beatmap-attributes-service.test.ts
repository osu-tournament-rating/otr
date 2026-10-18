import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { asc, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Mods, Ruleset, VerificationStatus } from '@otr/core/osu';

import { BeatmapAttributesService } from '../beatmap-attributes-service';
import { CALCULATOR } from '../calculator';
import type { BeatmapFileDownload } from '../downloader';
import {
  beatmapFileKey,
  LocalBeatmapFileStore,
  type BeatmapFileStore,
} from '../file-store';
import {
  AttributeTestSeed,
  createTestDb,
  md5,
  silentLogger,
  syntheticOsuFile,
} from './db-fixtures';

const url = process.env.SEARCH_TEST_DATABASE_URL;

const OLD_CALCULATOR = 'rosu-pp-js@0.0.0';

class CountingStore implements BeatmapFileStore {
  gets = 0;
  puts = 0;

  constructor(private readonly inner: BeatmapFileStore) {}

  get location() {
    return this.inner.location;
  }

  async put(key: string, bytes: Uint8Array) {
    this.puts += 1;
    await this.inner.put(key, bytes);
  }

  async get(key: string) {
    this.gets += 1;
    return this.inner.get(key);
  }
}

class FakeDownloader {
  readonly calls: number[] = [];
  private readonly responses: BeatmapFileDownload[];

  constructor(...responses: BeatmapFileDownload[]) {
    this.responses = responses;
  }

  async download(osuBeatmapId: number) {
    this.calls.push(osuBeatmapId);
    const response = this.responses.shift();

    if (!response) {
      throw new Error(`Unexpected download of ${osuBeatmapId}`);
    }

    return response;
  }
}

const ok = (bytes: Uint8Array): BeatmapFileDownload => ({
  status: 'ok',
  bytes,
  checksum: md5(bytes),
});

const fileA = syntheticOsuFile({ cs: 4 });
const fileB = syntheticOsuFile({ cs: 6 });
const maniaFile = syntheticOsuFile({ mode: 3 });
const taikoFile = syntheticOsuFile({ mode: 1 });

describe.skipIf(!url)('BeatmapAttributesService', () => {
  const { pool, db } = createTestDb(url!);
  const seed = new AttributeTestSeed(db, 1);
  let dir = '';
  let localStore: LocalBeatmapFileStore;

  beforeAll(async () => {
    await seed.removeLeftovers();
    dir = await mkdtemp(join(tmpdir(), 'otr-beatmap-attributes-service-'));
    localStore = new LocalBeatmapFileStore({ dir });
  });

  afterAll(async () => {
    await seed.remove();
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });

  const run = async (
    job: { beatmapId: number; checksum?: string },
    downloader = new FakeDownloader()
  ) => {
    const store = new CountingStore(localStore);
    const service = new BeatmapAttributesService({
      db,
      logger: silentLogger,
      store,
      downloader,
    });

    await service.process(job);
    return { store, downloads: downloader.calls };
  };

  const fileRow = async (beatmapId: number) => {
    const [row] = await db
      .select({
        checksum: schema.beatmapFiles.checksum,
        fetchStatus: schema.beatmapFiles.fetchStatus,
        updated: schema.beatmapFiles.updated,
      })
      .from(schema.beatmapFiles)
      .where(eq(schema.beatmapFiles.beatmapId, beatmapId));
    return row ?? null;
  };

  const attributeRows = (beatmapId: number) =>
    db
      .select({
        mods: schema.beatmapAttributes.mods,
        sr: schema.beatmapAttributes.sr,
        cs: schema.beatmapAttributes.cs,
        calculator: schema.beatmapAttributes.calculator,
        updated: schema.beatmapAttributes.updated,
      })
      .from(schema.beatmapAttributes)
      .where(eq(schema.beatmapAttributes.beatmapId, beatmapId))
      .orderBy(asc(schema.beatmapAttributes.mods));

  const keysOf = async (beatmapId: number) =>
    (await attributeRows(beatmapId)).map((row) => row.mods);

  /** Stores `bytes` as the beatmap's file, as a finished earlier job would. */
  const storeFile = async (
    beatmap: { id: number; osuId: number },
    bytes: Uint8Array,
    fetchStatus: DataFetchStatus = DataFetchStatus.Fetched
  ) => {
    const checksum = md5(bytes);
    await localStore.put(beatmapFileKey(beatmap.osuId, checksum), bytes);
    await db
      .insert(schema.beatmapFiles)
      .values({ beatmapId: beatmap.id, checksum, fetchStatus });
    return checksum;
  };

  const insertRows = async (
    beatmapId: number,
    mods: number[],
    calculator: string
  ) => {
    await db.insert(schema.beatmapAttributes).values(
      mods.map((key) => ({
        beatmapId,
        mods: key,
        sr: -1,
        ar: -1,
        cs: -1,
        od: -1,
        hp: -1,
        calculator,
      }))
    );
  };

  /** An osu! standard beatmap whose verified games need NM, HD, and HDHR. */
  const playedBeatmap = async () => {
    const beatmap = await seed.beatmap();
    await seed.game({
      beatmapId: beatmap.id,
      scores: [Mods.Hidden, Mods.Hidden | Mods.HardRock, Mods.None],
    });
    return beatmap;
  };

  const PLAYED_KEYS = [Mods.None, Mods.Hidden, Mods.Hidden | Mods.HardRock];

  it('downloads, stores, and calculates a beatmap seen for the first time', async () => {
    const beatmap = await playedBeatmap();

    const { store, downloads } = await run(
      { beatmapId: beatmap.id, checksum: md5(fileA) },
      new FakeDownloader(ok(fileA))
    );

    expect(downloads).toEqual([beatmap.osuId]);
    expect(store.puts).toBe(1);
    expect(
      await localStore.get(beatmapFileKey(beatmap.osuId, md5(fileA)))
    ).toEqual(fileA);
    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: md5(fileA),
      fetchStatus: DataFetchStatus.Fetched,
    });

    const rows = await attributeRows(beatmap.id);
    expect(rows.map((row) => row.mods)).toEqual(PLAYED_KEYS);
    expect(rows.every((row) => row.calculator === CALCULATOR)).toBe(true);
    expect(rows.every((row) => row.sr > 0 && row.updated !== null)).toBe(true);
    expect(rows.find((row) => row.mods === Mods.None)?.cs).toBe(4);
  });

  it('does nothing when the file and its rows are current', async () => {
    const beatmap = await playedBeatmap();
    await run({ beatmapId: beatmap.id }, new FakeDownloader(ok(fileA)));
    const before = await attributeRows(beatmap.id);
    const fileBefore = await fileRow(beatmap.id);

    const { store, downloads } = await run({
      beatmapId: beatmap.id,
      checksum: md5(fileA),
    });

    expect(downloads).toEqual([]);
    expect(store.gets).toBe(0);
    expect(await attributeRows(beatmap.id)).toEqual(before);
    expect(await fileRow(beatmap.id)).toEqual(fileBefore);
  });

  it('recalculates rows from another calculator from the stored file', async () => {
    const beatmap = await playedBeatmap();
    await storeFile(beatmap, fileA);
    await insertRows(beatmap.id, PLAYED_KEYS, OLD_CALCULATOR);
    const fileBefore = await fileRow(beatmap.id);

    const { store, downloads } = await run({ beatmapId: beatmap.id });

    expect(downloads).toEqual([]);
    expect(store.gets).toBe(1);
    expect(store.puts).toBe(0);
    expect(await fileRow(beatmap.id)).toEqual(fileBefore);

    const rows = await attributeRows(beatmap.id);
    expect(rows.map((row) => row.mods)).toEqual(PLAYED_KEYS);
    expect(rows.every((row) => row.calculator === CALCULATOR)).toBe(true);
    expect(rows.every((row) => row.sr > 0)).toBe(true);
  });

  it('downloads again and recalculates everything when osu! reports another checksum', async () => {
    const beatmap = await playedBeatmap();
    await run({ beatmapId: beatmap.id }, new FakeDownloader(ok(fileA)));

    const { downloads } = await run(
      { beatmapId: beatmap.id, checksum: md5(fileB) },
      new FakeDownloader(ok(fileB))
    );

    expect(downloads).toEqual([beatmap.osuId]);
    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: md5(fileB),
      fetchStatus: DataFetchStatus.Fetched,
    });
    // The previous file stays readable under its own name.
    expect(
      await localStore.get(beatmapFileKey(beatmap.osuId, md5(fileA)))
    ).toEqual(fileA);

    const rows = await attributeRows(beatmap.id);
    expect(rows.map((row) => row.mods)).toEqual(PLAYED_KEYS);
    expect(rows.find((row) => row.mods === Mods.None)?.cs).toBe(6);
  });

  it('keeps the old file and calculates from it when osu! serves nothing', async () => {
    const beatmap = await playedBeatmap();
    const checksum = await storeFile(beatmap, fileA);
    await insertRows(beatmap.id, PLAYED_KEYS, OLD_CALCULATOR);

    await run(
      { beatmapId: beatmap.id, checksum: md5(fileB) },
      new FakeDownloader({ status: 'not_found' })
    );

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum,
      fetchStatus: DataFetchStatus.Fetched,
    });
    const rows = await attributeRows(beatmap.id);
    expect(rows.map((row) => row.mods)).toEqual(PLAYED_KEYS);
    expect(rows.every((row) => row.calculator === CALCULATOR)).toBe(true);

    // A later calculator change still recalculates from the kept file.
    await db
      .update(schema.beatmapAttributes)
      .set({ calculator: OLD_CALCULATOR })
      .where(eq(schema.beatmapAttributes.beatmapId, beatmap.id));

    const recalculated = await run({ beatmapId: beatmap.id, checksum });

    expect(recalculated.downloads).toEqual([]);
    expect(recalculated.store.gets).toBe(1);
    expect(
      (await attributeRows(beatmap.id)).every(
        (row) => row.calculator === CALCULATOR
      )
    ).toBe(true);
  });

  it('records a beatmap osu! serves nothing for when no file was stored', async () => {
    const beatmap = await playedBeatmap();

    await run(
      { beatmapId: beatmap.id },
      new FakeDownloader({ status: 'not_found' })
    );

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: null,
      fetchStatus: DataFetchStatus.NotFound,
    });
    expect(await keysOf(beatmap.id)).toEqual([]);
  });

  it('records an unusable download as an error', async () => {
    const beatmap = await playedBeatmap();

    await run(
      { beatmapId: beatmap.id },
      new FakeDownloader({
        status: 'invalid',
        reason: 'does not start with "osu file format v"',
      })
    );

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: null,
      fetchStatus: DataFetchStatus.Error,
    });
    expect(await keysOf(beatmap.id)).toEqual([]);
  });

  it('keeps the old file when a new download is unusable', async () => {
    const beatmap = await playedBeatmap();
    const checksum = await storeFile(beatmap, fileA);

    await run(
      { beatmapId: beatmap.id, checksum: md5(fileB) },
      new FakeDownloader({ status: 'invalid', reason: 'larger than 10 MB' })
    );

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum,
      fetchStatus: DataFetchStatus.Fetched,
    });
    expect(await keysOf(beatmap.id)).toEqual(PLAYED_KEYS);
  });

  it('keeps an error for a stored file the calculator rejects when osu! serves nothing', async () => {
    const beatmap = await playedBeatmap();
    const checksum = await storeFile(beatmap, maniaFile, DataFetchStatus.Error);

    await run(
      { beatmapId: beatmap.id, checksum: md5(fileA) },
      new FakeDownloader({ status: 'not_found' })
    );

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum,
      fetchStatus: DataFetchStatus.Error,
    });
    expect(await keysOf(beatmap.id)).toEqual([]);
  });

  it('skips a stored file known to be unusable until osu! reports another checksum', async () => {
    const beatmap = await playedBeatmap();
    const checksum = await storeFile(beatmap, maniaFile, DataFetchStatus.Error);

    const skipped = await run({ beatmapId: beatmap.id, checksum });
    expect(skipped.downloads).toEqual([]);
    expect(skipped.store.gets).toBe(0);
    expect(await keysOf(beatmap.id)).toEqual([]);

    const retried = await run(
      { beatmapId: beatmap.id, checksum: md5(fileA) },
      new FakeDownloader(ok(fileA))
    );
    expect(retried.downloads).toEqual([beatmap.osuId]);
    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: md5(fileA),
      fetchStatus: DataFetchStatus.Fetched,
    });
    expect(await keysOf(beatmap.id)).toEqual(PLAYED_KEYS);
  });

  it('downloads a lost object again', async () => {
    const beatmap = await playedBeatmap();
    const lostChecksum = md5(syntheticOsuFile({ cs: 5 }));
    await db.insert(schema.beatmapFiles).values({
      beatmapId: beatmap.id,
      checksum: lostChecksum,
      fetchStatus: DataFetchStatus.Fetched,
    });

    const { downloads } = await run(
      { beatmapId: beatmap.id },
      new FakeDownloader(ok(fileA))
    );

    expect(downloads).toEqual([beatmap.osuId]);
    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: md5(fileA),
      fetchStatus: DataFetchStatus.Fetched,
    });
    expect(await keysOf(beatmap.id)).toEqual(PLAYED_KEYS);
  });

  it('forgets a lost object that osu! no longer serves, leaving the rows alone', async () => {
    const beatmap = await playedBeatmap();
    await db.insert(schema.beatmapFiles).values({
      beatmapId: beatmap.id,
      checksum: md5(syntheticOsuFile({ cs: 5 })),
      fetchStatus: DataFetchStatus.Fetched,
    });
    await insertRows(beatmap.id, [Mods.None], OLD_CALCULATOR);

    await run(
      { beatmapId: beatmap.id },
      new FakeDownloader({ status: 'not_found' })
    );

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: null,
      fetchStatus: DataFetchStatus.NotFound,
    });
    expect(await attributeRows(beatmap.id)).toMatchObject([
      { mods: Mods.None, calculator: OLD_CALCULATOR },
    ]);
  });

  it('marks a file the calculator rejects as an error and deletes its rows', async () => {
    const beatmap = await playedBeatmap();
    await insertRows(beatmap.id, [Mods.None], OLD_CALCULATOR);

    await run({ beatmapId: beatmap.id }, new FakeDownloader(ok(maniaFile)));

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: md5(maniaFile),
      fetchStatus: DataFetchStatus.Error,
    });
    expect(
      await localStore.get(beatmapFileKey(beatmap.osuId, md5(maniaFile)))
    ).toEqual(maniaFile);
    expect(await keysOf(beatmap.id)).toEqual([]);
  });

  it('stores the file of a beatmap of another ruleset without attributes', async () => {
    const beatmap = await seed.beatmap({ ruleset: Ruleset.Taiko });
    await seed.game({
      beatmapId: beatmap.id,
      ruleset: Ruleset.Taiko,
      scores: [Mods.Hidden],
    });
    await insertRows(beatmap.id, [Mods.None], OLD_CALCULATOR);

    await run({ beatmapId: beatmap.id }, new FakeDownloader(ok(taikoFile)));

    expect(await fileRow(beatmap.id)).toMatchObject({
      checksum: md5(taikoFile),
      fetchStatus: DataFetchStatus.Fetched,
    });
    expect(await keysOf(beatmap.id)).toEqual([]);

    // Nothing left to do afterwards.
    const again = await run({ beatmapId: beatmap.id });
    expect(again.downloads).toEqual([]);
    expect(again.store.gets).toBe(0);
  });

  it('deletes rows for keys no verified game needs any more', async () => {
    const beatmap = await seed.beatmap();
    await seed.game({ beatmapId: beatmap.id, scores: [Mods.Hidden] });
    const rejected = await seed.game({
      beatmapId: beatmap.id,
      scores: [Mods.HardRock],
    });
    await run({ beatmapId: beatmap.id }, new FakeDownloader(ok(fileA)));
    expect(await keysOf(beatmap.id)).toEqual([
      Mods.None,
      Mods.Hidden,
      Mods.HardRock,
    ]);

    await db
      .update(schema.gameScores)
      .set({ verificationStatus: VerificationStatus.Rejected })
      .where(eq(schema.gameScores.gameId, rejected));
    await db
      .update(schema.games)
      .set({ verificationStatus: VerificationStatus.Rejected })
      .where(eq(schema.games.id, rejected));

    const { downloads } = await run({ beatmapId: beatmap.id });

    expect(downloads).toEqual([]);
    expect(await keysOf(beatmap.id)).toEqual([Mods.None, Mods.Hidden]);
  });

  it('calculates no key for plays with HT, FL, TD, RX, or AP', async () => {
    const beatmap = await seed.beatmap();
    await seed.game({
      beatmapId: beatmap.id,
      scores: [
        Mods.HalfTime,
        Mods.Flashlight | Mods.Hidden,
        Mods.TouchDevice | Mods.HardRock,
        Mods.Relax | Mods.Easy,
        Mods.Relax2 | Mods.Hidden,
        Mods.Nightcore,
      ],
    });

    await run({ beatmapId: beatmap.id }, new FakeDownloader(ok(fileA)));

    expect(await keysOf(beatmap.id)).toEqual([Mods.None, Mods.DoubleTime]);
  });

  it('ignores a beatmap that no longer exists', async () => {
    const { downloads } = await run({ beatmapId: -1 });

    expect(downloads).toEqual([]);
  });
});
