import { sql, type SQL } from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';
import { Mods, Ruleset, VerificationStatus } from '@otr/core/osu';
import {
  ATTRIBUTE_MODS_MASK,
  UNSUPPORTED_ATTRIBUTE_MODS,
} from '@otr/core/osu/attribute-mods';

import type { DatabaseClient } from '../db';

// Inlined as literals so postgres types them as integers rather than text
// parameters.
const literal = (value: number) => sql.raw(String(Math.trunc(value)));

/**
 * SQL for attributeModsKey(mods), where mods is game.mods | score.mods. A DB
 * test checks that the two agree.
 */
export const attributeModsKeySql = (mods: SQL): SQL<number | null> =>
  sql`(case when (${mods} & ${literal(UNSUPPORTED_ATTRIBUTE_MODS)}) <> 0 then null else ((${mods} | case when (${mods} & ${literal(Mods.Nightcore)}) <> 0 then ${literal(Mods.DoubleTime)} else ${literal(Mods.None)} end) & ${literal(ATTRIBUTE_MODS_MASK)}) end)`;

/**
 * A select of the (beatmap_id, mods) pairs that need attributes, for the
 * beatmaps `beatmapFilter` keeps. An osu! standard beatmap needs NM plus the
 * key of every score in its verified osu! standard games, whatever the score's
 * own status: a combination counts once a verified game shows it was played.
 * Beatmaps of other rulesets need none. The service and the sweep both use this, so
 * they always agree on what is missing.
 */
export const neededAttributeModsSql = (
  beatmapFilter: (beatmapId: SQL) => SQL
) => {
  const playedKey = attributeModsKeySql(
    sql`(${schema.gameScores.mods} | ${schema.games.mods})`
  );
  const isOsu = (ruleset: SQL) => sql`${ruleset} = ${literal(Ruleset.Osu)}`;

  return sql`select ${schema.beatmaps.id} as beatmap_id, ${literal(Mods.None)} as mods
    from ${schema.beatmaps}
    where ${isOsu(sql`${schema.beatmaps.ruleset}`)}
      and ${beatmapFilter(sql`${schema.beatmaps.id}`)}
    union
    select ${schema.games.beatmapId}, ${playedKey}
    from ${schema.games}
    inner join ${schema.beatmaps} on ${schema.beatmaps.id} = ${schema.games.beatmapId}
    inner join ${schema.gameScores} on ${schema.gameScores.gameId} = ${schema.games.id}
    where ${isOsu(sql`${schema.beatmaps.ruleset}`)}
      and ${isOsu(sql`${schema.games.ruleset}`)}
      and ${schema.games.verificationStatus} = ${literal(VerificationStatus.Verified)}
      and ${beatmapFilter(sql`${schema.games.beatmapId}`)}
      and ${playedKey} is not null`;
};

/** Ascending; empty for a beatmap that is not osu! standard. */
export const loadNeededAttributeMods = async (
  db: Pick<DatabaseClient, 'execute'>,
  beatmapId: number
): Promise<number[]> => {
  const needed = neededAttributeModsSql(
    (candidate) => sql`${candidate} = ${beatmapId}`
  );
  const { rows } = await db.execute<{ mods: number }>(
    sql`select needed.mods from (${needed}) needed order by needed.mods`
  );

  return rows.map((row) => row.mods);
};
