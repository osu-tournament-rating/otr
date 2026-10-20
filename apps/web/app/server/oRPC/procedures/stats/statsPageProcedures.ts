import type { z } from 'zod';

import {
  PlatformStatKey,
  readPlatformStats,
  type StoredPlatformStat,
} from '@otr/core/platform-stats';
import type { DatabaseClient } from '@/lib/db';
import {
  HeadlineTotalsSchema,
  StatsPageSchema,
  type StatsPage,
} from '@/lib/orpc/schema/statsPage';

import { publicProcedure } from '../base';

/**
 * A stored statistic's payload, or null when it is missing or has another
 * shape than this release expects, which the page shows as not calculated.
 * `ruleset` is null for a statistic over every ruleset.
 */
function storedPayload<T>(
  stored: readonly StoredPlatformStat[],
  key: PlatformStatKey,
  ruleset: number | null,
  schema: z.ZodType<T>
): T | null {
  const entry = stored.find(
    (stat) => stat.key === key && stat.ruleset === ruleset
  );
  if (!entry) return null;

  const parsed = schema.safeParse(entry.payload);
  if (!parsed.success) {
    console.error('[orpc] stored platform stat has an unexpected shape', {
      key,
      ruleset,
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data;
}

export async function runStatsPage({
  context,
}: {
  context: { db: DatabaseClient };
}): Promise<StatsPage> {
  const stored = await readPlatformStats(context.db);

  return {
    allRulesets: {
      totals: storedPayload(
        stored,
        PlatformStatKey.HeadlineTotals,
        null,
        HeadlineTotalsSchema
      ),
    },
  };
}

/**
 * The stats page's statistics beyond `stats.platform`, for every ruleset at
 * once. Internal to the site, so these fields stay out of the public API.
 */
export const getStatsPage = publicProcedure
  .output(StatsPageSchema)
  .route({
    summary: 'Get the platform stats page statistics',
    tags: ['stats'],
    method: 'GET',
    path: '/stats/page',
  })
  .handler(({ context }) => runStatsPage({ context }));
