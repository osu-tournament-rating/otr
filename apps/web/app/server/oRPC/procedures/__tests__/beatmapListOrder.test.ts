import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { inArray } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';

import { listBeatmaps } from '../beatmapListProcedures';
import { createTestDb, removePlayers, testDatabaseUrl } from './test-utils';

const CREATOR_OSU_ID = 999_240_001;
const BEATMAP_OSU_ID_BASE = 999_240_100;

// Only the seeded beatmaps have this BPM, so the filter keeps other rows out
const BPM = 987.5;

// In insertion order, so later rows have higher IDs. A null game count means
// no stats row, as for a beatmap no game or pool has touched.
const SEEDS = [
  { diffName: 'played-3a', gameCount: 3 },
  { diffName: 'played-3b', gameCount: 3 },
  { diffName: 'played-5', gameCount: 5 },
  { diffName: 'unplayed-a', gameCount: 0 },
  { diffName: 'no-stats', gameCount: null },
  { diffName: 'unplayed-b', gameCount: 0 },
  // The most played, but outside the BPM filter
  { diffName: 'other-bpm', gameCount: 100, bpm: 600 },
];

describe.skipIf(!testDatabaseUrl)('listBeatmaps default order', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const beatmapOsuIds = SEEDS.map((_, index) => BEATMAP_OSU_ID_BASE + index);

  const remove = async () => {
    // Cascades to stats and creator rows
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, beatmapOsuIds));
    await removePlayers(db, [CREATOR_OSU_ID]);
  };

  beforeAll(async () => {
    await remove();

    const [creator] = await db
      .insert(schema.players)
      .values({ osuId: CREATOR_OSU_ID, username: 'list-order-mapper' })
      .returning({ id: schema.players.id });

    for (const [index, seed] of SEEDS.entries()) {
      const [beatmap] = await db
        .insert(schema.beatmaps)
        .values({
          osuId: beatmapOsuIds[index]!,
          ruleset: Ruleset.Osu,
          rankedStatus: 1,
          diffName: seed.diffName,
          totalLength: 120,
          drainLength: 120,
          bpm: seed.bpm ?? BPM,
          countCircle: 100,
          countSlider: 100,
          countSpinner: 0,
          cs: 4,
          hp: 5,
          od: 8,
          ar: 9,
          sr: 5,
        })
        .returning({ id: schema.beatmaps.id });

      if (seed.gameCount !== null) {
        await db.insert(schema.beatmapStats).values({
          beatmapId: beatmap!.id,
          verifiedGameCount: seed.gameCount,
          verifiedTournamentCount: seed.gameCount > 0 ? 1 : 0,
          hasVerifiedAppearance: seed.gameCount > 0,
        });
      }

      if (seed.diffName === 'played-5') {
        await db.insert(schema.joinBeatmapCreators).values({
          createdBeatmapsId: beatmap!.id,
          creatorsId: creator!.id,
        });
      }
    }
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  const list = (page: number) =>
    call(
      listBeatmaps,
      { page, pageSize: 2, minBpm: BPM - 0.5, maxBpm: BPM + 0.5 },
      { context: { headers: new Headers() } }
    );

  it('lists the most played first, the newest first among equals', async () => {
    const result = await list(1);

    expect(result.items.map((item) => item.diffName)).toEqual([
      'played-5',
      'played-3b',
    ]);
    expect(result.items[0]?.creator).toBe('list-order-mapper');
    expect(result.items[0]?.verifiedGameCount).toBe(5);
    expect(result.totalCount).toBe(6);
  });

  it('lists beatmaps without verified games last, newest first, with or without stats', async () => {
    const pages = await Promise.all([list(2), list(3)]);

    expect(
      pages.map((page) => page.items.map((item) => item.diffName))
    ).toEqual([
      ['played-3a', 'unplayed-b'],
      ['no-stats', 'unplayed-a'],
    ]);
  });
});
