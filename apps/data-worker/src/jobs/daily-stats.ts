import { sql, type SQL } from 'drizzle-orm';

export type AttemptOutcome = 'succeeded' | 'retried' | 'failed' | 'discarded';

const UTC_TODAY = sql`(now() AT TIME ZONE 'UTC')::date`;

/** Adds one finished attempt to today's totals for its queue. */
export const recordAttemptSql = (
  queue: string,
  outcome: AttemptOutcome,
  durationMs: number
): SQL => {
  const ms = Math.max(0, Math.round(durationMs));
  const one = (column: AttemptOutcome) => (column === outcome ? 1 : 0);

  return sql`
    INSERT INTO job_stats_daily (
      day, queue, succeeded, retried, failed, discarded,
      total_duration_ms, max_duration_ms
    )
    VALUES (
      ${UTC_TODAY}, ${queue}, ${one('succeeded')}, ${one('retried')},
      ${one('failed')}, ${one('discarded')}, ${ms}, ${ms}
    )
    ON CONFLICT (day, queue) DO UPDATE SET
      succeeded = job_stats_daily.succeeded + EXCLUDED.succeeded,
      retried = job_stats_daily.retried + EXCLUDED.retried,
      failed = job_stats_daily.failed + EXCLUDED.failed,
      discarded = job_stats_daily.discarded + EXCLUDED.discarded,
      total_duration_ms = job_stats_daily.total_duration_ms + EXCLUDED.total_duration_ms,
      max_duration_ms = GREATEST(job_stats_daily.max_duration_ms, EXCLUDED.max_duration_ms)`;
};

/** Adds `count` to one of today's counters that no attempt duration goes with. */
export const recordCountSql = (
  queue: string,
  column: 'reclaimed' | 'cancelled',
  count: number
): SQL => {
  const reclaimed = column === 'reclaimed' ? count : 0;
  const cancelled = column === 'cancelled' ? count : 0;

  return sql`
    INSERT INTO job_stats_daily (day, queue, reclaimed, cancelled)
    VALUES (${UTC_TODAY}, ${queue}, ${reclaimed}, ${cancelled})
    ON CONFLICT (day, queue) DO UPDATE SET
      reclaimed = job_stats_daily.reclaimed + EXCLUDED.reclaimed,
      cancelled = job_stats_daily.cancelled + EXCLUDED.cancelled`;
};

/**
 * Recounts the jobs created on each of the last `days` UTC days. Finished
 * jobs are pruned 14 days after they finish, so every job created in a
 * shorter span is still there to count, and a recount never lowers a total
 * in case some were pruned anyway.
 */
export const recountEnqueuedSql = (days: number): SQL => sql`
  INSERT INTO job_stats_daily (day, queue, enqueued)
  SELECT (created AT TIME ZONE 'UTC')::date, queue, count(*)
  FROM jobs
  WHERE created >= ((${UTC_TODAY} - ${days - 1}::integer)::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1, 2
  ON CONFLICT (day, queue) DO UPDATE SET
    enqueued = GREATEST(job_stats_daily.enqueued, EXCLUDED.enqueued)`;
