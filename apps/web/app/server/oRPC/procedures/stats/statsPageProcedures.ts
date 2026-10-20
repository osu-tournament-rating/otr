import type { z } from 'zod';

import {
  PlatformStatKey,
  readPlatformStats,
  type StoredPlatformStat,
} from '@otr/core/platform-stats';
import type { DatabaseClient } from '@/lib/db';
import {
  HeadlineTotalsSchema,
  RecentlyVerifiedInputSchema,
  RecentlyVerifiedPageSchema,
  StatsPageSchema,
  type StatsPage,
} from '@/lib/orpc/schema/statsPage';

import { publicProcedure } from '../base';
import {
  getLazerByYear,
  getRecentlyVerified,
  getVerificationSummary,
} from './queries';

/** Recently verified tournaments shown before "Load more". */
export const RECENTLY_VERIFIED_FIRST_PAGE = 5;

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
  const { db } = context;

  const [stored, verification, recentlyVerified, lazerByYear] =
    await Promise.all([
      readPlatformStats(db),
      getVerificationSummary(db),
      getRecentlyVerified(db, { limit: RECENTLY_VERIFIED_FIRST_PAGE }),
      getLazerByYear(db),
    ]);

  return {
    allRulesets: {
      totals: storedPayload(
        stored,
        PlatformStatKey.HeadlineTotals,
        null,
        HeadlineTotalsSchema
      ),
      verification,
      recentlyVerified,
      lazerByYear,
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

/** A further page of recently verified tournaments, for "Load more". */
export const getRecentlyVerifiedTournaments = publicProcedure
  .input(RecentlyVerifiedInputSchema)
  .output(RecentlyVerifiedPageSchema)
  .route({
    summary: 'List recently verified tournaments',
    tags: ['stats'],
    method: 'GET',
    path: '/stats/recently-verified',
  })
  .handler(({ input, context }) =>
    getRecentlyVerified(context.db, {
      limit: input.limit,
      cursor: input.cursor,
    })
  );
