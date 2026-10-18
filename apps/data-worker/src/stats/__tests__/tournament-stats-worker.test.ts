import { describe, expect, it } from 'bun:test';
import { MessagePriority } from '@otr/core';
import { JobQueue } from '@otr/core/jobs';

import processorPayload from '../../../../../packages/otr-core/src/jobs/__fixtures__/tournament-stats-payload.json';
import { DiscardJobError, PermanentJobError } from '../../jobs/errors';
import type { ClaimedJob } from '../../jobs/types';
import type { Logger } from '../../logging/logger';
import { TournamentStatsWorker } from '../tournament-stats-worker';
import type { TournamentStatsService } from '../tournament-stats-service';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

const job = (payload: unknown): ClaimedJob<JobQueue.TournamentStats> => ({
  id: 1,
  queue: JobQueue.TournamentStats,
  payload: payload as { tournamentId: number },
  priority: MessagePriority.Normal,
  attempts: 1,
  maxAttempts: 5,
  correlationId: 'corr-id',
  tournamentId: 5,
  requestedByUserId: null,
  traceContext: null,
  created: new Date().toISOString(),
});

const workerWith = (
  processTournamentStats: TournamentStatsService['processTournamentStats']
) =>
  new TournamentStatsWorker({
    service: { processTournamentStats } as TournamentStatsService,
    logger: noopLogger,
  });

describe('TournamentStatsWorker', () => {
  it('processes the tournament named by the payload the processor writes', async () => {
    const processed: number[] = [];
    const worker = workerWith(async (tournamentId) => {
      processed.push(tournamentId);
      return { status: 'processed' };
    });

    await worker.handle(job(processorPayload));

    expect(processed).toEqual([123]);
  });

  it('fails the job without retrying when the calculation fails', async () => {
    const worker = workerWith(async () => ({
      status: 'failed',
      reason: 'boom',
    }));

    await expect(
      worker.handle(job({ tournamentId: 5 }))
    ).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('drops the job without an alert when there is nothing to calculate', async () => {
    const worker = workerWith(async () => ({
      status: 'skipped',
      reason: 'The tournament is not verified',
    }));

    await expect(
      worker.handle(job({ tournamentId: 5 }))
    ).rejects.toBeInstanceOf(DiscardJobError);
  });

  it('fails the job without calling the service when the payload has no tournament id', async () => {
    let calls = 0;
    const worker = workerWith(async () => {
      calls += 1;
      return { status: 'processed' };
    });

    await expect(worker.handle(job({}))).rejects.toBeInstanceOf(
      PermanentJobError
    );
    expect(calls).toBe(0);
  });

  it('leaves a thrown failure to the runner retry policy', async () => {
    const worker = workerWith(async () => {
      throw new Error('boom');
    });

    const error = await worker.handle(job({ tournamentId: 5 })).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentJobError);
    expect((error as Error).message).toBe('boom');
  });
});
