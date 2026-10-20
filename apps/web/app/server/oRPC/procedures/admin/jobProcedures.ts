import { ORPCError } from '@orpc/server';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  cancelJobs,
  getJobQueueSummary,
  JobStatus,
  retryJobs,
} from '@otr/core/jobs';
import type { DatabaseClient } from '@/lib/db';
import {
  JOB_QUEUES,
  JobCancelInputSchema,
  JobCancelResponseSchema,
  JobDailyTotalsInputSchema,
  JobDailyTotalsSchema,
  JobListInputSchema,
  JobListResponseSchema,
  JobQueueSummarySchema,
  JobRetryInputSchema,
  JobRetryResponseSchema,
  type JobDailyTotals,
  type JobListResponse,
  type JobQueueSummary,
  type JobRetryInput,
  type JobState,
} from '@/lib/orpc/schema/jobs';
import type { z } from 'zod';

import { adminMutationProcedure, protectedProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';

interface AdminContext {
  db: DatabaseClient;
  session: Parameters<typeof ensureAdminSession>[0];
}

const jobs = schema.jobs;

const isDue = sql`${jobs.runAfter} <= now()`;

/** Each state's rows, matching `stateOf`. */
const STATE_CONDITIONS: Record<JobState, SQL> = {
  queued: sql`${jobs.status} = ${JobStatus.Pending} AND ${isDue}`,
  delayed: sql`${jobs.status} = ${JobStatus.Pending} AND NOT ${isDue}`,
  running: sql`${jobs.status} = ${JobStatus.Running}`,
  failed: sql`${jobs.status} = ${JobStatus.Failed}`,
  succeeded: sql`${jobs.status} = ${JobStatus.Succeeded}`,
  cancelled: sql`${jobs.status} = ${JobStatus.Cancelled}`,
};

const stateOf = (status: number, due: boolean): JobState => {
  switch (status) {
    case JobStatus.Pending:
      return due ? 'queued' : 'delayed';
    case JobStatus.Running:
      return 'running';
    case JobStatus.Succeeded:
      return 'succeeded';
    case JobStatus.Failed:
      return 'failed';
    default:
      return 'cancelled';
  }
};

/** Every known queue, with zeros for those with no jobs, then any others. */
export async function getJobSummaryHandler({
  context,
}: {
  context: AdminContext;
}): Promise<JobQueueSummary[]> {
  ensureAdminSession(context.session);

  const summary = await getJobQueueSummary(context.db);
  const byQueue = new Map(summary.map((row) => [row.queue, row]));
  const known: readonly string[] = JOB_QUEUES;

  return [
    ...JOB_QUEUES.map(
      (queue) =>
        byQueue.get(queue) ?? {
          queue,
          ready: 0,
          delayed: 0,
          running: 0,
          failed: 0,
          oldestReadySeconds: 0,
        }
    ),
    ...summary.filter((row) => !known.includes(row.queue)),
  ];
}

export async function listJobsHandler({
  input,
  context,
}: {
  input: z.input<typeof JobListInputSchema>;
  context: AdminContext;
}): Promise<JobListResponse> {
  ensureAdminSession(context.session);

  const { page, pageSize, queue, state, tournamentId, sort, descending } =
    JobListInputSchema.parse(input);

  const conditions: SQL[] = [];
  if (queue.length > 0) {
    conditions.push(inArray(jobs.queue, queue));
  }
  if (state.length > 0) {
    conditions.push(or(...state.map((value) => STATE_CONDITIONS[value]))!);
  }
  if (tournamentId !== undefined) {
    conditions.push(eq(jobs.tournamentId, tournamentId));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const direction = descending === false ? asc : desc;
  const orderBy =
    sort === 'updated'
      ? [direction(sql`COALESCE(${jobs.updated}, ${jobs.created})`)]
      : [];

  const [rows, [total]] = await Promise.all([
    context.db
      .select({
        id: jobs.id,
        queue: jobs.queue,
        status: jobs.status,
        due: sql<boolean>`${isDue}`,
        payload: jobs.payload,
        priority: jobs.priority,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        lastError: jobs.lastError,
        correlationId: jobs.correlationId,
        tournamentId: jobs.tournamentId,
        tournamentName: schema.tournaments.name,
        requestedByPlayerId: schema.users.playerId,
        requestedByUsername: schema.players.username,
        created: jobs.created,
        updated: jobs.updated,
        started: jobs.started,
        finished: jobs.finished,
        runAfter: jobs.runAfter,
      })
      .from(jobs)
      .leftJoin(
        schema.tournaments,
        eq(schema.tournaments.id, jobs.tournamentId)
      )
      .leftJoin(schema.users, eq(schema.users.id, jobs.requestedByUserId))
      .leftJoin(schema.players, eq(schema.players.id, schema.users.playerId))
      .where(where)
      .orderBy(...orderBy, direction(jobs.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    context.db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(where),
  ]);

  return {
    jobs: rows.map((row) => ({
      id: row.id,
      queue: row.queue,
      state: stateOf(row.status, row.due),
      payload: row.payload,
      priority: row.priority,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      lastError: row.lastError,
      correlationId: row.correlationId,
      tournament:
        row.tournamentId !== null && row.tournamentName !== null
          ? { id: row.tournamentId, name: row.tournamentName }
          : null,
      tournamentId: row.tournamentId,
      requestedBy:
        row.requestedByPlayerId !== null
          ? {
              playerId: row.requestedByPlayerId,
              username: row.requestedByUsername,
            }
          : null,
      created: row.created,
      updated: row.updated,
      started: row.started,
      finished: row.finished,
      runAfter: row.runAfter,
    })),
    totalCount: Number(total?.count ?? 0),
  };
}

const isUniqueViolation = (error: unknown): boolean => {
  for (let current = error; current;) {
    if (typeof current !== 'object') {
      return false;
    }
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (code === '23505') {
      return true;
    }
    current = cause;
  }
  return false;
};

export async function retryJobsHandler({
  input,
  context,
}: {
  input: JobRetryInput;
  context: AdminContext;
}) {
  ensureAdminSession(context.session);

  try {
    return await retryJobs(context.db, input);
  } catch (error) {
    // Someone queued the same work between the check and the update.
    if (isUniqueViolation(error)) {
      throw new ORPCError('CONFLICT', {
        message: 'The same work was queued while retrying. Try again.',
      });
    }
    throw error;
  }
}

export async function cancelJobsHandler({
  input,
  context,
}: {
  input: z.infer<typeof JobCancelInputSchema>;
  context: AdminContext;
}) {
  ensureAdminSession(context.session);

  const { cancelled } = await context.db.transaction((tx) =>
    cancelJobs(tx, input.ids)
  );

  return { cancelled, skipped: new Set(input.ids).size - cancelled };
}

const UTC_TODAY = sql`(now() AT TIME ZONE 'UTC')::date`;

const outcomeSums = sql`
  sum(enqueued)::int AS enqueued,
  sum(succeeded)::int AS succeeded,
  sum(retried)::int AS retried,
  sum(failed)::int AS failed,
  sum(discarded)::int AS discarded,
  sum(cancelled)::int AS cancelled,
  sum(reclaimed)::int AS reclaimed,
  sum(total_duration_ms)::float8 AS total_duration_ms,
  max(max_duration_ms)::int AS max_duration_ms`;

const toOutcomeTotals = (row: Record<string, unknown>) => ({
  enqueued: Number(row.enqueued ?? 0),
  succeeded: Number(row.succeeded ?? 0),
  retried: Number(row.retried ?? 0),
  failed: Number(row.failed ?? 0),
  discarded: Number(row.discarded ?? 0),
  cancelled: Number(row.cancelled ?? 0),
  reclaimed: Number(row.reclaimed ?? 0),
  totalDurationMs: Math.round(Number(row.total_duration_ms ?? 0)),
  maxDurationMs: Number(row.max_duration_ms ?? 0),
});

/** Jobs and osu! requests per UTC day over the last `days` days, today included. */
export async function getJobDailyTotalsHandler({
  input,
  context,
}: {
  input: z.input<typeof JobDailyTotalsInputSchema>;
  context: AdminContext;
}): Promise<JobDailyTotals> {
  ensureAdminSession(context.session);

  const { days, queue } = JobDailyTotalsInputSchema.parse(input);
  const from = sql`(${UTC_TODAY} - ${days - 1}::integer)`;

  const [range, byDay, byQueue, requestsByDay, requestsByEndpoint] =
    await Promise.all([
      context.db.execute<{ from: string; to: string }>(
        sql`SELECT ${from}::text AS from, ${UTC_TODAY}::text AS to`
      ),
      context.db.execute<Record<string, unknown>>(sql`
        SELECT day::text AS day, ${outcomeSums}
        FROM job_stats_daily
        WHERE day >= ${from}
          ${queue === undefined ? sql`` : sql`AND queue = ${queue}`}
        GROUP BY day
        ORDER BY day`),
      context.db.execute<Record<string, unknown>>(sql`
        SELECT queue, ${outcomeSums}
        FROM job_stats_daily
        WHERE day >= ${from}
        GROUP BY queue`),
      context.db.execute<Record<string, unknown>>(sql`
        SELECT day::text AS day, service, endpoint, sum(count)::int AS count
        FROM api_request_stats_daily
        WHERE day >= ${from}
        GROUP BY day, service, endpoint
        ORDER BY day, service, endpoint`),
      context.db.execute<Record<string, unknown>>(sql`
        SELECT service, endpoint, status,
          sum(count)::int AS count,
          sum(total_duration_ms)::float8 AS total_duration_ms,
          max(max_duration_ms)::int AS max_duration_ms
        FROM api_request_stats_daily
        WHERE day >= ${from}
        GROUP BY service, endpoint, status
        ORDER BY service, endpoint, status`),
    ]);

  const known: readonly string[] = JOB_QUEUES;
  const queueOrder = (name: string) =>
    known.includes(name) ? known.indexOf(name) : known.length;

  return {
    from: range.rows[0]!.from,
    to: range.rows[0]!.to,
    jobsByDay: byDay.rows.map((row) => ({
      day: String(row.day),
      ...toOutcomeTotals(row),
    })),
    jobsByQueue: byQueue.rows
      .map((row) => ({ queue: String(row.queue), ...toOutcomeTotals(row) }))
      .sort(
        (a, b) =>
          queueOrder(a.queue) - queueOrder(b.queue) ||
          a.queue.localeCompare(b.queue)
      ),
    requestsByDay: requestsByDay.rows.map((row) => ({
      day: String(row.day),
      service: String(row.service),
      endpoint: String(row.endpoint),
      count: Number(row.count),
    })),
    requestsByEndpoint: requestsByEndpoint.rows.map((row) => ({
      service: String(row.service),
      endpoint: String(row.endpoint),
      status: String(row.status),
      count: Number(row.count),
      totalDurationMs: Math.round(Number(row.total_duration_ms ?? 0)),
      maxDurationMs: Number(row.max_duration_ms ?? 0),
    })),
  };
}

export const getJobSummary = protectedProcedure
  .output(JobQueueSummarySchema.array())
  .route({
    summary: 'Job counts per queue',
    tags: ['admin'],
    method: 'GET',
    path: '/admin/jobs:summary',
  })
  .handler(getJobSummaryHandler);

export const listJobs = protectedProcedure
  .input(JobListInputSchema)
  .output(JobListResponseSchema)
  .route({
    summary: 'List background jobs',
    tags: ['admin'],
    method: 'GET',
    path: '/admin/jobs',
  })
  .handler(listJobsHandler);

export const retryJobsAdmin = adminMutationProcedure
  .input(JobRetryInputSchema)
  .output(JobRetryResponseSchema)
  .route({
    summary: 'Retry failed jobs',
    tags: ['admin'],
    method: 'POST',
    path: '/admin/jobs:retry',
  })
  .handler(retryJobsHandler);

export const cancelJobsAdmin = adminMutationProcedure
  .input(JobCancelInputSchema)
  .output(JobCancelResponseSchema)
  .route({
    summary: 'Cancel jobs that have not started',
    tags: ['admin'],
    method: 'POST',
    path: '/admin/jobs:cancel',
  })
  .handler(cancelJobsHandler);

export const getJobDailyTotals = protectedProcedure
  .input(JobDailyTotalsInputSchema)
  .output(JobDailyTotalsSchema)
  .route({
    summary: 'Daily totals of background jobs and osu! requests',
    tags: ['admin'],
    method: 'GET',
    path: '/admin/jobs:daily',
  })
  .handler(getJobDailyTotalsHandler);
