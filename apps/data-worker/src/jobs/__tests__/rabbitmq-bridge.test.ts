import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { JobQueue, JobStatus } from '@otr/core/jobs';

import {
  insertFailedJob,
  tournamentStatsJobFromMessage,
} from '../rabbitmq-bridge';
import {
  createJobsTestDb,
  jobRows,
  resetJobTables,
  testDatabaseUrl,
} from './test-db';

describe('tournamentStatsJobFromMessage', () => {
  it('keeps the tournament, priority and correlation id of a message the processor published', () => {
    // The camelCase JSON the processor's RabbitMQ publisher sent.
    const message = JSON.parse(
      '{"requestedAt":"2026-10-13T12:05:00Z","correlationId":"run-1","priority":5,"tournamentId":123}'
    );

    expect(tournamentStatsJobFromMessage(message)).toEqual({
      payload: { tournamentId: 123 },
      priority: 5,
      correlationId: 'run-1',
      tournamentId: 123,
    });
  });

  it('drops a message without a tournament id', () => {
    expect(
      tournamentStatsJobFromMessage({ correlationId: 'run-1' })
    ).toBeNull();
    expect(tournamentStatsJobFromMessage({ tournamentId: 'abc' })).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)('insertFailedJob', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);

  beforeEach(() => resetJobTables(db));
  afterAll(() => pool.end());

  it('adds a parked message as a failed job that leaves new work free to queue', async () => {
    await insertFailedJob(db, JobQueue.OsuFetch, {
      payload: { type: 'match', osuMatchId: 1, isLazer: false },
      correlationId: 'run-1',
      tournamentId: 7,
    });

    const [row] = await jobRows(db);
    expect(row).toMatchObject({
      queue: 'data.osu',
      payload: { type: 'match', osuMatchId: 1, isLazer: false },
      status: JobStatus.Failed,
      correlation_id: 'run-1',
      tournament_id: 7,
    });
    expect(row!.finished).not.toBeNull();
    expect(row!.last_error).toContain('RabbitMQ');
  });
});
