import { sql, type SQL } from 'drizzle-orm';

import { MessagePriority } from '../messages/values';
import { injectTraceContext, traceEnqueue } from '../tracing/messaging';
import { jobDedupKeys, type JobPayload } from './definitions';
import type { JobQueue } from './enums';

/** A database or a transaction. Queue a job in the transaction that saves the data it needs. */
export interface JobExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface EnqueueJob<Q extends JobQueue> {
  payload: JobPayload<Q>;
  /** Defaults to Normal. */
  priority?: MessagePriority;
  /** Defaults to now. */
  runAfter?: Date;
  /** Defaults to 5. */
  maxAttempts?: number;
  /** Defaults to a new id. */
  correlationId?: string;
  tournamentId?: number | null;
  requestedByUserId?: number | null;
  /**
   * A person asked for this now. Merged into a waiting job, it clears the
   * job's backoff and used attempts; merged into a running job, it makes the
   * job run once more after it finishes. Leave it off for scheduled and
   * automatic work, so a failing job keeps backing off.
   */
  explicit?: boolean;
}

interface Row {
  dedupKey: string | null;
  payload: Record<string, unknown>;
  priority: number;
  runAfter: string | null;
  maxAttempts: number | null;
  correlationId: string | null;
  tournamentId: number | null;
  requestedByUserId: number | null;
  explicit: boolean;
}

// 11 parameters a row stays well under Postgres's 65,535 per statement.
const CHUNK_SIZE = 1000;

const toRow = <Q extends JobQueue>(queue: Q, job: EnqueueJob<Q>): Row => ({
  dedupKey: jobDedupKeys[queue](job.payload),
  payload: job.payload as Record<string, unknown>,
  priority: job.priority ?? MessagePriority.Normal,
  runAfter: job.runAfter?.toISOString() ?? null,
  maxAttempts: job.maxAttempts ?? null,
  correlationId: job.correlationId?.slice(0, 128) ?? null,
  tournamentId: job.tournamentId ?? null,
  requestedByUserId: job.requestedByUserId ?? null,
  explicit: job.explicit ?? false,
});

/**
 * Collapses rows with the same key, because one INSERT ... ON CONFLICT can't
 * touch a row twice, and sorts by key, so two transactions queueing
 * overlapping keys lock them in the same order instead of deadlocking.
 */
const mergeRows = (rows: Row[]): Row[] => {
  const merged = new Map<string, Row>();
  const unkeyed: Row[] = [];

  for (const row of rows) {
    if (row.dedupKey === null) {
      unkeyed.push(row);
      continue;
    }

    const existing = merged.get(row.dedupKey);
    if (!existing) {
      merged.set(row.dedupKey, row);
      continue;
    }

    merged.set(row.dedupKey, {
      ...row,
      payload: { ...existing.payload, ...row.payload },
      priority: Math.max(existing.priority, row.priority),
      runAfter:
        existing.runAfter === null || row.runAfter === null
          ? null
          : existing.runAfter < row.runAfter
            ? existing.runAfter
            : row.runAfter,
      maxAttempts:
        existing.maxAttempts === null || row.maxAttempts === null
          ? (existing.maxAttempts ?? row.maxAttempts)
          : Math.max(existing.maxAttempts, row.maxAttempts),
      explicit: existing.explicit || row.explicit,
    });
  }

  const keyed = [...merged.values()].sort((a, b) =>
    a.dedupKey! < b.dedupKey! ? -1 : a.dedupKey! > b.dedupKey! ? 1 : 0
  );

  return [...keyed, ...unkeyed];
};

/**
 * Splits rows into statements in key order. A statement decides once whether
 * its requests are explicit, so a change of flag starts a new statement
 * rather than regrouping, which would lock keys out of order.
 */
const statementBatches = (rows: Row[]) => {
  const batches: Array<{ explicit: boolean; rows: Row[] }> = [];

  for (const row of rows) {
    const last = batches[batches.length - 1];
    if (
      last &&
      last.explicit === row.explicit &&
      last.rows.length < CHUNK_SIZE
    ) {
      last.rows.push(row);
    } else {
      batches.push({ explicit: row.explicit, rows: [row] });
    }
  }

  return batches;
};

// A merge never lowers priority or attempts and never drops payload fields.
// Only an explicit request moves a waiting job forward or asks a running one
// to run again.
const mergeSet = (explicit: boolean) => sql`
  priority = GREATEST(jobs.priority, EXCLUDED.priority),
  max_attempts = GREATEST(jobs.max_attempts, EXCLUDED.max_attempts),
  payload = jobs.payload || EXCLUDED.payload,
  ${
    explicit
      ? sql`run_after = CASE WHEN jobs.status = 0 THEN LEAST(jobs.run_after, EXCLUDED.run_after) ELSE jobs.run_after END,
  attempts = CASE WHEN jobs.status = 0 THEN 0 ELSE jobs.attempts END,
  rerun_requested = jobs.rerun_requested OR jobs.status = 1,`
      : sql``
  }
  updated = now()`;

const insertChunk = (
  queue: JobQueue,
  rows: Row[],
  explicit: boolean,
  traceContext: string | null
): SQL => {
  const values = rows.map(
    (row) => sql`(
      ${queue}::varchar,
      ${row.dedupKey}::varchar,
      ${JSON.stringify(row.payload)}::jsonb,
      ${row.priority}::integer,
      COALESCE(${row.runAfter}::timestamptz, now()),
      COALESCE(${row.maxAttempts}::integer, 5),
      COALESCE(${row.correlationId}::varchar, gen_random_uuid()::text),
      ${row.tournamentId}::integer,
      ${row.requestedByUserId}::integer,
      ${traceContext}::jsonb
    )`
  );

  return sql`
    INSERT INTO jobs (
      queue, dedup_key, payload, priority, run_after, max_attempts,
      correlation_id, tournament_id, requested_by_user_id, trace_context
    )
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (queue, dedup_key) WHERE status IN (0, 1) AND dedup_key IS NOT NULL
    DO UPDATE SET ${mergeSet(explicit)}`;
};

/**
 * Queues jobs on `queue`. A job whose key matches a pending or running job
 * merges into it instead of adding a row. Pass the transaction that saves the
 * data the jobs need, so both commit or neither does.
 */
export async function enqueueJobs<Q extends JobQueue>(
  db: JobExecutor,
  queue: Q,
  jobs: ReadonlyArray<EnqueueJob<Q>>
): Promise<void> {
  if (jobs.length === 0) {
    return;
  }

  const rows = mergeRows(jobs.map((job) => toRow(queue, job)));

  await traceEnqueue(queue, async () => {
    const carrier = injectTraceContext();
    const traceContext =
      Object.keys(carrier).length > 0 ? JSON.stringify(carrier) : null;

    for (const batch of statementBatches(rows)) {
      await db.execute(
        insertChunk(queue, batch.rows, batch.explicit, traceContext)
      );
    }
  });
}

export const enqueueJob = <Q extends JobQueue>(
  db: JobExecutor,
  queue: Q,
  job: EnqueueJob<Q>
) => enqueueJobs(db, queue, [job]);
