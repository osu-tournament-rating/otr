import { ORPCError } from '@orpc/server';
import { sql, type SQL } from 'drizzle-orm';

import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import {
  beatmapFetchKeysSql,
  JobQueue,
  JobStatus,
  matchFetchKeySql,
} from '@otr/core/jobs';
import { hasAdminScope } from '@/lib/auth/roles';
import type { DatabaseClient } from '@/lib/db';
import { TournamentIdInputSchema } from '@/lib/orpc/schema/tournament';
import {
  MAX_PROGRESS_ISSUES,
  TournamentProgressSchema,
  type FetchProgress,
  type JobStageState,
  type ProgressIssue,
  type TournamentProgress,
} from '@/lib/orpc/schema/tournamentProgress';

import { publicProcedure } from '../base';

interface ProgressContext {
  db: DatabaseClient;
  session?: { dbUser?: { scopes?: string[] | null } | null } | null;
}

type Row = Record<string, unknown>;

const UNFINISHED = sql`(${DataFetchStatus.NotFetched}, ${DataFetchStatus.Fetching})`;
const ACTIVE = sql`(${JobStatus.Pending}, ${JobStatus.Running})`;

/** A waiting job that has failed before and waits out its backoff. */
const isRetrying = (row: Row) =>
  Number(row.job_status) === JobStatus.Pending &&
  Number(row.attempts) > 0 &&
  row.last_error !== null;

const toFetchProgress = (rows: Row[]): FetchProgress => {
  const progress: FetchProgress = {
    total: 0,
    inFlight: 0,
    fetched: 0,
    notFound: 0,
    failed: 0,
  };

  for (const row of rows) {
    const count = Number(row.count);
    progress.total += count;
    switch (Number(row.status)) {
      case DataFetchStatus.NotFetched:
      case DataFetchStatus.Fetching:
        progress.inFlight += count;
        break;
      case DataFetchStatus.Fetched:
        progress.fetched += count;
        break;
      case DataFetchStatus.NotFound:
        progress.notFound += count;
        break;
      default:
        progress.failed += count;
    }
  }

  return progress;
};

const toJobStage = (row: Row | undefined, waiting: boolean): JobStageState => {
  if (row) {
    const status = Number(row.job_status);
    if (status === JobStatus.Running) return 'running';
    if (status === JobStatus.Pending) {
      return isRetrying(row) ? 'retrying' : 'queued';
    }
  }
  if (waiting) return 'waiting';
  if (!row) return 'none';

  switch (Number(row.job_status)) {
    case JobStatus.Succeeded:
      return 'done';
    case JobStatus.Failed:
      return 'failed';
    default:
      return 'cancelled';
  }
};

const isActiveStage = (state: JobStageState) =>
  state === 'queued' || state === 'retrying' || state === 'running';

const optionalNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

const optionalText = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

/** The tournament's beatmaps: pooled, or played in one of its games. */
const tournamentBeatmapIds = (tournamentId: number) => sql`
  SELECT pooled_beatmaps_id AS id FROM join_pooled_beatmaps
  WHERE tournaments_pooled_in_id = ${tournamentId}
  UNION
  SELECT g.beatmap_id FROM games g
  JOIN matches m ON m.id = g.match_id
  WHERE m.tournament_id = ${tournamentId} AND g.beatmap_id IS NOT NULL`;

/**
 * Items still waiting to be fetched with no job, items whose job is
 * retrying, and items that gave up with no job queued to fetch them again,
 * with the job that gave up while it is kept; at
 * most MAX_PROGRESS_ISSUES, with the total. `items` gives each item's
 * `entity_id`, `osu_id`, fetch `status`, and `key1` and `key2`, the keys its
 * fetch job can have. The waiting or running job is found through the
 * active-key index, and the failed one only for the items listed.
 */
