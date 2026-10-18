import { sql, type SQL } from 'drizzle-orm';

import { JobStatus } from './enums';

interface JobReader {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface JobQueueSummary {
  queue: string;
  /** Pending and due now. */
  ready: number;
  /** Pending until a later time, such as a retry's backoff. */
  delayed: number;
  running: number;
  /** Failed jobs not yet pruned. */
  failed: number;
  /** How long the oldest ready job has waited, or 0. */
  oldestReadySeconds: number;
}

/** Job counts per queue, for metrics and admin pages. Queues with no jobs are absent. */
export async function getJobQueueSummary(
  db: JobReader
): Promise<JobQueueSummary[]> {
  const { rows } = await db.execute(sql`
    SELECT
      queue,
      count(*) FILTER (WHERE status = ${JobStatus.Pending} AND run_after <= now()) AS ready,
      count(*) FILTER (WHERE status = ${JobStatus.Pending} AND run_after > now()) AS delayed,
      count(*) FILTER (WHERE status = ${JobStatus.Running}) AS running,
      count(*) FILTER (WHERE status = ${JobStatus.Failed}) AS failed,
      COALESCE(EXTRACT(EPOCH FROM now() - min(run_after)
        FILTER (WHERE status = ${JobStatus.Pending} AND run_after <= now())), 0) AS oldest_ready_seconds
    FROM jobs
    WHERE status IN (${JobStatus.Pending}, ${JobStatus.Running}, ${JobStatus.Failed})
    GROUP BY queue`);

  return rows.map((row) => ({
    queue: String(row.queue),
    ready: Number(row.ready),
    delayed: Number(row.delayed),
    running: Number(row.running),
    failed: Number(row.failed),
    oldestReadySeconds: Number(row.oldest_ready_seconds),
  }));
}
