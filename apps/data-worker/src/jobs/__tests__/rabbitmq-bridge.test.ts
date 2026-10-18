import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { JobQueue, JobStatus } from '@otr/core/jobs';

import {
  insertFailedJob,
  osuFetchJobFromMessage,
  osuTrackJobFromMessage,
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

describe('osuFetchJobFromMessage', () => {
  const metadata = {
    requestedAt: '2026-10-13T12:05:00Z',
    correlationId: 'req-1',
    priority: 0,
  };

  it('keeps each kind of osu! fetch the site and worker published', () => {
    expect(
      [
        { type: 'match', osuMatchId: 1, isLazer: true },
        { type: 'beatmap', beatmapId: 2, skipAutomationChecks: true },
        { type: 'player', osuPlayerId: 3 },
        { type: 'forumTopic', topicId: 4 },
      ].map((payload) => osuFetchJobFromMessage({ ...metadata, ...payload }))
    ).toEqual([
      {
        payload: { type: 'match', osuMatchId: 1, isLazer: true },
        priority: 0,
        correlationId: 'req-1',
      },
      {
        payload: { type: 'beatmap', beatmapId: 2, skipAutomationChecks: true },
        priority: 0,
        correlationId: 'req-1',
      },
      {
        payload: { type: 'player', osuPlayerId: 3 },
        priority: 0,
        correlationId: 'req-1',
      },
      {
        payload: { type: 'forumTopic', topicId: 4 },
        priority: 0,
        correlationId: 'req-1',
      },
    ]);
  });

  it('drops a message of an unknown kind or without its id', () => {
    expect(osuFetchJobFromMessage({ type: 'room', roomId: 1 })).toBeNull();
    expect(
      osuFetchJobFromMessage({ type: 'match', isLazer: false })
    ).toBeNull();
  });
});

describe('osuTrackJobFromMessage', () => {
  it('keeps the player, priority and correlation id the refetch scheduler published', () => {
    const message = JSON.parse(
      '{"requestedAt":"2026-10-13T12:05:00.000Z","correlationId":"refetch-1","priority":0,"osuPlayerId":4567}'
    );

    expect(osuTrackJobFromMessage(message)).toEqual({
      payload: { osuPlayerId: 4567 },
      priority: 0,
      correlationId: 'refetch-1',
    });
  });

  it('drops a message without a player id', () => {
    expect(osuTrackJobFromMessage({ correlationId: 'refetch-1' })).toBeNull();
    expect(osuTrackJobFromMessage({ osuPlayerId: 0 })).toBeNull();
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