const fetchIssuesSql = (items: SQL) => sql`
  WITH issues AS (
    SELECT i.entity_id, i.osu_id, i.status, i.key1, i.key2,
      a.id AS job_id, a.status AS job_status, a.attempts, a.max_attempts,
      a.run_after, a.last_error,
      count(*) OVER ()::int AS total
    FROM (${items}) i
    LEFT JOIN LATERAL (
      SELECT id, status, attempts, max_attempts, run_after, last_error
      FROM jobs
      WHERE queue = ${JobQueue.OsuFetch}
        AND status IN ${ACTIVE}
        AND dedup_key IN (i.key1, i.key2)
      ORDER BY id DESC
      LIMIT 1
    ) a ON true
    WHERE (i.status = ${DataFetchStatus.Error} OR i.status IN ${UNFINISHED})
      AND (
        a.id IS NULL
        OR (a.status = ${JobStatus.Pending} AND a.attempts > 0 AND a.last_error IS NOT NULL)
      )
    ORDER BY i.entity_id
    LIMIT ${MAX_PROGRESS_ISSUES}
  )
  SELECT issues.*,
    f.id AS failed_job_id, f.attempts AS failed_attempts,
    f.max_attempts AS failed_max_attempts, f.last_error AS failed_error
  FROM issues
  LEFT JOIN LATERAL (
    SELECT id, attempts, max_attempts, last_error
    FROM jobs
    WHERE issues.status = ${DataFetchStatus.Error}
      AND issues.job_id IS NULL
      AND status = ${JobStatus.Failed}
      AND queue = ${JobQueue.OsuFetch}
      AND dedup_key IN (issues.key1, issues.key2)
    ORDER BY id DESC
    LIMIT 1
  ) f ON true
  ORDER BY issues.entity_id`;

const toFetchIssue = (kind: 'match' | 'beatmap', row: Row): ProgressIssue => {
  const base = {
    kind,
    entityId: Number(row.entity_id),
    osuId: Number(row.osu_id),
  };

  if (row.job_id === null && Number(row.status) === DataFetchStatus.Error) {
    return {
      ...base,
      state: 'failed',
      jobId: optionalNumber(row.failed_job_id),
      attempts: optionalNumber(row.failed_attempts),
      maxAttempts: optionalNumber(row.failed_max_attempts),
      error: optionalText(row.failed_error),
      nextAttempt: null,
    };
  }

  const retrying = row.job_id !== null;
  return {
    ...base,
    state: retrying ? 'retrying' : 'stalled',
    jobId: optionalNumber(row.job_id),
    attempts: optionalNumber(row.attempts),
    maxAttempts: optionalNumber(row.max_attempts),
    error: optionalText(row.last_error),
    nextAttempt: retrying ? optionalText(row.run_after) : null,
  };
};

const toJobIssue = (
  kind: 'checks' | 'stats',
  row: Row | undefined
): ProgressIssue | null => {
  if (!row) return null;

  const retrying = isRetrying(row);
  if (!retrying && Number(row.job_status) !== JobStatus.Failed) return null;

  return {
    kind,
    state: retrying ? 'retrying' : 'failed',
    entityId: null,
    osuId: null,
    jobId: Number(row.id),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    error: optionalText(row.last_error),
    nextAttempt: retrying ? optionalText(row.run_after) : null,
  };
};

