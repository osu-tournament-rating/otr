import type { SQL } from 'drizzle-orm';

import { Ruleset } from '../osu/enums';

/** A database or a transaction that runs raw SQL. */
export interface PlatformStatsDb {
  execute(query: SQL): PromiseLike<{ rows: Record<string, unknown>[] }>;
}

/** The rows `query` returns, typed by the caller. */
export const queryRows = async <TRow>(
  db: PlatformStatsDb,
  query: SQL
): Promise<TRow[]> => (await db.execute(query)).rows as TRow[];

/**
 * Persisted in platform_stats.name. Never rename one: a new name is a new
 * statistic, and rows under a name no definition uses are deleted.
 */
export enum PlatformStatKey {
  HeadlineTotals = 'headline-totals',
  HigherRatedWins = 'higher-rated-wins',
  BiggestUpsets = 'biggest-upsets',
  ClosestGames = 'closest-games',
  BiggestComebacks = 'biggest-comebacks',
  StrongestFields = 'strongest-fields',
}

/** The rulesets a per-ruleset statistic is computed for: every rated one. */
export const PLATFORM_STATS_RULESETS = [
  Ruleset.Osu,
  Ruleset.Taiko,
  Ruleset.Catch,
  Ruleset.Mania4k,
  Ruleset.Mania7k,
] as const;

export type PlatformStatsRuleset = (typeof PLATFORM_STATS_RULESETS)[number];

interface PlatformStatBase {
  key: PlatformStatKey;
  /**
   * Bump it whenever the payload's shape or meaning changes. Rows of another
   * version are recomputed at once and never served.
   */
  version: number;
}

/** One row over every ruleset, stored with a null ruleset. */
export interface AllRulesetsPlatformStat<T> extends PlatformStatBase {
  scope: 'all';
  compute: (db: PlatformStatsDb) => Promise<T>;
}

/**
 * One row per rated ruleset. `compute` returns every ruleset at once, so a
 * statistic that scans a large table scans it once.
 */
export interface PerRulesetPlatformStat<T> extends PlatformStatBase {
  scope: 'ruleset';
  compute: (db: PlatformStatsDb) => Promise<Record<PlatformStatsRuleset, T>>;
}

export type PlatformStatDefinition<T = unknown> =
  AllRulesetsPlatformStat<T> | PerRulesetPlatformStat<T>;
