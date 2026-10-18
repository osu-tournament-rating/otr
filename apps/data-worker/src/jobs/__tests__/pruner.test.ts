import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { enqueueJobs, JobQueue, JobStatus } from '@otr/core/jobs';

import { JobPruner } from '../pruner';
import {
  createJobsTestDb,
  jobRows,
  resetJobTables,
  silentLogger,
  testDatabaseUrl,
} from './test-db';

// Tuesday 12:00 UTC, inside the maintenance window.
const MAINTENANCE = new Date('2026-10-13T12:00:00Z');

describe.skipIf(!testDatabaseUrl)('JobPruner', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);

  beforeEach(() => resetJobTables(db));
  afterAll(() => pool.end());

  const pruner = (now?: Date) =>
    new JobPruner({
      db,
      logger: silentLogger,
      maintenanceWindowEnabled: true,
      now: now ? () => now : undefined,
    });

  const seed = async () => {
    await enqueueJobs(
      db,
      JobQueue.TournamentStats,
      [1, 2, 3, 4, 5, 6].map((tournamentId) => ({
        payload: { tournamentId },
        tournamentId,
      }))
    );
    // 1-3: finished 15 days ago as succeeded, failed, cancelled.
    // 4: succeeded 13 days ago. 5: pending since 20 days ago. 6: running.
    await db.execute(sql`
      UPDATE jobs SET
        status = CASE tournament_id
          WHEN 1 THEN ${JobStatus.Succeeded} WHEN 2 THEN ${JobStatus.Failed}
          WHEN 3 THEN ${JobStatus.Cancelled} WHEN 4 THEN ${JobStatus.Succeeded}
          WHEN 6 THEN ${JobStatus.Running} ELSE status END,
        finished = CASE
          WHEN tournament_id IN (1, 2, 3) THEN now() - interval '15 days'
          WHEN tournament_id = 4 THEN now() - interval '13 days' END,
        created = CASE WHEN tournament_id = 5 THEN now() - interval '20 days'
          ELSE created END
      WHERE true`);
  };

  it('deletes jobs that finished over 14 days ago and keeps the rest', async () => {
    await seed();

    const deleted = await pruner().run();

    expect(deleted).toBe(3);
    expect((await jobRows(db)).map((row) => row.tournament_id).sort()).toEqual([
      4, 5, 6,
    ]);
  });

  it('counts the jobs created each day', async () => {
    await enqueueJobs(db, JobQueue.TournamentStats, [
      { payload: { tournamentId: 1 } },
      { payload: { tournamentId: 2 } },
    ]);
    await enqueueJobs(db, JobQueue.OsuTrackFetch, [
      { payload: { osuPlayerId: 1 } },
    ]);
    await db.execute(sql`
      UPDATE jobs SET created = now() - interval '1 day'
      WHERE queue = ${JobQueue.OsuTrackFetch}`);

    await pruner().run();

    const { rows } = await db.execute<{
      day: string;
      queue: string;
      enqueued: number;
    }>(
      sql`SELECT day::text, queue, enqueued FROM job_stats_daily ORDER BY queue`
    );
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(rows).toEqual([
      { day: yesterday, queue: JobQueue.OsuTrackFetch, enqueued: 1 },
      { day: today, queue: JobQueue.TournamentStats, enqueued: 2 },
    ]);
  });

  it("keeps a day's total when its jobs are pruned before a later recount", async () => {
    await enqueueJobs(db, JobQueue.TournamentStats, [
      { payload: { tournamentId: 1 } },
      { payload: { tournamentId: 2 } },
    ]);
    await pruner().run();

    await db.execute(
      sql`DELETE FROM jobs WHERE payload->>'tournamentId' = '1'`
    );
    await pruner().run();

    const { rows } = await db.execute<{ enqueued: number }>(
      sql`SELECT enqueued FROM job_stats_daily WHERE queue = ${JobQueue.TournamentStats}`
    );
    expect(rows).toEqual([{ enqueued: 2 }]);
  });

  it('does nothing during the maintenance window', async () => {
    await seed();

    expect(await pruner(MAINTENANCE).run()).toBe(0);
    expect(await jobRows(db)).toHaveLength(6);
  });
});
