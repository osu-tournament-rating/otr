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

import { JobRunner } from '../../jobs/runner';
import {
  createJobsTestDb,
  dailyTotals,
  jobRows,
  silentLogger,
  testDatabaseUrl,
} from '../../jobs/__tests__/test-db';
import type { ClaimedJob } from '../../jobs/types';
import type { Logger } from '../../logging/logger';
import { BeatmapAttributesWorker } from '../beatmap-attributes-worker';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

const job = (
  payload: { beatmapId: number; checksum?: string },
  priority = MessagePriority.Normal
): ClaimedJob<JobQueue.BeatmapAttributes> => ({
  id: 1,
  queue: JobQueue.BeatmapAttributes,
  payload,
  priority,
  attempts: 1,
  maxAttempts: priority === MessagePriority.Low ? 1 : 5,
  correlationId: 'corr-id',
  tournamentId: null,
  requestedByUserId: null,
  traceContext: null,
  created: new Date().toISOString(),
});

const createWorker = (
  processJob: (job: { beatmapId: number; checksum?: string }) => Promise<void>,
  maintenanceWindowEnabled = false
) =>
  new BeatmapAttributesWorker({
    service: { process: processJob },
    logger: noopLogger,
    maintenanceWindowEnabled,
  });

describe('BeatmapAttributesWorker', () => {
  it('passes the beatmap and checksum to the service', async () => {
    const jobs: Array<{ beatmapId: number; checksum?: string }> = [];
    const worker = createWorker(async (job) => {
      jobs.push(job);
    });

    await worker.handle(job({ beatmapId: 7, checksum: 'abc' }));
    await worker.handle(job({ beatmapId: 8 }));

    expect(jobs).toEqual([
      { beatmapId: 7, checksum: 'abc' },
      { beatmapId: 8, checksum: undefined },
    ]);
  });

  it('pauses during the maintenance window', () => {
    const pausedUntil = (enabled: boolean) =>
      createWorker(async () => {}, enabled)
        .registration()
        .pausedUntil?.(new Date('2026-10-13T11:50:00Z'));

    expect(pausedUntil(true)).toEqual(new Date('2026-10-13T12:15:00Z'));
    expect(pausedUntil(false)).toBeNull();
  });
});

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

describe.skipIf(!testDatabaseUrl)('failed beatmap attribute jobs', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);
  let runner: JobRunner | null = null;

  const clear = async () => {
    await db.execute(
      sql`DELETE FROM jobs WHERE queue = ${JobQueue.BeatmapAttributes}`
    );
    await db.execute(
      sql`DELETE FROM job_stats_daily WHERE queue = ${JobQueue.BeatmapAttributes}`
    );
  };

  beforeEach(clear);
  afterEach(async () => {
    await runner?.stop();
    runner = null;
  });
  afterAll(async () => {
    await clear();
    await pool.end();
  });

  it('drops a sweep job without failing it, and retries a fetch job', async () => {
    // As the sweep and a beatmap fetch queue them.
    await enqueueJob(db, JobQueue.BeatmapAttributes, {
      payload: { beatmapId: 1 },
      priority: MessagePriority.Low,
      maxAttempts: 1,
    });
    await enqueueJob(db, JobQueue.BeatmapAttributes, {
      payload: { beatmapId: 2, checksum: 'a'.repeat(32) },
    });

    runner = new JobRunner({ db, logger: silentLogger, pollMs: 20 });
    runner.register(
      createWorker(async () => {
        throw new Error('storage unavailable');
      }).registration()
    );
    runner.start();

    const rowFor = async (beatmapId: number) =>
      (await jobRows(db)).find(
        (row) =>
          row.queue === JobQueue.BeatmapAttributes &&
          row.payload.beatmapId === beatmapId
      )!;
    await waitFor(
      async () =>
        (await rowFor(1)).finished !== null &&
        (await rowFor(2)).last_error !== null
    );

    expect((await rowFor(1)).status).toBe(JobStatus.Cancelled);
    expect(await rowFor(2)).toMatchObject({
      status: JobStatus.Pending,
      attempts: 1,
    });
    expect(await dailyTotals(db, JobQueue.BeatmapAttributes)).toMatchObject({
      discarded: 1,
      retried: 1,
      failed: 0,
    });
  });
});
