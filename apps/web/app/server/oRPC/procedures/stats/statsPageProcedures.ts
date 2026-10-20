import type { z } from 'zod';

import {
  PlatformStatKey,
  readPlatformStats,
  type StoredPlatformStat,
} from '@otr/core/platform-stats';
import type { DatabaseClient } from '@/lib/db';
import { RATED_RULESETS } from '@/lib/kit/format/ruleset';
import {
  BiggestComebacksSchema,
  BiggestUpsetsSchema,
  ClosestGamesSchema,
  HeadlineTotalsSchema,
  HigherRatedWinsSchema,
  StrongestFieldsSchema,
  RecentlyVerifiedInputSchema,
  RecentlyVerifiedPageSchema,
  StatsPageSchema,
  type StatsPage,
} from '@/lib/orpc/schema/statsPage';

import { publicProcedure } from '../base';
import { bandRankRestrictions, summarizeCountries } from './shape';
import {
  getLazerByYear,
  getPlayersByCountry,
  getRankRestrictionsByYear,
  getRecentlyVerified,
  getVerificationSummary,
} from './queries';

/** Recently verified tournaments shown before "Load more". */
export const RECENTLY_VERIFIED_FIRST_PAGE = 5;

/** The leaderboard's top: "Top 100 by country". */
const TOP_RANK = 100;

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

  const [
    stored,
    verification,
    recentlyVerified,
    lazerByYear,
    countries,
    topCountries,
    rankRestrictions,
  ] = await Promise.all([
    readPlatformStats(db),
    getVerificationSummary(db),
    getRecentlyVerified(db, { limit: RECENTLY_VERIFIED_FIRST_PAGE }),
    getLazerByYear(db),
    getPlayersByCountry(db),
    getPlayersByCountry(db, { topRank: TOP_RANK }),
    getRankRestrictionsByYear(db),
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
    byRuleset: RATED_RULESETS.map((ruleset) => ({
      ruleset,
      playersByCountry: summarizeCountries(
        countries.filter((row) => row.ruleset === ruleset)
      ),
      topPlayersByCountry: summarizeCountries(
        topCountries.filter((row) => row.ruleset === ruleset)
      ),
      rankRestrictionsByYear: bandRankRestrictions(
        rankRestrictions.filter((row) => row.ruleset === ruleset)
      ),
      higherRatedWins: storedPayload(
        stored,
        PlatformStatKey.HigherRatedWins,
        ruleset,
        HigherRatedWinsSchema
      ),
      biggestUpsets: storedPayload(
        stored,
        PlatformStatKey.BiggestUpsets,
        ruleset,
        BiggestUpsetsSchema
      ),
      closestGames: storedPayload(
        stored,
        PlatformStatKey.ClosestGames,
        ruleset,
        ClosestGamesSchema
      ),
      biggestComebacks: storedPayload(
        stored,
        PlatformStatKey.BiggestComebacks,
        ruleset,
        BiggestComebacksSchema
      ),
      strongestFields: storedPayload(
        stored,
        PlatformStatKey.StrongestFields,
        ruleset,
        StrongestFieldsSchema
      ),
    })),
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
