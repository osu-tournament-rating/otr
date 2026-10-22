import { sql } from 'drizzle-orm';

import * as schema from '../db/schema';
import type { Ruleset } from '../osu/enums';
import { PLATFORM_STATS } from './registry';
import { queryRows, type PlatformStatKey, type PlatformStatsDb } from './types';

export interface StoredPlatformStat {
  key: PlatformStatKey;
  /** Null for a statistic over every ruleset. */
  ruleset: Ruleset | null;
  /** As saved; the reader checks its shape. */
  payload: unknown;
  computedAt: Date;
}

/**
 * Every stored statistic the current definitions can serve, for every
 * ruleset. A row whose version is not its definition's current one, or
 * whose ruleset does not fit the definition's scope, is left out, as if not
 * computed yet.
 */
export const readPlatformStats = async (
  db: PlatformStatsDb
): Promise<StoredPlatformStat[]> => {
  const rows = await queryRows<{
    name: string;
    ruleset: number | null;
    payload: unknown;
    version: number;
    computed_at: unknown;
  }>(
    db,
    sql`select name, ruleset, payload, version, computed_at from ${schema.platformStats}`
  );

  return rows.flatMap((row) => {
    const definition = PLATFORM_STATS.find((item) => item.key === row.name);
    if (!definition || definition.version !== row.version) return [];
    if ((definition.scope === 'all') !== (row.ruleset === null)) return [];

    return [
      {
        key: definition.key,
        ruleset: row.ruleset as Ruleset | null,
        payload: row.payload,
        computedAt: new Date(row.computed_at as string | Date),
      },
    ];
  });
};
