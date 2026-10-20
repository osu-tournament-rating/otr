import { sql, eq, and, or, isNotNull } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { publicProcedure } from './base';
import {
  PlatformStatsSchema,
  rulesetKeys,
  verificationStatusKeys,
  RulesetKey,
  VerificationStatusKey,
} from '@/lib/orpc/schema/stats';
import { CHART_CONSTANTS } from '@/lib/utils/chart';
import { VerificationStatus } from '@otr/core/osu';
import { logger } from '@/lib/logger';

const { BUCKET_SIZE: RATING_BUCKET_SIZE } = CHART_CONSTANTS;

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

const createZeroRecord = <T extends readonly string[]>(
  keys: T
): Record<T[number], number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;

export const getPlatformStats = publicProcedure
  .output(PlatformStatsSchema)
  .route({
    summary: 'Get platform statistics',
    tags: ['public'],
    method: 'GET',
    path: '/stats/platform',
  })
  .handler(async ({ context }) => {
    try {
      const bucketExpression =
        sql<number>`FLOOR(${schema.playerRatings.rating} / ${RATING_BUCKET_SIZE})::int * ${RATING_BUCKET_SIZE}`.as(
          'bucket'
        );

      const ratingBuckets = context.db
        .select({
          ruleset: schema.playerRatings.ruleset,
          bucket: bucketExpression,
        })
        .from(schema.playerRatings)
        .as('rating_buckets');

      const verifiedTournamentFilter = eq(
        schema.tournaments.verificationStatus,
        VerificationStatus.Verified
      );

      const yearExpression = sql<number>`DATE_PART('year', COALESCE(${schema.tournaments.startTime}, ${schema.tournaments.endTime}, ${schema.tournaments.created}))::int`;

      const [
        verificationRows,
        verifiedByYearRows,
        verifiedByRulesetRows,
        verifiedByLobbySizeRows,
        ratingRows,
      ] = await Promise.all([
        context.db
          .select({
            verificationStatus: schema.tournaments.verificationStatus,
            count: sql<number>`COUNT(*)`,
          })
          .from(schema.tournaments)
          .groupBy(schema.tournaments.verificationStatus),
        context.db
          .select({
            year: yearExpression,
            count: sql<number>`COUNT(*)`,
          })
          .from(schema.tournaments)
          .where(
            and(
              verifiedTournamentFilter,
              or(
                isNotNull(schema.tournaments.startTime),
                isNotNull(schema.tournaments.endTime),
                isNotNull(schema.tournaments.created)
              )
            )
          )
          .groupBy(yearExpression),
        context.db
          .select({
            ruleset: schema.tournaments.ruleset,
            count: sql<number>`COUNT(*)`,
          })
          .from(schema.tournaments)
          .where(verifiedTournamentFilter)
          .groupBy(schema.tournaments.ruleset),
        context.db
          .select({
            lobbySize: schema.tournaments.lobbySize,
            count: sql<number>`COUNT(*)`,
          })
          .from(schema.tournaments)
          .where(verifiedTournamentFilter)
          .groupBy(schema.tournaments.lobbySize),
        context.db
          .select({
            ruleset: ratingBuckets.ruleset,
            bucket: ratingBuckets.bucket,
            count: sql<number>`COUNT(*)`,
          })
          .from(ratingBuckets)
          .groupBy(ratingBuckets.ruleset, ratingBuckets.bucket),
      ]);

      const countByVerificationStatus = createZeroRecord(
        verificationStatusKeys
      );
      let totalCount = 0;

      for (const row of verificationRows) {
        if (
          row.verificationStatus === null ||
          row.verificationStatus === undefined
        ) {
          continue;
        }

        const statusKey = `${row.verificationStatus}` as VerificationStatusKey;
        if (!verificationStatusKeys.includes(statusKey)) {
          continue;
        }

        const count = toNumber(row.count);
        countByVerificationStatus[statusKey] = count;
        totalCount += count;
      }

      const verifiedByRuleset = createZeroRecord(rulesetKeys);
      const verifiedByYear: Record<string, number> = {};
      const verifiedByLobbySize: Record<string, number> = {};

      for (const row of verifiedByYearRows) {
        const year = toNumber(row.year);
        if (!Number.isNaN(year)) {
          verifiedByYear[`${year}`] = toNumber(row.count);
        }
      }

      for (const row of verifiedByRulesetRows) {
        const rulesetKey = `${row.ruleset}` as RulesetKey;
        if (rulesetKeys.includes(rulesetKey)) {
          verifiedByRuleset[rulesetKey] = toNumber(row.count);
        }
      }

      for (const row of verifiedByLobbySizeRows) {
        if (row.lobbySize === null || row.lobbySize === undefined) {
          continue;
        }

        const lobbyKey = `${toNumber(row.lobbySize)}`;
        verifiedByLobbySize[lobbyKey] = toNumber(row.count);
      }

      const ratingsByRuleset = Object.fromEntries(
        rulesetKeys.map((ruleset) => [ruleset, {}])
      ) as Record<RulesetKey, Record<string, number>>;

      for (const row of ratingRows) {
        const rulesetKey = `${row.ruleset}` as RulesetKey;
        if (!rulesetKeys.includes(rulesetKey)) {
          continue;
        }

        const bucketKey = `${toNumber(row.bucket)}`;
        const record = ratingsByRuleset[rulesetKey] ?? {};
        record[bucketKey] = toNumber(row.count);
        ratingsByRuleset[rulesetKey] = record;
      }

      const sortedVerifiedByYear = Object.fromEntries(
        Object.entries(verifiedByYear).sort(
          ([yearA], [yearB]) => Number(yearA) - Number(yearB)
        )
      );

      const sortedVerifiedByLobbySize = Object.fromEntries(
        Object.entries(verifiedByLobbySize).sort(
          ([sizeA], [sizeB]) => Number(sizeA) - Number(sizeB)
        )
      );

      return {
        tournamentStats: {
          totalCount,
          countByVerificationStatus,
          verifiedByYear: sortedVerifiedByYear,
          verifiedByRuleset,
          verifiedByLobbySize: sortedVerifiedByLobbySize,
        },
        ratingStats: {
          ratingsByRuleset,
        },
        userStats: {
          sumByDate: {},
        },
      };
    } catch (error) {
      logger.error('Failed to compute platform stats', { error });
      throw error;
    }
  });
