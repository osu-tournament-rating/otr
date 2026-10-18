import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { sql } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import { enqueueJob, JobQueue, JobStatus } from '@otr/core/jobs';

import type { DatabaseClient } from '../../db';

import {
  DiscardJobError,
  PermanentJobError,
  RetryableJobError,
} from '../errors';
import { JobListener } from '../listener';
import { JobRunner, LEASE_MS, RETRY_DELAYS_MS } from '../runner';
import type { QueueRegistration } from '../types';
import {
  createJobsTestDb,
  dailyTotals,
  jobRows,
  resetJobTables,
  silentLogger,
  testDatabaseUrl,
} from './test-db';

const QUEUE = JobQueue.TournamentStats;

const waitFor = async (
  condition: () => Promise<boolean>,
  timeoutMs = 5_000
) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe.skipIf(!testDatabaseUrl)('JobRunner', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);
  let runner: JobRunner | null = null;

  const startRunner = (
    registration: Partial<QueueRegistration<typeof QUEUE>> & {
      handler: QueueRegistration<typeof QUEUE>['handler'];
    },
    options: { workerId?: string } = {}
  ) => {
    runner = new JobRunner({
      db,
      logger: silentLogger,
      pollMs: 20,
      workerId: options.workerId ?? 'test-worker',
    });
    runner.register({ queue: QUEUE, ...registration });
    runner.start();
    return runner;
  };

  const enqueue = (tournamentId: number, extra = {}) =>
    enqueueJob(db, QUEUE, {
      payload: { tournamentId },
      tournamentId,
      ...extra,
    });

  const statusOf = async (tournamentId: number) =>
    (await jobRows(db)).find((row) => row.tournament_id === tournamentId)
      ?.status;

  beforeEach(() => resetJobTables(db));
  afterEach(async () => {
    await runner?.stop();
    runner = null;
  });
  afterAll(() => pool.end());

  it('runs a ready job, marks it succeeded and counts it in the daily totals', async () => {
    const handled: number[] = [];
    await enqueue(1);

    startRunner({
      handler: async (job) => {
        handled.push(job.payload.tournamentId);
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Succeeded);
    const [row] = await jobRows(db);
    expect(handled).toEqual([1]);
    expect(row!.attempts).toBe(1);
    expect(row!.locked_by).toBeNull();
    expect(row!.finished).not.toBeNull();
    expect(await dailyTotals(db, QUEUE)).toMatchObject({
      succeeded: 1,
      retried: 0,
      failed: 0,
    });
  });

  it('runs higher priority jobs first and leaves jobs that are not due yet', async () => {
    const order: number[] = [];
    await enqueue(1, { priority: MessagePriority.Low });
    await enqueue(2, { priority: MessagePriority.High });
    await enqueue(3, { runAfter: new Date(Date.now() + 60 * 60_000) });

    startRunner({
      handler: async (job) => {
        order.push(job.payload.tournamentId);
      },
    });

    await waitFor(async () => order.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(order).toEqual([2, 1]);
    expect(await statusOf(3)).toBe(JobStatus.Pending);
  });

  it('retries a failed attempt after a backoff and keeps the error', async () => {
    await enqueue(1);
    const before = Date.now();

    startRunner({
      handler: async () => {
        throw new Error('osu! returned 502');
      },
    });

    await waitFor(async () => (await jobRows(db))[0]?.last_error !== null);
    const [row] = await jobRows(db);
    const delay = row!.run_after.getTime() - before;
    expect(row!.status).toBe(JobStatus.Pending);
    expect(row!.attempts).toBe(1);
    expect(row!.last_error).toContain('osu! returned 502');
    expect(delay).toBeGreaterThanOrEqual(RETRY_DELAYS_MS[0]! * 0.9 - 1_000);
    expect(delay).toBeLessThanOrEqual(RETRY_DELAYS_MS[0]! * 1.1 + 1_000);
    expect(await dailyTotals(db, QUEUE)).toMatchObject({ retried: 1 });
  });

  it('waits at least as long as a handler asks before retrying', async () => {
    await enqueue(1);
    const before = Date.now();

    startRunner({
      handler: async () => {
        throw new RetryableJobError('rate limited', 3 * 60 * 60_000);
      },
    });

    await waitFor(async () => (await jobRows(db))[0]?.last_error !== null);
    const [row] = await jobRows(db);
    expect(row!.run_after.getTime() - before).toBeGreaterThanOrEqual(
      3 * 60 * 60_000 - 1_000
    );
  });

  it('fails a job after its last attempt and runs the give-up hook in the same transaction', async () => {
    await enqueue(1, { maxAttempts: 1 });
    const hookTransactions: string[] = [];

    startRunner({
      handler: async () => {
        throw new Error('still broken');
      },
      onGiveUp: async (_job, tx) => {
        const { rows } = await tx.execute<{ txid: string }>(
          sql`SELECT pg_current_xact_id()::text AS txid`
        );
        hookTransactions.push(rows[0]!.txid);
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Failed);
    const [row] = await jobRows(db);
    const { rows } = await db.execute<{ xmin: string }>(
      sql`SELECT xmin::text FROM jobs WHERE id = ${row!.id}`
    );
    expect(row!.finished).not.toBeNull();
    expect(row!.last_error).toContain('still broken');
    // The transaction that last wrote the job row is the one the hook ran in.
    expect(hookTransactions).toEqual([rows[0]!.xmin]);
    expect(await dailyTotals(db, QUEUE)).toMatchObject({ failed: 1 });
  });

  it('rolls back the give-up hook when the job was taken back before it failed', async () => {
    await enqueue(1, { maxAttempts: 1 });
    let hooks = 0;

    startRunner({
      handler: async () => {
        throw new Error('still broken');
      },
      onGiveUp: async (_job, tx) => {
        hooks += 1;
        await tx.execute(sql`
          INSERT INTO job_stats_daily (day, queue, cancelled)
          VALUES (CURRENT_DATE, 'hook-marker', 1)`);
        if (hooks === 1) {
          // Another session takes the job back while the hook runs.
          await db.execute(sql`UPDATE jobs SET locked_by = 'someone-else'`);
        }
      },
    });

    await waitFor(
      async () => (await jobRows(db))[0]?.locked_by === 'someone-else'
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hooks).toBe(1);
    expect(await dailyTotals(db, 'hook-marker')).toBeNull();
    expect(await statusOf(1)).toBe(JobStatus.Running);
  });

  it('fails a job at once on a permanent error, with attempts left', async () => {
    await enqueue(1);

    startRunner({
      handler: async () => {
        throw new PermanentJobError('no such tournament');
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Failed);
    expect((await jobRows(db))[0]!.attempts).toBe(1);
  });

  it('cancels a discarded job without running the give-up hook', async () => {
    await enqueue(1);
    let hooks = 0;

    startRunner({
      handler: async () => {
        throw new DiscardJobError('nothing to do');
      },
      onGiveUp: async () => {
        hooks += 1;
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Cancelled);
    expect(hooks).toBe(0);
    expect(await dailyTotals(db, QUEUE)).toMatchObject({ discarded: 1 });
  });

  it('runs a job again when someone asks for it while it runs', async () => {
    await enqueue(1);
    let runs = 0;

    startRunner({
      handler: async () => {
        runs += 1;
        if (runs === 1) {
          await db.execute(sql`UPDATE jobs SET rerun_requested = true`);
        }
      },
    });

    await waitFor(async () => runs === 2);
    await waitFor(async () => (await statusOf(1)) === JobStatus.Succeeded);
    const [row] = await jobRows(db);
    expect(row!.rerun_requested).toBe(false);
  });

  it('runs a job again at once when someone asks for it while a failing attempt runs', async () => {
    await enqueue(1);
    let runs = 0;

    startRunner({
      handler: async () => {
        runs += 1;
        if (runs === 1) {
          await db.execute(sql`UPDATE jobs SET rerun_requested = true`);
          throw new Error('osu! returned 502');
        }
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Succeeded);
    expect(runs).toBe(2);
  });

  it('gives an out-of-attempts job a fresh run instead of failing it when someone asked again', async () => {
    await enqueue(1, { maxAttempts: 1 });
    let runs = 0;
    let hooks = 0;

    startRunner({
      handler: async () => {
        runs += 1;
        if (runs === 1) {
          await db.execute(sql`UPDATE jobs SET rerun_requested = true`);
          throw new Error('first run fails');
        }
      },
      onGiveUp: async () => {
        hooks += 1;
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Succeeded);
    expect(runs).toBe(2);
    expect(hooks).toBe(0);
  });

  it('claims nothing while the queue is paused', async () => {
    await enqueue(1);
    let runs = 0;

    startRunner({
      handler: async () => {
        runs += 1;
      },
      pausedUntil: () => new Date(Date.now() + 60_000),
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runs).toBe(0);
    expect(runner!.isHealthy()).toBe(true);
  });

  it('takes back a lease another worker stopped renewing, and runs the job again', async () => {
    await enqueue(1);
    await db.execute(sql`
      UPDATE jobs SET status = ${JobStatus.Running}, attempts = 1,
        locked_by = 'crashed-worker', locked_until = now() - interval '1 second'`);
    const handled: number[] = [];

    startRunner({
      handler: async (job) => {
        handled.push(job.attempts);
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Succeeded);
    expect(handled).toEqual([2]);
    expect(await dailyTotals(db, QUEUE)).toMatchObject({ reclaimed: 1 });
  });

  it('fails an expired job that had no attempts left, running its give-up hook', async () => {
    await enqueue(1, { maxAttempts: 1 });
    await db.execute(sql`
      UPDATE jobs SET status = ${JobStatus.Running}, attempts = 1,
        locked_by = 'crashed-worker', locked_until = now() - interval '1 second'`);
    let hooks = 0;

    startRunner({
      handler: async () => {},
      onGiveUp: async () => {
        hooks += 1;
      },
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Failed);
    expect(hooks).toBe(1);
  });

  it('leaves the lease of a job it is still running', async () => {
    await enqueue(1);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));

    startRunner({ handler: () => blocked });
    await waitFor(async () => (await statusOf(1)) === JobStatus.Running);

    // Expire the lease as if renewal were late; the reaper must skip it.
    await db.execute(
      sql`UPDATE jobs SET locked_until = now() - interval '1 second'`
    );
    await (runner as unknown as { reap(): Promise<void> }).reap();

    expect(await statusOf(1)).toBe(JobStatus.Running);
    release();
    await waitFor(async () => (await statusOf(1)) === JobStatus.Succeeded);
  });

  it('keeps taking back expired leases when failing one of them throws', async () => {
    await enqueue(1, { maxAttempts: 1 });
    await enqueue(2, { maxAttempts: 1 });
    await enqueue(3);
    await db.execute(sql`
      UPDATE jobs SET status = ${JobStatus.Running}, attempts = 1,
        locked_by = 'crashed-worker', locked_until = now() - interval '1 second'`);
    const hooked: number[] = [];

    startRunner({
      handler: async () => {},
      onGiveUp: async (job) => {
        hooked.push(job.payload.tournamentId);
        if (job.payload.tournamentId === 1) {
          throw new Error('domain row is gone');
        }
      },
    });

    await waitFor(async () => (await statusOf(2)) === JobStatus.Failed);
    await waitFor(async () => (await statusOf(3)) === JobStatus.Succeeded);
    expect(hooked).toContain(2);
    expect(await statusOf(1)).toBe(JobStatus.Running);
    expect(await dailyTotals(db, QUEUE)).toMatchObject({ reclaimed: 2 });
  });

  it('renews the lease of a job it is running, unless another worker took it over', async () => {
    await enqueue(1);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const heartbeat = () =>
      (runner as unknown as { heartbeat(): Promise<void> }).heartbeat();
    const leaseLeft = async () =>
      (await jobRows(db))[0]!.locked_until!.getTime() - Date.now();

    startRunner({ handler: () => blocked });
    await waitFor(async () => (await statusOf(1)) === JobStatus.Running);

    await db.execute(
      sql`UPDATE jobs SET locked_until = now() + interval '1 second'`
    );
    await heartbeat();
    expect(await leaseLeft()).toBeGreaterThan(LEASE_MS - 10_000);

    await db.execute(sql`
      UPDATE jobs SET locked_by = 'other-worker',
        locked_until = now() + interval '1 second'`);
    await heartbeat();
    expect(await leaseLeft()).toBeLessThan(2_000);

    release();
  });

  it('records how long attempts took in the daily totals', async () => {
    await enqueue(1);

    startRunner({
      handler: () => new Promise((resolve) => setTimeout(resolve, 60)),
    });

    await waitFor(async () => (await statusOf(1)) === JobStatus.Succeeded);
    const totals = await dailyTotals(db, QUEUE);
    expect(totals!.total_duration_ms).toBeGreaterThanOrEqual(55);
    expect(totals!.max_duration_ms).toBeGreaterThanOrEqual(55);
  });

  it('returns a running job to the queue on shutdown without using an attempt', async () => {
    await enqueue(1);
    const never = new Promise<void>(() => {});

    const started = startRunner({ handler: () => never });
    await waitFor(async () => (await statusOf(1)) === JobStatus.Running);

    const stopping = started.stop();
    runner = null;
    await stopping;

    const [row] = await jobRows(db);
    expect(row!.status).toBe(JobStatus.Pending);
    expect(row!.attempts).toBe(0);
    expect(row!.locked_by).toBeNull();
  }, 15_000);

  it('holds the lease for the lease length when it claims', async () => {
    await enqueue(1);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));

    startRunner({ handler: () => blocked });
    await waitFor(async () => (await statusOf(1)) === JobStatus.Running);

    const [row] = await jobRows(db);
    const remaining = row!.locked_until!.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(LEASE_MS - 10_000);
    expect(remaining).toBeLessThanOrEqual(LEASE_MS + 1_000);
    release();
  });
});

describe.skipIf(!testDatabaseUrl)('JobListener', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);
  afterAll(() => pool.end());

  it('reports the queue of a job that becomes ready', async () => {
    await resetJobTables(db);
    const ready: string[] = [];
    const listener = new JobListener({
      connectionString: testDatabaseUrl!,
      logger: silentLogger,
      onReady: (queue) => ready.push(queue),
    });

    await listener.start();
    try {
      await enqueueJob(db, QUEUE, { payload: { tournamentId: 1 } });
      await waitFor(async () => ready.length > 0);
      expect(ready).toEqual([QUEUE]);
    } finally {
      await listener.stop();
    }
  });
});

describe('JobRunner health', () => {
  const failingDb = {
    execute: async () => {
      throw new Error('database unavailable');
    },
    transaction: async () => {
      throw new Error('database unavailable');
    },
  } as unknown as DatabaseClient;

  const idleDb = {
    execute: async () => ({ rows: [], rowCount: 0 }),
    transaction: async () => {
      throw new Error('no jobs to settle');
    },
  } as unknown as DatabaseClient;

  const healthRunner = (
    db: DatabaseClient,
    pausedUntil?: () => Date | null
  ) => {
    const runner = new JobRunner({
      db,
      logger: silentLogger,
      pollMs: 20,
      healthyTickMs: 200,
    });
    runner.register({ queue: QUEUE, handler: async () => {}, pausedUntil });
    return runner;
  };

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it('is unhealthy before it starts and after it stops', async () => {
    const runner = healthRunner(idleDb);
    expect(runner.isHealthy()).toBe(false);

    runner.start();
    expect(runner.isHealthy()).toBe(true);

    await runner.stop();
    expect(runner.isHealthy()).toBe(false);
  });

  it('stays healthy while an idle queue keeps asking for work', async () => {
    const runner = healthRunner(idleDb);
    runner.start();
    try {
      await sleep(500);
      expect(runner.isHealthy()).toBe(true);
    } finally {
      await runner.stop();
    }
  });

  it('turns unhealthy when a queue cannot ask the database for work', async () => {
    const runner = healthRunner(failingDb);
    runner.start();
    try {
      await sleep(500);
      expect(runner.isHealthy()).toBe(false);
    } finally {
      await runner.stop();
    }
  });

  it('stays healthy while a queue is paused for the maintenance window', async () => {
    const runner = healthRunner(failingDb, () => new Date(Date.now() + 60_000));
    runner.start();
    try {
      await sleep(500);
      expect(runner.isHealthy()).toBe(true);
    } finally {
      await runner.stop();
    }
  });
});
