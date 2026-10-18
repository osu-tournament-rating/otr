import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';

import { Mods, Ruleset, VerificationStatus } from '@otr/core/osu';
import { attributeModsKey } from '@otr/core/osu/attribute-mods';

import { attributeModsKeySql, loadNeededAttributeMods } from '../needed-mods';
import { AttributeTestSeed, createTestDb } from './db-fixtures';

const url = process.env.SEARCH_TEST_DATABASE_URL;

// Every combination of the mods the key looks at, each with mods it drops.
const modsMatrix = () => {
  const relevant = [
    Mods.Easy,
    Mods.Hidden,
    Mods.HardRock,
    Mods.DoubleTime,
    Mods.Nightcore,
    Mods.HalfTime,
    Mods.Flashlight,
    Mods.TouchDevice,
    Mods.Relax,
    Mods.Relax2,
  ];
  const dropped = [
    Mods.None,
    Mods.NoFail,
    Mods.SuddenDeath | Mods.Perfect,
    Mods.SpunOut,
    Mods.Autoplay,
    Mods.ScoreV2,
    Mods.Mirror,
  ];
  const values: number[] = [];

  for (let subset = 0; subset < 1 << relevant.length; subset++) {
    const combined = relevant.reduce(
      (mods, mod, bit) => (subset & (1 << bit) ? mods | mod : mods),
      0
    );

    for (const extra of dropped) {
      values.push(combined | extra);
    }
  }

  return values;
};

describe.skipIf(!url)('attributeModsKeySql', () => {
  const { pool, db } = createTestDb(url!);

  afterAll(async () => {
    await pool.end();
  });

  it('matches attributeModsKey for every mods value', async () => {
    const values = modsMatrix();
    const { rows } = await db.execute<{ mods: number; key: number | null }>(
      sql`select v.mods, ${attributeModsKeySql(sql`v.mods`)} as key
        from unnest(${`{${values.join(',')}}`}::int[]) as v(mods)`
    );

    expect(rows).toHaveLength(values.length);
    expect(
      rows.filter((row) => row.key !== attributeModsKey(row.mods))
    ).toEqual([]);
  });
});

describe.skipIf(!url)('loadNeededAttributeMods', () => {
  const { pool, db } = createTestDb(url!);
  const seed = new AttributeTestSeed(db, 0);

  beforeAll(async () => {
    await seed.removeLeftovers();
  });

  afterAll(async () => {
    await seed.remove();
    await pool.end();
  });

  it('needs NM plus the key of every score in verified osu! standard games', async () => {
    const beatmap = await seed.beatmap();

    await seed.game({
      beatmapId: beatmap.id,
      scores: [
        Mods.None,
        Mods.Hidden | Mods.NoFail,
        Mods.HardRock | Mods.Hidden,
        Mods.Nightcore,
        // No stored row describes these.
        Mods.HalfTime,
        Mods.Flashlight | Mods.Hidden,
        Mods.TouchDevice,
        Mods.Relax | Mods.DoubleTime,
      ],
    });
    // Game mods count for every score in the game.
    await seed.game({
      beatmapId: beatmap.id,
      mods: Mods.Easy,
      scores: [Mods.None, Mods.Hidden],
    });
    // Rejected scores in a verified game count too.
    await seed.game({
      beatmapId: beatmap.id,
      scoreVerificationStatus: VerificationStatus.Rejected,
      scores: [Mods.Easy | Mods.DoubleTime],
    });
    // Unverified, rejected, and converted games add nothing.
    await seed.game({
      beatmapId: beatmap.id,
      verificationStatus: VerificationStatus.PreVerified,
      scores: [Mods.DoubleTime | Mods.HardRock],
    });
    await seed.game({
      beatmapId: beatmap.id,
      verificationStatus: VerificationStatus.Rejected,
      scores: [Mods.DoubleTime | Mods.Hidden],
    });
    await seed.game({
      beatmapId: beatmap.id,
      ruleset: Ruleset.Taiko,
      scores: [Mods.DoubleTime | Mods.Easy],
    });

    expect(await loadNeededAttributeMods(db, beatmap.id)).toEqual([
      Mods.None,
      Mods.Easy,
      Mods.Hidden,
      Mods.Easy | Mods.Hidden,
      Mods.Hidden | Mods.HardRock,
      Mods.DoubleTime,
      Mods.Easy | Mods.DoubleTime,
    ]);
  });

  it('needs NM alone for an osu! standard beatmap without verified games', async () => {
    const beatmap = await seed.beatmap();

    expect(await loadNeededAttributeMods(db, beatmap.id)).toEqual([Mods.None]);
  });

  it('needs nothing for a beatmap of another ruleset', async () => {
    const beatmap = await seed.beatmap({ ruleset: Ruleset.Taiko });

    await seed.game({
      beatmapId: beatmap.id,
      ruleset: Ruleset.Taiko,
      scores: [Mods.Hidden],
    });

    expect(await loadNeededAttributeMods(db, beatmap.id)).toEqual([]);
  });

  it('needs nothing for a beatmap that does not exist', async () => {
    expect(await loadNeededAttributeMods(db, -1)).toEqual([]);
  });
});
