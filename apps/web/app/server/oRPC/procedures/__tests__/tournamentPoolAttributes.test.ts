import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Mods, Ruleset } from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';

import { getTournament } from '../tournamentsProcedures';

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const NAME_PREFIX = 'tournament-pool-attributes-';
const POOLED_OSU_ID = 990_000_401;
const UNPOOLED_OSU_ID = 990_000_402;

const beatmap = (osuId: number) => ({
  osuId,
  ruleset: Ruleset.Osu,
  rankedStatus: 1,
  diffName: `pool-attributes-${osuId}`,
  totalLength: 120,
  drainLength: 120,
  bpm: 180,
  countCircle: 100,
  countSlider: 100,
  countSpinner: 0,
  cs: 4,
  hp: 5,
  od: 8,
  ar: 9,
  sr: 6,
});

const attribute = (beatmapId: number, mods: number, sr: number) => ({
  beatmapId,
  mods,
  sr,
  ar: 10,
  cs: 4,
  od: 9,
  hp: 5,
  calculator: 'test',
});

describe.skipIf(!url)('getTournament pooled beatmap attributes', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  let tournamentId = 0;
  let taikoTournamentId = 0;

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, [POOLED_OSU_ID, UNPOOLED_OSU_ID]));
  };

  beforeAll(async () => {
    await removeSeed();

    const [pooled, unpooled] = await db
      .insert(schema.beatmaps)
      .values([beatmap(POOLED_OSU_ID), beatmap(UNPOOLED_OSU_ID)])
      .returning({ id: schema.beatmaps.id });

    await db
      .insert(schema.beatmapAttributes)
      .values([
        attribute(pooled!.id, Mods.DoubleTime, 8.2),
        attribute(pooled!.id, Mods.None, 6.1),
        attribute(unpooled!.id, Mods.HardRock, 7),
      ]);

    const tournament = (suffix: string, ruleset: Ruleset) => ({
      name: `${NAME_PREFIX}${suffix}`,
      abbreviation: 'TPA',
      forumUrl: 'https://osu.ppy.sh/community/forums/topics/990000401',
      rankRangeLowerBound: 1,
      ruleset,
      lobbySize: 1,
    });
    const [standard, taiko] = await db
      .insert(schema.tournaments)
      .values([
        tournament('pool', Ruleset.Osu),
        tournament('taiko', Ruleset.Taiko),
      ])
      .returning({ id: schema.tournaments.id });
    tournamentId = standard!.id;
    taikoTournamentId = taiko!.id;

    // The taiko tournament pools the same osu! standard map, as a convert.
    await db.insert(schema.joinPooledBeatmaps).values([
      { pooledBeatmapsId: pooled!.id, tournamentsPooledInId: tournamentId },
      {
        pooledBeatmapsId: pooled!.id,
        tournamentsPooledInId: taikoTournamentId,
      },
    ]);
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it("serves each pooled beatmap's own attributes, by mods", async () => {
    const detail = await call(
      getTournament,
      { id: tournamentId },
      { context: { db, headers: new Headers() } }
    );

    expect(detail.pooledBeatmaps).toHaveLength(1);
    expect(
      detail.pooledBeatmaps[0]!.attributes.map(({ mods, sr, ar }) => ({
        mods,
        sr,
        ar,
      }))
    ).toEqual([
      { mods: Mods.None, sr: 6.1, ar: 10 },
      { mods: Mods.DoubleTime, sr: 8.2, ar: 10 },
    ]);
  });

  it("serves no osu! standard attributes in another ruleset's pool", async () => {
    const detail = await call(
      getTournament,
      { id: taikoTournamentId },
      { context: { db, headers: new Headers() } }
    );

    expect(detail.pooledBeatmaps).toHaveLength(1);
    expect(detail.pooledBeatmaps[0]!.attributes).toEqual([]);
  });
});
