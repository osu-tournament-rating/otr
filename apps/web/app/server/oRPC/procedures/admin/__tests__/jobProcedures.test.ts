import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { ORPCError } from '@orpc/server';
import { like, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { JobQueue, JobStatus } from '@otr/core/jobs';
import { Ruleset } from '@otr/core/osu';

import {
  cancelJobsHandler,
  getJobDailyTotalsHandler,
  getJobSummaryHandler,
  listJobsHandler,
  retryJobsHandler,
} from '../jobProcedures';
import {
  adminSession,
  createTestDb,
  deleteJobs,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
} from '../../__tests__/test-utils';

const NAME_PREFIX = 'admin-jobs-';
const USER_OSU_ID = 991_207_100;

interface SeedJob {
  queue?: JobQueue;
  dedupKey?: string | null;
  status?: JobStatus;
  attempts?: number;
  /** Seconds from now; negative is in the past. */
  runAfter?: number;
  lastError?: string | null;
  tournamentId?: number | null;
}

describe('admin job procedures refuse non-admins', () => {
  const session = { dbUser: { id: 1, scopes: ['user'] } };
  // A query before the admin check fails the test with its own error.
  const db = new Proxy(
    {},
    {
      get(_, property) {
        throw new Error(`db.${String(property)} read before the admin check`);
      },
    }
  ) as never;

  it.each([
    ['queue summary', () => getJobSummaryHandler({ context: { db, session } })],
    ['list', () => listJobsHandler({ input: {}, context: { db, session } })],
    [
      'retry',
      () => retryJobsHandler({ input: { ids: [1] }, context: { db, session } }),
    ],
    [
      'cancel',
      () =>
        cancelJobsHandler({ input: { ids: [1] }, context: { db, session } }),
    ],
    [
      'daily totals',
      () => getJobDailyTotalsHandler({ input: {}, context: { db, session } }),
    ],
  ])('%s', async (_, call) => {
    const error = await call().then(
      () => null,
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe('FORBIDDEN');
  });
});

describe.skipIf(!testDatabaseUrl)('admin job procedures', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let userId = 0;
  let tournamentId = 0;
  let otherTournamentId = 0;

  const context = () => ({ db, session: adminSession(userId) });

  const removeSeed = async () => {
    if (userId) {
      await deleteJobs(db, userId);
    }
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
  };

  const seedTournament = async (name: string) => {
    const [row] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}${name}`,
        abbreviation: 'AJ',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    return row!.id;
  };

  /** Inserts a job the test user asked for, and returns its id. */
  const seedJob = async ({
    queue = JobQueue.OsuFetch,
    dedupKey = null,
    status = JobStatus.Pending,
    attempts = 0,
    runAfter = -60,
    lastError = null,
    tournamentId: jobTournamentId = tournamentId,
  }: SeedJob = {}) => {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO jobs (
        queue, dedup_key, payload, status, attempts, run_after, last_error,
        tournament_id, requested_by_user_id, finished
      )
      VALUES (
        ${queue}, ${dedupKey}, '{}'::jsonb, ${status}, ${attempts},
        now() + ${runAfter}::integer * interval '1 second', ${lastError},
        ${jobTournamentId}, ${userId},
        CASE WHEN ${status}::integer IN (2, 3, 4) THEN now() ELSE NULL END
      )
      RETURNING id`);
    return Number(rows[0]!.id);
  };

  const jobState = async (id: number) => {
    const { rows } = await db.execute<Record<string, unknown>>(sql`
      SELECT status, attempts, run_after <= now() AS due, finished
      FROM jobs WHERE id = ${id}`);
    const row = rows[0]!;
    return {
      status: Number(row.status),
      attempts: Number(row.attempts),
      due: Boolean(row.due),
      finished: row.finished !== null,
    };
  };

  beforeEach(async () => {
    await removeSeed();
    userId ||= await seedAdminUser(db, USER_OSU_ID);
    tournamentId = await seedTournament('main');
    otherTournamentId = await seedTournament('other');
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  describe('cancel', () => {
    it('cancels waiting jobs and leaves claimed and finished ones', async () => {
      const queued = await seedJob();
      const retrying = await seedJob({
        attempts: 2,
        runAfter: 3600,
        lastError: 'osu! returned 502',
      });
      const running = await seedJob({ status: JobStatus.Running });
      const failed = await seedJob({ status: JobStatus.Failed });

      const result = await cancelJobsHandler({
        input: { ids: [queued, retrying, running, failed] },
        context: context(),
      });

      expect(result).toEqual({ cancelled: 2, skipped: 2 });
      expect((await jobState(queued)).status).toBe(JobStatus.Cancelled);
      expect((await jobState(queued)).finished).toBe(true);
      expect((await jobState(retrying)).status).toBe(JobStatus.Cancelled);
      expect((await jobState(running)).status).toBe(JobStatus.Running);
      expect((await jobState(failed)).status).toBe(JobStatus.Failed);
    });

    it("adds the cancelled jobs to today's totals for their queue", async () => {
      await db.execute(sql`DELETE FROM job_stats_daily`);
      const ids = [
        await seedJob({ queue: JobQueue.BeatmapAttributes }),
        await seedJob({ queue: JobQueue.BeatmapAttributes }),
        await seedJob({ queue: JobQueue.OsuTrackFetch }),
      ];

      await cancelJobsHandler({ input: { ids }, context: context() });

      const { rows } = await db.execute<Record<string, unknown>>(sql`
        SELECT queue, cancelled FROM job_stats_daily
        WHERE day = (now() AT TIME ZONE 'UTC')::date
        ORDER BY queue`);
      expect(
        rows.map((row) => [String(row.queue), Number(row.cancelled)])
      ).toEqual([
        [JobQueue.OsuTrackFetch, 1],
        [JobQueue.BeatmapAttributes, 2],
      ]);
    });
  });

  describe('retry', () => {
    it('queues failed and cancelled jobs to run now with all their attempts', async () => {
      const failed = await seedJob({
        status: JobStatus.Failed,
        attempts: 5,
        lastError: 'osu! returned 502',
      });
      const cancelled = await seedJob({ status: JobStatus.Cancelled });
      const succeeded = await seedJob({ status: JobStatus.Succeeded });

      const result = await retryJobsHandler({
        input: { ids: [failed, cancelled, succeeded] },
        context: context(),
      });

      expect(result).toEqual({ retried: 2, skipped: 1 });
      expect(await jobState(failed)).toEqual({
        status: JobStatus.Pending,
        attempts: 0,
        due: true,
        finished: false,
      });
      expect((await jobState(cancelled)).status).toBe(JobStatus.Pending);
      expect((await jobState(succeeded)).status).toBe(JobStatus.Succeeded);
    });

    it('skips a failed job whose work another job is already doing', async () => {
      const failed = await seedJob({
        status: JobStatus.Failed,
        dedupKey: 'match:991207101:stable',
      });
      await seedJob({ dedupKey: 'match:991207101:stable' });

      const result = await retryJobsHandler({
        input: { ids: [failed] },
        context: context(),
      });

      expect(result).toEqual({ retried: 0, skipped: 1 });
      expect((await jobState(failed)).status).toBe(JobStatus.Failed);
    });

    it('retries only the newest of failed jobs for the same work', async () => {
      const older = await seedJob({
        status: JobStatus.Failed,
        dedupKey: 'beatmap:991207102',
      });
      const newer = await seedJob({
        status: JobStatus.Failed,
        dedupKey: 'beatmap:991207102',
      });

      const result = await retryJobsHandler({
        input: { ids: [older, newer] },
        context: context(),
      });

      expect(result).toEqual({ retried: 1, skipped: 1 });
      expect((await jobState(older)).status).toBe(JobStatus.Failed);
      expect((await jobState(newer)).status).toBe(JobStatus.Pending);
    });

    it("retries a queue's failed jobs for one tournament", async () => {
      const target = await seedJob({
        queue: JobQueue.TournamentChecks,
        status: JobStatus.Failed,
      });
      const cancelled = await seedJob({
        queue: JobQueue.TournamentChecks,
        status: JobStatus.Cancelled,
      });
      const otherQueue = await seedJob({
        queue: JobQueue.TournamentStats,
        status: JobStatus.Failed,
      });
      const otherTournament = await seedJob({
        queue: JobQueue.TournamentChecks,
        status: JobStatus.Failed,
        tournamentId: otherTournamentId,
      });

      const result = await retryJobsHandler({
        input: { queue: JobQueue.TournamentChecks, tournamentId },
        context: context(),
      });

      expect(result).toEqual({ retried: 1, skipped: 0 });
      expect((await jobState(target)).status).toBe(JobStatus.Pending);
      expect((await jobState(cancelled)).status).toBe(JobStatus.Cancelled);
      expect((await jobState(otherQueue)).status).toBe(JobStatus.Failed);
      expect((await jobState(otherTournament)).status).toBe(JobStatus.Failed);
    });
  });

  describe('list', () => {
    it('tells due waiting jobs from delayed ones', async () => {
      const queued = await seedJob({ runAfter: -10 });
      const delayed = await seedJob({ runAfter: 3600 });
      await seedJob({ status: JobStatus.Failed });

      const list = (state: ('queued' | 'delayed')[]) =>
        listJobsHandler({
          input: { tournamentId, state },
          context: context(),
        });

      expect((await list(['queued'])).jobs.map((job) => job.id)).toEqual([
        queued,
      ]);
      expect((await list(['delayed'])).jobs.map((job) => job.id)).toEqual([
        delayed,
      ]);
      expect(
        (await list(['queued', 'delayed'])).jobs.map((job) => [
          job.id,
          job.state,
        ])
      ).toEqual([
        [delayed, 'delayed'],
        [queued, 'queued'],
      ]);
    });

    it("filters by queue and tournament and names the job's tournament", async () => {
      const checks = await seedJob({ queue: JobQueue.TournamentChecks });
      await seedJob({ queue: JobQueue.OsuFetch });
      await seedJob({
        queue: JobQueue.TournamentChecks,
        tournamentId: otherTournamentId,
      });

      const result = await listJobsHandler({
        input: { tournamentId, queue: [JobQueue.TournamentChecks] },
        context: context(),
      });

      expect(result.totalCount).toBe(1);
      expect(result.jobs[0]).toMatchObject({
        id: checks,
        queue: JobQueue.TournamentChecks,
        tournament: { id: tournamentId, name: `${NAME_PREFIX}main` },
      });
    });

    it('pages newest first and counts every match', async () => {
      const ids = [await seedJob(), await seedJob(), await seedJob()];

      const page = (number: number) =>
        listJobsHandler({
          input: { tournamentId, page: number, pageSize: 2 },
          context: context(),
        });

      const first = await page(1);
      expect(first.totalCount).toBe(3);
      expect(first.jobs.map((job) => job.id)).toEqual([ids[2], ids[1]]);
      expect((await page(2)).jobs.map((job) => job.id)).toEqual([ids[0]]);
    });
  });

  describe('daily totals', () => {
    beforeEach(async () => {
      await db.execute(sql`DELETE FROM job_stats_daily`);
      await db.execute(sql`DELETE FROM api_request_stats_daily`);
    });

    const day = (daysAgo: number) =>
      sql`(now() AT TIME ZONE 'UTC')::date - ${daysAgo}::integer`;

    const seedJobDay = (
      daysAgo: number,
      queue: JobQueue,
      totals: { succeeded?: number; failed?: number; durationMs?: number }
    ) =>
      db.execute(sql`
        INSERT INTO job_stats_daily (
          day, queue, succeeded, failed, total_duration_ms, max_duration_ms
        )
        VALUES (
          ${day(daysAgo)}, ${queue}, ${totals.succeeded ?? 0},
          ${totals.failed ?? 0}, ${totals.durationMs ?? 0},
          ${totals.durationMs ?? 0}
        )`);

    const seedRequestDay = (
      daysAgo: number,
      endpoint: string,
      status: string,
      count: number
    ) =>
      db.execute(sql`
        INSERT INTO api_request_stats_daily (
          day, service, endpoint, status, count, total_duration_ms, max_duration_ms
        )
        VALUES (${day(daysAgo)}, 'osu', ${endpoint}, ${status}, ${count}, ${count * 100}, 250)`);

    it('covers the last 30 days by default, today included', async () => {
      await seedJobDay(0, JobQueue.OsuFetch, { succeeded: 4 });
      await seedJobDay(29, JobQueue.OsuFetch, { succeeded: 2 });
      await seedJobDay(30, JobQueue.OsuFetch, { succeeded: 9 });

      const totals = await getJobDailyTotalsHandler({
        input: {},
        context: context(),
      });

      expect(totals.jobsByDay.map((row) => row.succeeded)).toEqual([2, 4]);
      expect(totals.jobsByDay.at(-1)!.day).toBe(totals.to);
      expect(totals.jobsByDay[0]!.day).toBe(totals.from);
      expect(totals.jobsByQueue).toEqual([
        expect.objectContaining({ queue: JobQueue.OsuFetch, succeeded: 6 }),
      ]);
    });

    it('limits the jobs by day to one queue and keeps every queue in the totals', async () => {
      await seedJobDay(1, JobQueue.OsuFetch, { succeeded: 3, durationMs: 900 });
      await seedJobDay(1, JobQueue.TournamentChecks, {
        failed: 1,
        durationMs: 4000,
      });

      const totals = await getJobDailyTotalsHandler({
        input: { days: 90, queue: JobQueue.TournamentChecks },
        context: context(),
      });

      expect(totals.jobsByDay).toEqual([
        expect.objectContaining({
          succeeded: 0,
          failed: 1,
          totalDurationMs: 4000,
        }),
      ]);
      expect(totals.jobsByQueue.map((row) => row.queue)).toEqual([
        JobQueue.OsuFetch,
        JobQueue.TournamentChecks,
      ]);
    });

    it('adds up requests per day by endpoint, and per endpoint by status', async () => {
      await seedRequestDay(2, 'getMatch', 'success', 10);
      await seedRequestDay(2, 'getMatch', 'error', 2);
      await seedRequestDay(1, 'getMatch', 'success', 5);
      await seedRequestDay(1, 'getUser', 'success', 7);

      const totals = await getJobDailyTotalsHandler({
        input: {},
        context: context(),
      });

      expect(
        totals.requestsByDay.map((row) => [row.endpoint, row.count])
      ).toEqual([
        ['getMatch', 12],
        ['getMatch', 5],
        ['getUser', 7],
      ]);
      expect(
        totals.requestsByEndpoint.map((row) => [
          row.endpoint,
          row.status,
          row.count,
          row.totalDurationMs,
        ])
      ).toEqual([
        ['getMatch', 'error', 2, 200],
        ['getMatch', 'success', 15, 1500],
        ['getUser', 'success', 7, 700],
      ]);
    });
  });
});
