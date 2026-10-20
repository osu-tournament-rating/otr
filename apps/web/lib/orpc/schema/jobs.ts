import { JobQueue } from '@otr/core/jobs/enums';
import { z } from 'zod';

/** The most jobs one retry or cancel request names. */
export const MAX_MANAGED_JOBS = 100;

/** Every queue, in the order the admin pages list them. */
export const JOB_QUEUES = [
  JobQueue.OsuFetch,
  JobQueue.OsuTrackFetch,
  JobQueue.TournamentChecks,
  JobQueue.TournamentStats,
  JobQueue.BeatmapAttributes,
] as const satisfies readonly JobQueue[];

export const JobQueueSchema = z.enum(JobQueue);

/**
 * Where a job stands, as the admin pages show and filter it. A waiting job
 * is queued once it is due and delayed until then, as the queue counts have
 * it, so a job waiting out a retry's backoff is delayed.
 */
export const JOB_STATES = [
  'queued',
  'delayed',
  'running',
  'failed',
  'succeeded',
  'cancelled',
] as const;

export const JobStateSchema = z.enum(JOB_STATES);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobQueueSummarySchema = z.object({
  // A string, so a queue this release does not know still shows.
  queue: z.string(),
  ready: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  oldestReadySeconds: z.number().nonnegative(),
});

export type JobQueueSummary = z.infer<typeof JobQueueSummarySchema>;

export const JobListSortSchema = z.enum(['created', 'updated']);
export type JobListSort = z.infer<typeof JobListSortSchema>;

export const JobListInputSchema = z.object({
  queue: z.array(JobQueueSchema).max(JOB_QUEUES.length).default([]),
  state: z.array(JobStateSchema).max(JOB_STATES.length).default([]),
  tournamentId: z.number().int().positive().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
  /** Defaults to `created`. `updated` is the last change, or creation. */
  sort: JobListSortSchema.optional(),
  /** Defaults to true: newest first. */
  descending: z.boolean().optional(),
});

export type JobListInput = z.input<typeof JobListInputSchema>;

export const JobSchema = z.object({
  id: z.number().int().positive(),
  queue: z.string(),
  state: JobStateSchema,
  payload: z.record(z.string(), z.unknown()),
  priority: z.number().int(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  correlationId: z.string(),
  /** Null when the tournament has since been deleted, or for other work. */
  tournament: z
    .object({ id: z.number().int().positive(), name: z.string() })
    .nullable(),
  tournamentId: z.number().int().positive().nullable(),
  /** Who asked for the work; null for system work or a deleted user. */
  requestedBy: z
    .object({
      playerId: z.number().int().positive(),
      username: z.string().nullable(),
    })
    .nullable(),
  created: z.string(),
  updated: z.string().nullable(),
  started: z.string().nullable(),
  finished: z.string().nullable(),
  runAfter: z.string(),
});

export type Job = z.infer<typeof JobSchema>;

export const JobListResponseSchema = z.object({
  jobs: z.array(JobSchema),
  totalCount: z.number().int().nonnegative(),
});

export type JobListResponse = z.infer<typeof JobListResponseSchema>;

const JobIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(MAX_MANAGED_JOBS);

export const JobCancelInputSchema = z.object({ ids: JobIdsSchema });

export const JobRetryInputSchema = z.union([
  z.object({ ids: JobIdsSchema }),
  z.object({
    queue: JobQueueSchema,
    tournamentId: z.number().int().positive().optional(),
  }),
]);

export type JobRetryInput = z.infer<typeof JobRetryInputSchema>;

export const JobRetryResponseSchema = z.object({
  retried: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const JobCancelResponseSchema = z.object({
  cancelled: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

/** Days the daily totals page can show, ending today (UTC). */
export const JOB_TOTALS_DAYS = [30, 90, 365] as const;

export const JobDailyTotalsInputSchema = z.object({
  days: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(30),
  /** Limits the jobs by day to one queue. */
  queue: JobQueueSchema.optional(),
});

export type JobDailyTotalsInput = z.input<typeof JobDailyTotalsInputSchema>;

const count = z.number().int().nonnegative();

const JobOutcomeTotalsSchema = z.object({
  enqueued: count,
  succeeded: count,
  retried: count,
  failed: count,
  discarded: count,
  cancelled: count,
  reclaimed: count,
  /** Run time of the finished attempts. */
  totalDurationMs: count,
  maxDurationMs: count,
});

export type JobOutcomeTotals = z.infer<typeof JobOutcomeTotalsSchema>;

export const JobDailyTotalsSchema = z.object({
  /** The first and last UTC day shown, `YYYY-MM-DD`. */
  from: z.string(),
  to: z.string(),
  /** Days with no row are left out. */
  jobsByDay: z.array(JobOutcomeTotalsSchema.extend({ day: z.string() })),
  jobsByQueue: z.array(JobOutcomeTotalsSchema.extend({ queue: z.string() })),
  /** Days with no row are left out. */
  requestsByDay: z.array(
    z.object({
      day: z.string(),
      service: z.string(),
      endpoint: z.string(),
      count,
    })
  ),
  requestsByEndpoint: z.array(
    z.object({
      service: z.string(),
      endpoint: z.string(),
      status: z.string(),
      count,
      totalDurationMs: count,
      maxDurationMs: count,
    })
  ),
});

export type JobDailyTotals = z.infer<typeof JobDailyTotalsSchema>;
