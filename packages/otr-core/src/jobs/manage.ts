import { sql, type SQL } from 'drizzle-orm';

import { recordCountSql } from './daily-stats';
import { JobStatus, type JobQueue } from './enums';

interface JobWriter {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Jobs named by id, or every failed job of a queue, optionally for one tournament. */
export type JobSelection =
  { ids: readonly number[] } | { queue: JobQueue; tournamentId?: number };

const uniqueIds = (ids: readonly number[]) => [
  ...new Set(ids.filter((id) => Number.isSafeInteger(id))),
];

// Drizzle expands a JS array into a parameter list, so ids go as one literal.
const idArray = (ids: readonly number[]) => `{${ids.join(',')}}`;

/**
 * Cancels the jobs that are still waiting to run, including those waiting to
 * retry, and adds them to today's cancelled totals. A job a worker has
 * already claimed, or that has finished, is left alone. Pass a transaction,
 * so the jobs and their count commit together.
 */
export async function cancelJobs(
  tx: JobWriter,
  ids: readonly number[]
): Promise<{ cancelled: number }> {
  const named = uniqueIds(ids);
  if (named.length === 0) {
    return { cancelled: 0 };
  }

  const { rows } = await tx.execute(sql`
    UPDATE jobs SET
      status = ${JobStatus.Cancelled},
      finished = now(),
      updated = now()
    WHERE id = ANY(${idArray(named)}::bigint[])
      AND status = ${JobStatus.Pending}
    RETURNING queue`);

  const counts = new Map<string, number>();
  for (const row of rows) {
    const queue = String(row.queue);
    counts.set(queue, (counts.get(queue) ?? 0) + 1);
  }

  for (const [queue, count] of counts) {
    await tx.execute(recordCountSql(queue, 'cancelled', count));
  }

  return { cancelled: rows.length };
}

/**
 * Puts failed jobs back in the queue to run now with all their attempts.
 * Jobs named by id may also be cancelled ones; a queue's selection takes its
 * failed jobs only. A job whose work another waiting or running job already
 * does is skipped, and of several selected jobs for the same work only the
 * newest runs again, so the work is never queued twice.
 */
export async function retryJobs(
  db: JobWriter,
  selection: JobSelection
): Promise<{ retried: number; skipped: number }> {
  let named: number[] | null = null;
  let selected: SQL;

  if ('ids' in selection) {
    named = uniqueIds(selection.ids);
    if (named.length === 0) {
      return { retried: 0, skipped: 0 };
    }
    selected = sql`id = ANY(${idArray(named)}::bigint[])
      AND status IN (${JobStatus.Failed}, ${JobStatus.Cancelled})`;
  } else {
    selected = sql`queue = ${selection.queue}
      AND status = ${JobStatus.Failed}
      ${selection.tournamentId === undefined ? sql`` : sql`AND tournament_id = ${selection.tournamentId}`}`;
  }

  const { rows } = await db.execute(sql`
    WITH candidates AS (
      SELECT id, queue, dedup_key FROM jobs WHERE ${selected}
    ),
    picked AS (
      SELECT DISTINCT ON (c.queue, COALESCE(c.dedup_key, c.id::text)) c.id
      FROM candidates c
      WHERE c.dedup_key IS NULL OR NOT EXISTS (
        SELECT 1 FROM jobs active
        WHERE active.queue = c.queue
          AND active.dedup_key = c.dedup_key
          AND active.status IN (${JobStatus.Pending}, ${JobStatus.Running})
      )
      ORDER BY c.queue, COALESCE(c.dedup_key, c.id::text), c.id DESC
    ),
    retried AS (
      UPDATE jobs SET
        status = ${JobStatus.Pending},
        attempts = 0,
        run_after = now(),
        rerun_requested = false,
        locked_by = NULL,
        locked_until = NULL,
        finished = NULL,
        updated = now()
      FROM picked
      WHERE jobs.id = picked.id
        AND jobs.status IN (${JobStatus.Failed}, ${JobStatus.Cancelled})
      RETURNING jobs.id
    )
    SELECT
      (SELECT count(*) FROM candidates)::int AS matched,
      (SELECT count(*) FROM retried)::int AS retried`);

  const matched = Number(rows[0]?.matched ?? 0);
  const retried = Number(rows[0]?.retried ?? 0);

  return {
    retried,
    skipped: (named?.length ?? matched) - retried,
  };
}
