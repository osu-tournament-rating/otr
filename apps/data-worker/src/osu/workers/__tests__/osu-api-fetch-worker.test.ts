import { describe, expect, it, mock } from 'bun:test';
import type { OsuApiPayload } from '@otr/core';
import { MessagePriority } from '@otr/core';
import { JobQueue } from '@otr/core/jobs';

import { PermanentJobError, RetryableJobError } from '../../../jobs/errors';
import type { ClaimedJob } from '../../../jobs/types';
import type { Logger } from '../../../logging/logger';
import { captureOsuRetryAfter } from '../../retry-after';
import { OsuApiFetchWorker } from '../osu-api-fetch-worker';

const createMockLogger = (): Logger => ({
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  child: mock(() => createMockLogger()),
});

const job = (
  payload: OsuApiPayload,
  created = '2026-10-18T12:00:00.000Z'
): ClaimedJob<JobQueue.OsuFetch> => ({
  id: 1,
  queue: JobQueue.OsuFetch,
  payload,
  priority: MessagePriority.Normal,
  attempts: 1,
  maxAttempts: 5,
  correlationId: 'test-correlation-id',
  tournamentId: null,
  requestedByUserId: null,
  traceContext: null,
  created,
});

const createWorker = (overrides: {
  beatmap?: (...args: unknown[]) => Promise<boolean>;
  match?: (...args: unknown[]) => Promise<boolean>;
  player?: (...args: unknown[]) => Promise<boolean>;
  forumTopic?: (...args: unknown[]) => Promise<boolean>;
}) => {
  const services = {
    beatmap: mock(overrides.beatmap ?? (() => Promise.resolve(true))),
    match: mock(overrides.match ?? (() => Promise.resolve(true))),
    player: mock(overrides.player ?? (() => Promise.resolve(true))),
    forumTopic: mock(overrides.forumTopic ?? (() => Promise.resolve(true))),
  };

  const worker = new OsuApiFetchWorker({
    beatmapService: { fetchAndPersist: services.beatmap },
    matchService: { fetchAndPersist: services.match },
    playerService: { fetchAndPersist: services.player },
    forumTopicService: { fetchAndPersist: services.forumTopic },
    dataCompletion: {
      updateMatchFetchStatus: mock(() => Promise.resolve()),
      updateBeatmapFetchStatus: mock(() => Promise.resolve()),
      recheckTournaments: mock(() => Promise.resolve()),
      tournamentsUsingBeatmap: mock(() => Promise.resolve(new Set<number>())),
    },
    logger: createMockLogger(),
    maintenanceWindowEnabled: false,
  });

  return { worker, services };
};

describe('OsuApiFetchWorker', () => {
  it('routes beatmap fetches to the beatmap service', async () => {
    const { worker, services } = createWorker({});

    await worker.handle(job({ type: 'beatmap', beatmapId: 123 }));
    await worker.handle(
      job({ type: 'beatmap', beatmapId: 456, skipAutomationChecks: true })
    );

    expect(services.beatmap.mock.calls).toEqual([
      [123, { skipAutomationChecks: undefined }],
      [456, { skipAutomationChecks: true }],
    ]);
    expect(services.match).not.toHaveBeenCalled();
  });

  it('routes match fetches to the match service', async () => {
    const { worker, services } = createWorker({});

    await worker.handle(job({ type: 'match', osuMatchId: 789, isLazer: true }));

    expect(services.match.mock.calls).toEqual([[789, true]]);
  });

  it('routes player fetches to the player service', async () => {
    const { worker, services } = createWorker({});

    await worker.handle(job({ type: 'player', osuPlayerId: 42 }));

    expect(services.player.mock.calls).toEqual([[42]]);
  });

  it("passes forum topic fetches the job's creation as the request time", async () => {
    const { worker, services } = createWorker({});

    await worker.handle(
      job({ type: 'forumTopic', topicId: 7 }, '2026-10-01T00:00:00.000Z')
    );

    expect(services.forumTopic.mock.calls).toEqual([
      [7, '2026-10-01T00:00:00.000Z'],
    ]);
  });

  it('leaves a service error to the runner retry policy', async () => {
    const { worker } = createWorker({
      match: () => Promise.reject(new Error('database is down')),
    });

    const error = await worker
      .handle(job({ type: 'match', osuMatchId: 1, isLazer: false }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RetryableJobError);
    expect((error as Error).message).toBe('database is down');
  });

  it('fails a job it does not recognise without retrying', async () => {
    const { worker } = createWorker({});

    await expect(
      worker.handle(job({ type: 'unknown' } as unknown as OsuApiPayload))
    ).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('retries a rate-limited fetch no sooner than osu! asked', async () => {
    const osuFetch = captureOsuRetryAfter(
      async (_input: RequestInfo | URL) =>
        new Response('{}', {
          status: 429,
          headers: { 'Retry-After': '120' },
        })
    );
    const { worker } = createWorker({
      // As the osu! client does: call fetch, then throw without the headers.
      player: async () => {
        await osuFetch('https://osu.ppy.sh/api/v2/users/42');
        // Shaped like the client's APIError, which other test files mock.
        throw Object.assign(new Error('Too Many Requests'), {
          response: { status_code: 429, json: {} },
        });
      },
    });

    const error = await worker
      .handle(job({ type: 'player', osuPlayerId: 42 }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(RetryableJobError);
    expect((error as RetryableJobError).delayMs).toBe(120_000);
  });

  it("keeps osu!'s wait when its 429 or 503 body wasn't JSON", async () => {
    const osuFetch = captureOsuRetryAfter(
      async (_input: RequestInfo | URL) =>
        new Response('<html>busy</html>', {
          status: 503,
          headers: { 'Retry-After': '300' },
        })
    );
    const { worker } = createWorker({
      // The client then throws without a response status.
      match: async () => {
        await osuFetch('https://osu.ppy.sh/api/v2/matches/1');
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });

    const error = await worker
      .handle(job({ type: 'match', osuMatchId: 1, isLazer: false }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(RetryableJobError);
    expect((error as RetryableJobError).delayMs).toBe(300_000);
  });

  it('pauses the whole queue for as long as osu! asked one job to wait', async () => {
    const osuFetch = captureOsuRetryAfter(
      async (_input: RequestInfo | URL) =>
        new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
    );
    const { worker } = createWorker({
      player: async () => {
        await osuFetch('https://osu.ppy.sh/api/v2/users/42');
        throw Object.assign(new Error('Too Many Requests'), {
          response: { status_code: 429, json: {} },
        });
      },
    });
    const before = Date.now();
    expect(worker.pausedUntil(new Date(before))).toBeNull();

    await worker
      .handle(job({ type: 'player', osuPlayerId: 42 }))
      .catch(() => {});

    const until = worker.pausedUntil(new Date())!.getTime();
    expect(until).toBeGreaterThanOrEqual(before + 60_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(worker.pausedUntil(new Date(until + 1))).toBeNull();
  });
});
