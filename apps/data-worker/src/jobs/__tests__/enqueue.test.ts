import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import {
  enqueueJob,
  enqueueJobs,
  getJobQueueSummary,
  JobQueue,
  JobStatus,
} from '@otr/core/jobs';

import {
  createJobsTestDb,
  jobRows,
  resetJobTables,
  testDatabaseUrl,
} from './test-db';

describe.skipIf(!testDatabaseUrl)('enqueueJobs', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);

  beforeEach(() => resetJobTables(db));
  afterAll(() => pool.end());

  const match = (osuMatchId: number) => ({
    type: 'match' as const,
    osuMatchId,
    isLazer: false,
  });

  it('queues a job that is ready to run with the default attempts and priority', async () => {
    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(1) });

    const [row] = await jobRows(db);
    expect(row).toMatchObject({
      queue: 'data.osu',
      payload: match(1),
      status: JobStatus.Pending,
      priority: MessagePriority.Normal,
      attempts: 0,
      max_attempts: 5,
    });
    expect(row!.run_after.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('merges a request for pending work into the existing job', async () => {
    await enqueueJob(db, JobQueue.BeatmapAttributes, {
      payload: { beatmapId: 7 },
      priority: MessagePriority.Low,
    });
    await enqueueJob(db, JobQueue.BeatmapAttributes, {
      payload: { beatmapId: 7, checksum: 'abc' },
      priority: MessagePriority.High,
    });

    const rows = await jobRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.priority).toBe(MessagePriority.High);
    expect(rows[0]!.payload).toEqual({ beatmapId: 7, checksum: 'abc' });
  });

  it('never lowers the priority of the job it merges into', async () => {
    await enqueueJob(db, JobQueue.OsuFetch, {
      payload: match(2),
      priority: MessagePriority.High,
    });
    await enqueueJob(db, JobQueue.OsuFetch, {
      payload: match(2),
      priority: MessagePriority.Low,
    });

    const [row] = await jobRows(db);
    expect(row!.priority).toBe(MessagePriority.High);
  });

  it('keeps a retrying job in backoff when automatic work merges into it', async () => {
    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(3) });
    await db.execute(sql`
      UPDATE jobs SET attempts = 2, run_after = now() + interval '1 hour'`);

    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(3) });

    const [row] = await jobRows(db);
    expect(row!.attempts).toBe(2);
    expect(row!.run_after.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
  });

  it('gives a retrying job a fresh start when a person asks for it again', async () => {
    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(4) });
    await db.execute(sql`
      UPDATE jobs SET attempts = 4, run_after = now() + interval '1 hour'`);

    await enqueueJob(db, JobQueue.OsuFetch, {
      payload: match(4),
      explicit: true,
    });

    const [row] = await jobRows(db);
    expect(row!.attempts).toBe(0);
    expect(row!.run_after.getTime()).toBeLessThanOrEqual(Date.now());
    // It hasn't started, so one run covers the request.
    expect(row!.rerun_requested).toBe(false);
  });

  it('asks a running job to run again only when a person asks for it', async () => {
    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(5) });
    await db.execute(sql`UPDATE jobs SET status = ${JobStatus.Running}`);

    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(5) });
    expect((await jobRows(db))[0]!.rerun_requested).toBe(false);

    await enqueueJob(db, JobQueue.OsuFetch, {
      payload: match(5),
      explicit: true,
    });
    const rows = await jobRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rerun_requested).toBe(true);
  });

  it('queues new work once the earlier job has finished', async () => {
    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(6) });
    await db.execute(
      sql`UPDATE jobs SET status = ${JobStatus.Succeeded}, finished = now()`
    );

    await enqueueJob(db, JobQueue.OsuFetch, { payload: match(6) });

    const rows = await jobRows(db);
    expect(rows.map((row) => row.status)).toEqual([
      JobStatus.Succeeded,
      JobStatus.Pending,
    ]);
  });

  it('keeps work that differs in a flag as separate jobs', async () => {
    await enqueueJobs(db, JobQueue.TournamentChecks, [
      { payload: { tournamentId: 1, overrideVerifiedState: false } },
      { payload: { tournamentId: 1, overrideVerifiedState: true } },
    ]);

    expect(await jobRows(db)).toHaveLength(2);
  });

  it('collapses repeated work within one batch into one job', async () => {
    await enqueueJobs(db, JobQueue.OsuFetch, [
      { payload: match(8), priority: MessagePriority.Low },
      { payload: match(9) },
      { payload: match(8), priority: MessagePriority.High },
    ]);

    const rows = await jobRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.payload.osuMatchId === 8)!.priority).toBe(
      MessagePriority.High
    );
  });

  it('never merges tournament stats jobs, which the processor inserts without a key', async () => {
    await enqueueJob(db, JobQueue.TournamentStats, {
      payload: { tournamentId: 10 },
    });
    await enqueueJob(db, JobQueue.TournamentStats, {
      payload: { tournamentId: 10 },
    });

    expect(await jobRows(db)).toHaveLength(2);
  });

  it('lets two transactions queue overlapping work with mixed requests without deadlocking', async () => {
    // Each transaction runs its first statement, then waits until the other
    // has run its first too, or a second passes if the other is blocked.
    let arrived = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    const gated = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      let first = true;
      return {
        execute: async (query: Parameters<typeof tx.execute>[0]) => {
          const result = await tx.execute(query);
          if (first) {
            first = false;
            arrived += 1;
            if (arrived === 2) release();
            await Promise.race([
              bothStarted,
              new Promise((resolve) => setTimeout(resolve, 1_000)),
            ]);
          }
          return result;
        },
      };
    };

    const results = await Promise.allSettled([
      db.transaction((tx) =>
        enqueueJobs(gated(tx), JobQueue.OsuFetch, [
          { payload: match(21), explicit: true },
          { payload: match(22) },
        ])
      ),
      db.transaction((tx) =>
        enqueueJobs(gated(tx), JobQueue.OsuFetch, [
          { payload: match(22), explicit: true },
          { payload: match(21) },
        ])
      ),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ]);
    expect(await jobRows(db)).toHaveLength(2);
  });

  it('queues nothing when the transaction it was queued in rolls back', async () => {
    await db
      .transaction(async (tx) => {
        await enqueueJob(tx, JobQueue.OsuFetch, { payload: match(11) });
        throw new Error('roll back');
      })
      .catch(() => {});

    expect(await jobRows(db)).toHaveLength(0);
  });
});

