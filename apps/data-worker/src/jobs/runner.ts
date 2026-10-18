import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { sql, type SQL } from 'drizzle-orm';
import { JobStatus, type JobPayload, type JobQueue } from '@otr/core/jobs';
import { traceConsume, withoutTracing } from '@otr/core/tracing';

import type { DatabaseClient } from '../db';
import { consoleLogger, type Logger } from '../logging/logger';
import {
  jobsLoopActive,
  jobsReclaimed,
  queueMessageDuration,
  queueMessagesInFlight,
  queueMessagesProcessed,
} from '../metrics';
import {
  recordAttemptSql,
  recordCountSql,
  type AttemptOutcome,
} from './daily-stats';
import {
  DiscardJobError,
  PermanentJobError,
  RetryableJobError,
} from './errors';
import type { ClaimedJob, JobTransaction, QueueRegistration } from './types';

export const LEASE_MS = 120_000;
const HEARTBEAT_MS = 30_000;
const REAPER_MS = 30_000;
/** Longest wait between claims when no notification arrives. */
export const POLL_MS = 5_000;
// Compose stops a container 10 s after SIGTERM.
const SHUTDOWN_GRACE_MS = 8_000;
const HEALTHY_TICK_MS = 60_000;
const SETTLE_ATTEMPTS = 5;
const MAX_ERROR_LENGTH = 2_000;

/**
 * Waits before attempts 2 to 5, about 2.6 hours in all, so jobs ride out an
 * osu! outage instead of failing within minutes.
 */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000];

/** The wait after failed attempt `attempt` (1-based), give or take 10%. */
export const retryDelayMs = (attempt: number, random = Math.random) => {
  const index = Math.min(Math.max(attempt, 1), RETRY_DELAYS_MS.length) - 1;
  return Math.round(RETRY_DELAYS_MS[index]! * (0.9 + random() * 0.2));
};

type RunnerDb = Pick<DatabaseClient, 'execute' | 'transaction'>;

interface Loop {
  registration: QueueRegistration<JobQueue>;
  running: ClaimedJob | null;
  paused: boolean;
  lastTick: number;
  pendingWake: boolean;
  wake: (() => void) | null;
  done: Promise<void> | null;
}

type Settlement =
  | { kind: 'succeeded' }
  | { kind: 'retried'; delayMs: number; error: string }
  | { kind: 'failed'; error: string }
  | { kind: 'discarded'; error: string };

export interface JobRunnerOptions {
  db: RunnerDb;
  logger?: Logger;
  /** Names this process in locked_by. */
  workerId?: string;
  now?: () => Date;
  pollMs?: number;
  /** How long a loop may go without asking for work before it counts as stuck. */
  healthyTickMs?: number;
}

/** Rolls back a give-up whose job someone else took back first. */
class JobTakenBack extends Error {}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorText = (error: unknown) => {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
};

const toJob = (row: Record<string, unknown>): ClaimedJob => ({
  id: Number(row.id),
  queue: row.queue as JobQueue,
  payload: row.payload as JobPayload<JobQueue>,
  priority: Number(row.priority),
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts),
  correlationId: String(row.correlation_id),
  tournamentId: row.tournament_id === null ? null : Number(row.tournament_id),
  requestedByUserId:
    row.requested_by_user_id === null ? null : Number(row.requested_by_user_id),
  traceContext: (row.trace_context as Record<string, string> | null) ?? null,
  created:
    row.created instanceof Date
      ? row.created.toISOString()
      : String(row.created),
});

// Drizzle expands a JS array into a parameter list, so ids go as one literal.
const idArray = (ids: number[]) => `{${ids.join(',')}}`;

const JOB_COLUMNS = sql`id, queue, payload, priority, attempts, max_attempts,
  correlation_id, tournament_id, requested_by_user_id, trace_context, created`;

/**
 * Runs jobs from the jobs table: one loop per registered queue, each running
 * one job at a time. A claimed job carries a lease the runner renews while the
 * handler runs; a lease nobody renews is taken back and the job runs again.
 */
export class JobRunner {
  private readonly db: RunnerDb;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly pollMs: number;
  private readonly healthyTickMs: number;
  readonly workerId: string;

  private readonly loops = new Map<JobQueue, Loop>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reaping: Promise<void> | null = null;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private stopping = false;