async function getIssues(
  db: DatabaseClient,
  tournamentId: number,
  stageJobs: { checks?: Row; stats?: Row }
): Promise<{ issues: ProgressIssue[]; issueCount: number }> {
  const [withChecks, withoutChecks] = beatmapFetchKeysSql(sql`b.osu_id`);

  const [matchRows, beatmapRows] = await Promise.all([
    db.execute<Row>(
      fetchIssuesSql(sql`
        SELECT id AS entity_id, osu_id, data_fetch_status AS status,
          ${matchFetchKeySql(sql`osu_id`, sql`is_lazer`)} AS key1,
          NULL::text AS key2
        FROM matches
        WHERE tournament_id = ${tournamentId}`)
    ),
    db.execute<Row>(
      // A beatmap's issue links by its osu! id, as its page does.
      fetchIssuesSql(sql`
        SELECT b.osu_id AS entity_id, b.osu_id, b.data_fetch_status AS status,
          ${withChecks} AS key1, ${withoutChecks} AS key2
        FROM beatmaps b
        JOIN (${tournamentBeatmapIds(tournamentId)}) t ON t.id = b.id`)
    ),
  ]);

  const jobIssues = [
    toJobIssue('checks', stageJobs.checks),
    toJobIssue('stats', stageJobs.stats),
  ].filter((issue): issue is ProgressIssue => issue !== null);

  const issues = [
    ...jobIssues,
    ...matchRows.rows.map((row) => toFetchIssue('match', row)),
    ...beatmapRows.rows.map((row) => toFetchIssue('beatmap', row)),
  ];

  const totalOf = (rows: Row[]) => Number(rows[0]?.total ?? 0);

  return {
    issues: issues.slice(0, MAX_PROGRESS_ISSUES),
    issueCount:
      jobIssues.length + totalOf(matchRows.rows) + totalOf(beatmapRows.rows),
  };
}

/**
 * How far the tournament's data has come: its matches and beatmaps by fetch
 * status, and its automated checks and stats jobs. Admins also get what
 * needs attention.
 */
export async function getTournamentProgressHandler({
  input,
  context,
}: {
  input: { id: number };
  context: ProgressContext;
}): Promise<TournamentProgress> {
  const { db } = context;
  const tournamentId = input.id;

  const [tournament, matches, beatmaps, stageJobs] = await Promise.all([
    db.execute<Row>(sql`SELECT id FROM tournaments WHERE id = ${tournamentId}`),
    db.execute<Row>(sql`
      SELECT data_fetch_status AS status, count(*)::int AS count
      FROM matches WHERE tournament_id = ${tournamentId}
      GROUP BY data_fetch_status`),
    db.execute<Row>(sql`
      SELECT b.data_fetch_status AS status, count(*)::int AS count
      FROM beatmaps b
      JOIN (${tournamentBeatmapIds(tournamentId)}) t ON t.id = b.id
      GROUP BY b.data_fetch_status`),
    // Each queue's waiting or running job, else its newest.
    db.execute<Row>(sql`
      SELECT DISTINCT ON (queue) id, queue, status AS job_status, attempts,
        max_attempts, run_after, last_error
      FROM jobs
      WHERE tournament_id = ${tournamentId}
        AND queue IN (${JobQueue.TournamentChecks}, ${JobQueue.TournamentStats})
      ORDER BY queue, (status IN ${ACTIVE}) DESC, id DESC`),
  ]);

  if (tournament.rows.length === 0) {
    throw new ORPCError('NOT_FOUND', { message: 'Tournament not found' });
  }

  const matchProgress = toFetchProgress(matches.rows);
  const beatmapProgress = toFetchProgress(beatmaps.rows);
  const jobFor = (queue: JobQueue) =>
    stageJobs.rows.find((row) => row.queue === queue);
  const checksJob = jobFor(JobQueue.TournamentChecks);
  const statsJob = jobFor(JobQueue.TournamentStats);

  // Checks run once every match and beatmap is done fetching.
  const fetching = matchProgress.inFlight > 0 || beatmapProgress.inFlight > 0;
  const checks = toJobStage(checksJob, fetching);
  const stats = toJobStage(statsJob, false);

  const progress: TournamentProgress = {
    inFlight: fetching || isActiveStage(checks) || isActiveStage(stats),
    matches: matchProgress,
    beatmaps: beatmapProgress,
    checks,
    stats,
  };

  if (!hasAdminScope(context.session?.dbUser?.scopes ?? [])) {
    return progress;
  }

  return {
    ...progress,
    ...(await getIssues(db, tournamentId, {
      checks: checksJob,
      stats: statsJob,
    })),
  };
}

export const getTournamentProgress = publicProcedure
  .input(TournamentIdInputSchema)
  .output(TournamentProgressSchema)
  .route({
    summary: 'Fetch and processing progress of a tournament',
    method: 'GET',
    path: '/tournaments/{id}/progress',
  })
  .handler(getTournamentProgressHandler);
