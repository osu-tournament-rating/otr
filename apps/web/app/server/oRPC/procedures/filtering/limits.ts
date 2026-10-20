import { ORPCError } from '@orpc/server';
import { sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import type { ApprovalStatus, Ruleset } from '@otr/core/osu';
import {
  FILTER_REPORTS_PER_DAY,
  type FilterRequest,
} from '@/lib/orpc/schema/filtering';
import type { DatabaseClient } from '@/lib/db';
import { formatTimestamp } from '@/lib/kit/format/date';

type Executor = Pick<DatabaseClient, 'execute'>;

/**
 * Locks the user's row for the rest of the transaction, so two requests from
 * one user can't both pass the daily limit or both spend the same allowance.
 */
export async function lockUser(db: Executor, userId: number): Promise<void> {
  await db.execute(sql`
    SELECT 1 FROM ${schema.users}
    WHERE ${schema.users.id} = ${userId}
    FOR UPDATE`);
}

export interface DailyFilterUsage {
  /** Reports and held requests the user made in the last 24 hours. */
  used: number;
  /** When the oldest of them turns 24 hours old, if the user is at the limit. */
  nextReportAt: string | null;
}

/**
 * The user's filter reports in a rolling 24 hours. A held request counts
 * from when it was made, so the report its approval makes is not counted
 * again.
 */
export async function readDailyFilterUsage(
  db: Executor,
  userId: number
): Promise<DailyFilterUsage> {
  const { rows } = await db.execute<{ frees_at_ms: string | number }>(sql`
    SELECT EXTRACT(EPOCH FROM counted.created + interval '24 hours') * 1000 AS frees_at_ms
    FROM (
      SELECT r.created
      FROM ${schema.filterReports} r
      WHERE r.user_id = ${userId}
        AND r.created > CURRENT_TIMESTAMP - interval '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM ${schema.filterRequests} q WHERE q.filter_report_id = r.id
        )
      UNION ALL
      SELECT q.created
      FROM ${schema.filterRequests} q
      WHERE q.user_id = ${userId}
        AND q.created > CURRENT_TIMESTAMP - interval '24 hours'
    ) counted
    ORDER BY counted.created`);

  const used = rows.length;
  const freeing =
    used >= FILTER_REPORTS_PER_DAY
      ? rows[used - FILTER_REPORTS_PER_DAY]
      : undefined;

  return {
    used,
    nextReportAt: freeing
      ? new Date(Number(freeing.frees_at_ms)).toISOString()
      : null,
  };
}

export const dailyLimitError = (nextReportAt: string | null) =>
  new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message: `You can create ${FILTER_REPORTS_PER_DAY} filter reports a day.${
      nextReportAt
        ? ` Your next one is available at ${formatTimestamp(nextReportAt)}.`
        : ''
    }`,
    data: { code: 'DAILY_LIMIT_REACHED', nextReportAt },
  });

type FilterRequestRow = typeof schema.filterRequests.$inferSelect;

export const toFilterRequest = (row: FilterRequestRow): FilterRequest => ({
  id: row.id,
  status: row.status as ApprovalStatus,
  created: row.created,
  ruleset: row.ruleset as Ruleset,
  minRating: row.minRating,
  maxRating: row.maxRating,
  playerCount: row.osuPlayerIds.length,
  unknownPlayerCount: row.unknownPlayerCount,
  justification: row.justification,
  filterReportId: row.filterReportId,
  reviewedAt: row.reviewedAt,
});