  constructor(options: JobRunnerOptions) {
    this.db = options.db;
    this.logger = options.logger ?? consoleLogger;
    this.now = options.now ?? (() => new Date());
    this.pollMs = options.pollMs ?? POLL_MS;
    this.healthyTickMs = options.healthyTickMs ?? HEALTHY_TICK_MS;
    this.workerId =
      options.workerId ??
      `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  }

  register<Q extends JobQueue>(registration: QueueRegistration<Q>) {
    if (this.started) {
      throw new Error('Register every queue before starting the runner');
    }
    if (this.loops.has(registration.queue)) {
      throw new Error(`Queue ${registration.queue} is already registered`);
    }

    this.loops.set(registration.queue, {
      registration: registration as unknown as QueueRegistration<JobQueue>,
      running: null,
      paused: false,
      lastTick: Date.now(),
      pendingWake: false,
      wake: null,
      done: null,
    });
  }

  get queues(): JobQueue[] {
    return [...this.loops.keys()];
  }

  start() {
    if (this.started) {
      throw new Error('JobRunner.start called more than once');
    }
    this.started = true;

    for (const [queue, loop] of this.loops) {
      for (const status of ['success', 'error', 'parked', 'discarded']) {
        queueMessagesProcessed.labels({ queue, status }).inc(0);
      }
      jobsReclaimed.labels({ queue }).inc(0);
      loop.lastTick = Date.now();
      loop.done = this.runLoop(loop);
    }

    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(),
      HEARTBEAT_MS
    );
    this.reaperTimer = setInterval(() => void this.reap(), REAPER_MS);
    void this.reap();
  }

  /** Stops claiming, waits briefly for running jobs, then releases the rest. */
  async stop() {
    if (!this.started || this.stopping) {
      return;
    }
    this.stopping = true;

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reaperTimer) clearInterval(this.reaperTimer);

    for (const loop of this.loops.values()) {
      loop.wake?.();
    }

    const loopsDone = Promise.all(
      [...this.loops.values()].map((loop) => loop.done)
    );
    await Promise.race([loopsDone, sleep(SHUTDOWN_GRACE_MS)]);

    // Jobs still running go back to the queue without using up an attempt.
    try {
      await withoutTracing(() =>
        this.db.execute(sql`
          UPDATE jobs SET
            status = ${JobStatus.Pending},
            attempts = GREATEST(attempts - 1, 0),
            run_after = now(),
            locked_by = NULL,
            locked_until = NULL,
            updated = now()
          WHERE locked_by = ${this.workerId} AND status = ${JobStatus.Running}`)
      );
    } catch (error) {
      this.logger.error('Failed to release running jobs on shutdown', {
        error,
      });
    }

    for (const queue of this.loops.keys()) {
      jobsLoopActive.labels({ queue }).set(0);
    }
  }

  /** A job became ready on `queue`, so its loop claims now instead of waiting. */
  wake(queue: string) {
    const loop = this.loops.get(queue as JobQueue);
    if (!loop) {
      return;
    }
    if (loop.wake) {
      loop.wake();
    } else {
      loop.pendingWake = true;
    }
  }

  /**
   * Every loop is running a job, paused for the maintenance window, or has
   * asked the database for work within the last minute.
   */
  isHealthy(now = Date.now()) {
    if (!this.started || this.stopping) {
      return false;
    }

    for (const loop of this.loops.values()) {
      if (loop.running || loop.paused) continue;
      if (now - loop.lastTick > this.healthyTickMs) return false;
    }

    return true;
  }

  private async runLoop(loop: Loop) {
    const { queue } = loop.registration;

    while (!this.stopping) {
      const pausedUntil = loop.registration.pausedUntil?.(this.now());
      if (pausedUntil) {
        if (!loop.paused) {
          this.logger.info('Pausing queue for the maintenance window', {
            queue,
            until: pausedUntil.toISOString(),
          });
        }
        loop.paused = true;
        jobsLoopActive.labels({ queue }).set(0);
        await this.waitForWake(
          loop,
          Math.min(
            Math.max(pausedUntil.getTime() - this.now().getTime(), 0),
            this.pollMs
          )
        );
        continue;
      }
      loop.paused = false;
      jobsLoopActive.labels({ queue }).set(1);

      let job: ClaimedJob | null;
      try {
        job = await withoutTracing(() => this.claim(queue));
        loop.lastTick = Date.now();
      } catch (error) {
        this.logger.error('Failed to claim a job', { queue, error });
        await this.waitForWake(loop, this.pollMs);
        continue;
      }

      if (!job) {
        await this.waitForWake(loop, this.pollMs);
        continue;
      }

      loop.running = job;
      try {
        await this.run(loop.registration, job);
      } finally {
        loop.running = null;
        loop.lastTick = Date.now();
      }
    }
  }

  private waitForWake(loop: Loop, ms: number) {
    if (this.stopping) {
      return Promise.resolve();
    }
    if (loop.pendingWake) {
      loop.pendingWake = false;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        loop.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      loop.wake = done;
    });
  }

  private async claim(queue: JobQueue): Promise<ClaimedJob | null> {
    const { rows } = await this.db.execute<Record<string, unknown>>(sql`
      WITH next AS (
        SELECT id FROM jobs
        WHERE queue = ${queue}
          AND status = ${JobStatus.Pending}
          AND run_after <= now()
        ORDER BY priority DESC, run_after, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs AS j SET
        status = ${JobStatus.Running},
        attempts = j.attempts + 1,
        locked_by = ${this.workerId},
        locked_until = now() + ${LEASE_MS}::integer * interval '1 millisecond',
        started = now(),
        updated = now()
      FROM next
      WHERE j.id = next.id
      RETURNING j.id, j.queue, j.payload, j.priority, j.attempts,
        j.max_attempts, j.correlation_id, j.tournament_id,
        j.requested_by_user_id, j.trace_context, j.created`);

    return rows[0] ? toJob(rows[0]) : null;
  }

  private async run(
    registration: QueueRegistration<JobQueue>,
    job: ClaimedJob
  ) {
    const { queue } = registration;
    const logger = this.logger.child({
      queue,
      jobId: job.id,
      attempt: job.attempts,
      correlationId: job.correlationId,
      ...(job.tournamentId !== null ? { tournamentId: job.tournamentId } : {}),
    });

    queueMessagesInFlight.labels({ queue }).inc();
    const startedAt = Date.now();
    let settlement: Settlement;

    try {
      await traceConsume(
        queue,
        job.traceContext ?? undefined,
        () => registration.handler(job),
        {
          'messaging.system': 'otr_jobs',
          'messaging.message.id': String(job.id),
          'otr.job.attempt': job.attempts,
        }
      );
      settlement = { kind: 'succeeded' };
    } catch (error) {
      settlement = this.classify(job, error);
      const log = settlement.kind === 'failed' ? 'error' : 'warn';
      logger[log](`Job ${settlement.kind}`, {
        error,
        ...(settlement.kind === 'retried'
          ? { retryInMs: settlement.delayMs }
          : {}),
      });
    } finally {
      queueMessagesInFlight.labels({ queue }).dec();
    }

    const durationMs = Date.now() - startedAt;
    queueMessageDuration.labels({ queue }).observe(durationMs / 1000);
    queueMessagesProcessed
      .labels({ queue, status: METRIC_STATUS[settlement.kind] })
      .inc();

    await this.settleWithRetries(
      registration,
      job,
      settlement,
      durationMs,
      logger
    );
  }

  private classify(job: ClaimedJob, error: unknown): Settlement {
    const text = errorText(error);

    if (error instanceof DiscardJobError) {
      return { kind: 'discarded', error: text };
    }
    if (error instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
      return { kind: 'failed', error: text };
    }

    const asked = error instanceof RetryableJobError ? (error.delayMs ?? 0) : 0;
    return {
      kind: 'retried',
      delayMs: Math.max(retryDelayMs(job.attempts), asked),
      error: text,
    };
  }

  /**
   * A settle that keeps failing leaves the job running under this worker. It
   * is no longer in flight, so its lease lapses and the reaper takes it back.
   */
  private async settleWithRetries(
    registration: QueueRegistration<JobQueue>,
    job: ClaimedJob,
    settlement: Settlement,
    durationMs: number,
    logger: Logger
  ) {
    for (let attempt = 1; ; attempt++) {
      try {
        const settled = await withoutTracing(() =>
          this.settle(registration, job, settlement, durationMs)
        );
        if (!settled) {
          logger.warn('Lost the lease before settling the job');
        }
        return;
      } catch (error) {
        if (attempt >= SETTLE_ATTEMPTS) {
          logger.error('Failed to settle the job; its lease will lapse', {
            error,
          });
          return;
        }
        await sleep(250 * 2 ** attempt);
      }
    }
  }

  /** Returns false when this worker no longer holds the job. */
  private async settle(
    registration: QueueRegistration<JobQueue>,
    job: ClaimedJob,
    settlement: Settlement,
    durationMs: number
  ): Promise<boolean> {
    const owned = sql`id = ${job.id} AND locked_by = ${this.workerId} AND status = ${JobStatus.Running}`;
    const outcome: AttemptOutcome = settlement.kind;

    if (settlement.kind === 'failed' || settlement.kind === 'discarded') {
      return this.giveUp(registration, job, {
        guard: owned,
        status:
          settlement.kind === 'failed' ? JobStatus.Failed : JobStatus.Cancelled,
        error: settlement.error,
        outcome,
        durationMs,
        runHook: settlement.kind === 'failed',
      });
    }

    return this.db.transaction(async (tx) => {
      const { rowCount } =
        settlement.kind === 'succeeded'
          ? await tx.execute(sql`
              UPDATE jobs SET
                status = CASE WHEN rerun_requested THEN ${JobStatus.Pending}::integer ELSE ${JobStatus.Succeeded}::integer END,
                attempts = CASE WHEN rerun_requested THEN 0 ELSE attempts END,
                run_after = CASE WHEN rerun_requested THEN now() ELSE run_after END,
                finished = CASE WHEN rerun_requested THEN NULL ELSE now() END,
                rerun_requested = false,
                locked_by = NULL,
                locked_until = NULL,
                updated = now()
              WHERE ${owned}`)
          : await tx.execute(sql`
              UPDATE jobs SET
                status = ${JobStatus.Pending},
                attempts = CASE WHEN rerun_requested THEN 0 ELSE attempts END,
                run_after = CASE WHEN rerun_requested THEN now()
                  ELSE now() + ${settlement.delayMs}::integer * interval '1 millisecond' END,
                last_error = ${settlement.error},
                rerun_requested = false,
                locked_by = NULL,
                locked_until = NULL,
                updated = now()
              WHERE ${owned}`);

      if (!rowCount) {
        return false;
      }

      await tx.execute(recordAttemptSql(job.queue, outcome, durationMs));
      return true;
    });
  }

  /**
   * Fails or cancels a job. A job someone asked for again while it ran gets a
   * fresh run instead, and its give-up hook is skipped.
   */
  private async giveUp(
    registration: QueueRegistration<JobQueue>,
    job: ClaimedJob,
    options: {
      guard: SQL;
      status: JobStatus.Failed | JobStatus.Cancelled;
      error: string;
      outcome: AttemptOutcome;
      durationMs: number;
      runHook: boolean;
    }
  ): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ rerun_requested: boolean }>(
          sql`SELECT rerun_requested FROM jobs WHERE ${options.guard}`
        );
        if (!rows[0]) {
          throw new JobTakenBack();
        }
        const rerun = rows[0].rerun_requested;

        if (options.runHook && !rerun) {
          await registration.onGiveUp?.(job, tx as JobTransaction);
        }

        // Matching on the flag read above keeps the hook's writes only when
        // the job really ends the way the hook assumed.
        const { rowCount } = await tx.execute(sql`
          UPDATE jobs SET
            status = CASE WHEN rerun_requested THEN ${JobStatus.Pending}::integer ELSE ${options.status}::integer END,
            attempts = CASE WHEN rerun_requested THEN 0 ELSE attempts END,
            run_after = CASE WHEN rerun_requested THEN now() ELSE run_after END,
            finished = CASE WHEN rerun_requested THEN NULL ELSE now() END,
            last_error = ${options.error},
            rerun_requested = false,
            locked_by = NULL,
            locked_until = NULL,
            updated = now()
          WHERE ${options.guard} AND rerun_requested = ${rerun}`);

        if (!rowCount) {
          throw new JobTakenBack();
        }

        await tx.execute(
          recordAttemptSql(job.queue, options.outcome, options.durationMs)
        );
      });
      return true;
    } catch (error) {
      if (error instanceof JobTakenBack) {
        return false;
      }
      throw error;
    }
  }

  private inFlightIds(): number[] {
    return [...this.loops.values()]
      .map((loop) => loop.running?.id)
      .filter((id): id is number => id !== undefined);
  }

  private async heartbeat() {
    const ids = this.inFlightIds();
    if (ids.length === 0) {
      return;
    }

    try {
      const { rows } = await withoutTracing(() =>
        this.db.execute<{ id: string }>(sql`
          UPDATE jobs
          SET locked_until = now() + ${LEASE_MS}::integer * interval '1 millisecond'
          WHERE id = ANY(${idArray(ids)}::bigint[])
            AND locked_by = ${this.workerId}
            AND status = ${JobStatus.Running}
          RETURNING id`)
      );

      const renewed = new Set(rows.map((row) => Number(row.id)));
      for (const id of ids.filter((id) => !renewed.has(id))) {
        this.logger.warn('Lost the lease on a running job', { jobId: id });
      }
    } catch (error) {
      this.logger.error('Failed to renew job leases', { error });
    }
  }

  /**
   * Takes back leases nobody renewed, including this process's own when a
   * settle failed. Jobs in flight here are never touched.
   */
  private reap() {
    if (this.stopping) {
      return Promise.resolve();
    }
    if (!this.reaping) {
      this.reaping = withoutTracing(() => this.reapOnce())
        .catch((error) => {
          this.logger.error('Failed to take back expired job leases', {
            error,
          });
        })
        .finally(() => {
          this.reaping = null;
        });
    }
    return this.reaping;
  }

  private async reapOnce() {
    const inFlight = this.inFlightIds();
    const expired = sql`status = ${JobStatus.Running}
      AND locked_until < now()
      AND NOT (id = ANY(${idArray(inFlight)}::bigint[]))`;

    const { rows: requeued } = await this.db.execute<{ queue: string }>(sql`
      UPDATE jobs SET
        status = ${JobStatus.Pending},
        run_after = now(),
        last_error = left('Lease expired: ' || COALESCE(locked_by, 'a worker') || ' stopped renewing it', ${MAX_ERROR_LENGTH}),
        rerun_requested = false,
        locked_by = NULL,
        locked_until = NULL,
        updated = now()
      WHERE ${expired} AND attempts < max_attempts
      RETURNING queue`);

    await this.recordReclaimed(requeued.map((row) => row.queue));

    const { rows: exhausted } = await this.db.execute<Record<string, unknown>>(
      sql`SELECT ${JOB_COLUMNS} FROM jobs
        WHERE ${expired} AND attempts >= max_attempts
        ORDER BY id LIMIT 100`
    );

    const gaveUp: string[] = [];
    for (const row of exhausted) {
      const job = toJob(row);
      const registration = this.loops.get(job.queue)?.registration ?? {
        queue: job.queue,
        handler: async () => {},
      };

      try {
        const failed = await this.giveUp(registration, job, {
          guard: sql`id = ${job.id} AND ${expired}`,
          status: JobStatus.Failed,
          error: 'Lease expired after the last attempt',
          outcome: 'failed',
          durationMs: 0,
          runHook: true,
        });
        if (failed) {
          gaveUp.push(job.queue);
          queueMessagesProcessed
            .labels({ queue: job.queue, status: 'parked' })
            .inc();
        }
      } catch (error) {
        this.logger.error('Failed to fail a job whose lease expired', {
          queue: job.queue,
          jobId: job.id,
          error,
        });
      }
    }

    await this.recordReclaimed(gaveUp);
  }

  private async recordReclaimed(queues: string[]) {
    const counts = new Map<string, number>();
    for (const queue of queues) {
      counts.set(queue, (counts.get(queue) ?? 0) + 1);
    }

    for (const [queue, count] of counts) {
      jobsReclaimed.labels({ queue }).inc(count);
      this.logger.warn('Took back expired job leases', { queue, count });
      await this.db.execute(recordCountSql(queue, 'reclaimed', count));
    }
  }
}

const METRIC_STATUS: Record<Settlement['kind'], string> = {
  succeeded: 'success',
  retried: 'error',
  failed: 'parked',
  discarded: 'discarded',
};
