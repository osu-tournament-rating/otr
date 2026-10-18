import type { JobPayload, JobQueue } from '@otr/core/jobs';

import type { DatabaseClient } from '../db';

/** A job this worker holds the lease on. */
export interface ClaimedJob<Q extends JobQueue = JobQueue> {
  id: number;
  queue: Q;
  /** As stored; handlers check the fields they read. */
  payload: JobPayload<Q>;
  priority: number;
  /** Including this one. */
  attempts: number;
  maxAttempts: number;
  correlationId: string;
  tournamentId: number | null;
  requestedByUserId: number | null;
  traceContext: Record<string, string> | null;
  created: string;
}

export type JobTransaction = Parameters<
  Parameters<DatabaseClient['transaction']>[0]
>[0];

/**
 * Resolving marks the job succeeded. Throwing retries it with backoff until
 * its attempts run out; see errors.ts for the exceptions.
 */
export type JobHandler<Q extends JobQueue> = (
  job: ClaimedJob<Q>
) => Promise<void>;

export interface QueueRegistration<Q extends JobQueue> {
  queue: Q;
  handler: JobHandler<Q>;
  /** When this returns a time, the queue claims nothing until then. */
  pausedUntil?: (now: Date) => Date | null;
  /**
   * Runs in the transaction that fails or cancels the job, before the job row
   * is updated, so domain rows are always locked before job rows.
   */
  onGiveUp?: (job: ClaimedJob<Q>, tx: JobTransaction) => Promise<void>;
}