describe.skipIf(!testDatabaseUrl)('getJobQueueSummary', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);

  beforeEach(() => resetJobTables(db));
  afterAll(() => pool.end());

  it('counts ready, delayed, running and failed jobs per queue', async () => {
    const stats = (tournamentId: number) => ({
      payload: { tournamentId },
      tournamentId,
    });
    await enqueueJobs(
      db,
      JobQueue.TournamentStats,
      [1, 2, 3, 4, 5, 6].map(stats)
    );
    await db.execute(sql`
      UPDATE jobs SET
        run_after = CASE WHEN tournament_id = 2 THEN now() + interval '1 hour'
                         WHEN tournament_id = 1 THEN now() - interval '30 seconds'
                         ELSE run_after END,
        status = CASE tournament_id
          WHEN 3 THEN ${JobStatus.Running}
          WHEN 4 THEN ${JobStatus.Failed}
          WHEN 5 THEN ${JobStatus.Succeeded}
          ELSE status END
      WHERE true`);

    const [summary] = await getJobQueueSummary(db);

    expect(summary).toMatchObject({
      queue: 'processing.stats.tournaments',
      ready: 2,
      delayed: 1,
      running: 1,
      failed: 1,
    });
    expect(summary!.oldestReadySeconds).toBeGreaterThanOrEqual(29);
  });
});
