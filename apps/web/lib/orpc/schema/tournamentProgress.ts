import { z } from 'zod';

const count = z.number().int().nonnegative();

/** Matches or beatmaps by fetch status. */
export const FetchProgressSchema = z.object({
  total: count,
  /** Not fetched yet, or being fetched. */
  inFlight: count,
  fetched: count,
  notFound: count,
  /** Gave up after an error. */
  failed: count,
});

export type FetchProgress = z.infer<typeof FetchProgressSchema>;

/**
 * Where the tournament's one automated checks or stats job stands: its
 * waiting or running job, else the latest one that finished. Checks are
 * `waiting` while matches or beatmaps are still being fetched, since they
 * run once every fetch is done; `none` means no job has run lately.
 */
export const JOB_STAGE_STATES = [
  'none',
  'waiting',
  'queued',
  'retrying',
  'running',
  'done',
  'failed',
  'cancelled',
] as const;

export const JobStageStateSchema = z.enum(JOB_STAGE_STATES);
export type JobStageState = z.infer<typeof JobStageStateSchema>;

export const PROGRESS_ISSUE_KINDS = [
  'match',
  'beatmap',
  'checks',
  'stats',
] as const;

/**
 * Something an admin may need to act on: a job waiting to retry after an
 * error, one that gave up, or a match or beatmap still waiting to be
 * fetched with no job queued to fetch it.
 */
export const ProgressIssueSchema = z.object({
  kind: z.enum(PROGRESS_ISSUE_KINDS),
  state: z.enum(['retrying', 'failed', 'stalled']),
  /** o!TR id of the match; the osu! id of a beatmap; null for checks and stats. */
  entityId: z.number().int().positive().nullable(),
  /** osu! id of the match or beatmap. */
  osuId: z.number().int().positive().nullable(),
  jobId: z.number().int().positive().nullable(),
  attempts: count.nullable(),
  maxAttempts: count.nullable(),
  /** The job's latest error, while the job is still kept. */
  error: z.string().nullable(),
  /** When a retrying job runs next. */
  nextAttempt: z.string().nullable(),
});

export type ProgressIssue = z.infer<typeof ProgressIssueSchema>;

/** The most issues listed; `issueCount` counts them all. */
export const MAX_PROGRESS_ISSUES = 50;

export const TournamentProgressSchema = z.object({
  /** Anything is still being fetched or processed. */
  inFlight: z.boolean(),
  matches: FetchProgressSchema,
  beatmaps: FetchProgressSchema,
  checks: JobStageStateSchema,
  stats: JobStageStateSchema,
  /** Admins only. */
  issues: z.array(ProgressIssueSchema).optional(),
  issueCount: count.optional(),
});

export type TournamentProgress = z.infer<typeof TournamentProgressSchema>;
