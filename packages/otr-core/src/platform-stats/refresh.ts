import { sql } from 'drizzle-orm';

import * as schema from '../db/schema';
import type { Ruleset } from '../osu/enums';
import { PLATFORM_STATS } from './registry';
import {
  PLATFORM_STATS_RULESETS,
  queryRows,
  type PlatformStatDefinition,
  type PlatformStatKey,
  type PlatformStatsDb,
} from './types';

const toDate = (value: unknown): Date | null =>
  value === null || value === undefined
    ? null
    : new Date(value as string | Date);

const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** The rulesets a definition stores a row for; null is every ruleset. */
const rulesetsOf = (
  definition: PlatformStatDefinition
): readonly (Ruleset | null)[] =>
  definition.scope === 'all' ? [null] : PLATFORM_STATS_RULESETS;

/**
 * When the latest rating run started. The processor rewrites every
 * player_ratings row in one transaction and leaves `created` to its default,
 * the transaction's start. Null before the first run.
 */
export const lastRatingRunAt = async (
  db: PlatformStatsDb
): Promise<Date | null> => {
  const rows = await queryRows<{ at: unknown }>(
    db,
    sql`select max(${schema.playerRatings.created}) as at from ${schema.playerRatings}`
  );
  return toDate(rows[0]?.at);
};

/**
 * The statistics to compute again: those with a row missing or of another
 * version, and those last computed before the current UTC day began or
 * before the latest rating run started.
 */
export const findDuePlatformStats = async (
  db: PlatformStatsDb,
  now: Date
): Promise<PlatformStatDefinition[]> => {
  const rows = await queryRows<{
    name: string;
    ruleset: number | null;
    version: number;
    computed_at: unknown;
  }>(
    db,
    sql`select name, ruleset, version, computed_at from ${schema.platformStats}`
  );
  const ratingRun = await lastRatingRunAt(db);

  const dayStart = startOfUtcDay(now).getTime();
  const stored = new Map(
    rows.map((row) => [
      `${row.name}:${row.ruleset}`,
      { version: row.version, computedAt: toDate(row.computed_at) },
    ])
  );

  return PLATFORM_STATS.filter((definition) =>
    rulesetsOf(definition).some((ruleset) => {
      const row = stored.get(`${definition.key}:${ruleset}`);
      if (!row?.computedAt || row.version !== definition.version) {
        return true;
      }

      const computedAt = row.computedAt.getTime();
      return (
        computedAt < dayStart ||
        (ratingRun !== null && computedAt < ratingRun.getTime())
      );
    })
  );
};

const computeRows = async (
  db: PlatformStatsDb,
  definition: PlatformStatDefinition
): Promise<{ ruleset: Ruleset | null; payload: unknown }[]> => {
  if (definition.scope === 'all') {
    return [{ ruleset: null, payload: await definition.compute(db) }];
  }

  const byRuleset = await definition.compute(db);
  return PLATFORM_STATS_RULESETS.map((ruleset) => ({
    ruleset,
    payload: byRuleset[ruleset],
  }));
};

/** Replaces one definition's rows, and drops its rows for other rulesets. */
const saveRows = async (
  db: PlatformStatsDb,
  definition: PlatformStatDefinition,
  rows: { ruleset: Ruleset | null; payload: unknown }[],
  computedAt: Date
) => {
  const values = rows.map(
    (row) =>
      sql`(${definition.key}, ${row.ruleset}::integer, ${JSON.stringify(row.payload)}::jsonb, ${definition.version}, ${computedAt.toISOString()}::timestamptz)`
  );

  await db.execute(sql`
    insert into ${schema.platformStats} (name, ruleset, payload, version, computed_at)
    values ${sql.join(values, sql`, `)}
    on conflict on constraint uq_platform_stats_name_ruleset do update set
      payload = excluded.payload,
      version = excluded.version,
      computed_at = excluded.computed_at`);

  const kept = rulesetsOf(definition).filter((ruleset) => ruleset !== null);
  await db.execute(sql`
    delete from ${schema.platformStats}
    where name = ${definition.key}
      and ${
        kept.length === 0
          ? sql`ruleset is not null`
          : sql`(ruleset is null or ruleset not in (${sql.join(
              kept.map((ruleset) => sql`${ruleset}`),
              sql`, `
            )}))`
      }`);
};

export interface PlatformStatsRefresh {
  refreshed: PlatformStatKey[];
  failed: { key: PlatformStatKey; error: unknown }[];
}

/**
 * Computes the statistics that are due (every one with `all`) and saves
 * each as soon as it is done, stamped with `now`, the time the refresh
 * started. One failure doesn't stop the others; the caller retries the
 * failed ones, which are still due. Rows of keys no definition uses are
 * deleted.
 *
 * Each statistic runs as its own statements outside a transaction, so a
 * query that waits on the rating run's locks reads what the run committed.
 */
export const refreshPlatformStats = async (
  db: PlatformStatsDb,
  { now, all = false }: { now: Date; all?: boolean }
): Promise<PlatformStatsRefresh> => {
  const due = all ? [...PLATFORM_STATS] : await findDuePlatformStats(db, now);
  const result: PlatformStatsRefresh = { refreshed: [], failed: [] };

  for (const definition of due) {
    try {
      const rows = await computeRows(db, definition);
      await saveRows(db, definition, rows, now);
      result.refreshed.push(definition.key);
    } catch (error) {
      result.failed.push({ key: definition.key, error });
    }
  }

  await db.execute(sql`
    delete from ${schema.platformStats}
    where name <> all(${sql.param(
      PLATFORM_STATS.map((definition) => definition.key)
    )}::varchar[])`);

  return result;
};
