import { describe, expect, it } from 'bun:test';
import { MessagePriority } from '@otr/core';
import { JobQueue } from '@otr/core/jobs';

import type { ClaimedJob } from '../../jobs/types';
import { TournamentAutomationCheckWorker } from '../tournament-automation-check-worker';
import type { TournamentAutomationCheckService } from '../tournament-automation-check-service';
import type { Logger } from '../../logging/logger';

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

const job = (
  overrideVerifiedState: boolean
): ClaimedJob<JobQueue.TournamentChecks> => ({
  id: 1,
  queue: JobQueue.TournamentChecks,
  payload: { tournamentId: 123, overrideVerifiedState },
  priority: MessagePriority.Normal,
  attempts: 1,
  maxAttempts: 5,
  correlationId: 'test-correlation',
  tournamentId: 123,
  requestedByUserId: null,
  traceContext: null,
  created: new Date().toISOString(),
});

const createWorker = (
  service: Pick<TournamentAutomationCheckService, 'processAutomationChecks'>,
  maintenanceWindowEnabled = false
) =>
  new TournamentAutomationCheckWorker({
    service,
    logger: noopLogger,
    maintenanceWindowEnabled,
  });

describe('TournamentAutomationCheckWorker', () => {
  it("runs the checks for the job's tournament", async () => {
    const calls: Array<[number, boolean]> = [];
    const worker = createWorker({
      async processAutomationChecks(tournamentId, overrideVerifiedState) {
        calls.push([tournamentId, overrideVerifiedState ?? false]);
        return true;
      },
    });

    await worker.handle(job(false));
    await worker.handle(job(true));

    expect(calls).toEqual([
      [123, false],
      [123, true],
    ]);
  });

  it('runs a reset as the admin its payload names', async () => {
    const calls: unknown[][] = [];
    const worker = createWorker({
      async processAutomationChecks(...args) {
        calls.push(args);
        return true;
      },
    });

    await worker.handle({
      ...job(true),
      payload: {
        tournamentId: 123,
        overrideVerifiedState: true,
        requestedByUserId: 45,
      },
    });

    expect(calls).toEqual([[123, true, 45]]);
  });

  it('leaves a thrown failure to the runner retry policy', async () => {
    const worker = createWorker({
      async processAutomationChecks() {
        throw new Error('boom');
      },
    });

    await expect(worker.handle(job(false))).rejects.toThrow('boom');
  });

  it('pauses during the maintenance window', () => {
    const pausedUntil = (enabled: boolean) =>
      createWorker({ processAutomationChecks: async () => true }, enabled)
        .registration()
        .pausedUntil?.(new Date('2026-10-13T11:50:00Z'));

    expect(pausedUntil(true)).toEqual(new Date('2026-10-13T12:15:00Z'));
    expect(pausedUntil(false)).toBeNull();
  });
});
