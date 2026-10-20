import { describe, expect, it, mock } from 'bun:test';

import type { API } from 'osu-api-v2-js';
import type { DatabaseClient } from '../../../db';
import type { Logger } from '../../../logging/logger';
import type { RateLimiter } from '../../../rate-limiter';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

// The client module reads worker env at import time
mock.module('../../client', () => ({
  APIError: class APIError extends Error {},
}));

const { PlayerFetchService } = await import('../player-fetch-service');

type PlayerUpdate = Record<string, unknown>;

const PLAYER_ID = 7;
const OSU_ID = 4001;

const createLogger = (): Logger => {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
};

const createHarness = (apiUser: Record<string, unknown>) => {
  const updates: PlayerUpdate[] = [];

  const db = {
    query: {
      players: {
        findFirst: async () => ({
          id: PLAYER_ID,
          dataFetchStatus: DataFetchStatus.Fetching,
        }),
      },
    },
    update: () => ({
      set: (values: PlayerUpdate) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
      }),
    }),
  } as unknown as DatabaseClient;

  const api = {
    getUser: async () => apiUser,
  } as unknown as API;

  const rateLimiter = {
    schedule: <T>(task: () => Promise<T>) => task(),
  } as unknown as RateLimiter;

  const service = new PlayerFetchService({
    db,
    api,
    rateLimiter,
    logger: createLogger(),
  });

  return { service, updates };
};

const previousUsernamesOf = (updates: PlayerUpdate[]) =>
  updates.find((update) => 'previousUsernames' in update)?.previousUsernames as
    string[] | undefined;

const buildApiUser = (overrides: Record<string, unknown>) => ({
  id: OSU_ID,
  username: 'currentname',
  playmode: 'osu',
  country_code: 'US',
  statistics: { pp: 1000, global_rank: 500 },
  ...overrides,
});

describe('PlayerFetchService previous usernames', () => {
  it('persists the previous usernames returned by the API', async () => {
    const { service, updates } = createHarness(
      buildApiUser({ previous_usernames: ['hotdog2000', 'oldname'] })
    );

    await service.fetchAndPersist(OSU_ID);

    expect(previousUsernamesOf(updates)).toEqual(['hotdog2000', 'oldname']);
  });

  it('clears the column when the API returns an empty array', async () => {
    const { service, updates } = createHarness(
      buildApiUser({ previous_usernames: [] })
    );

    await service.fetchAndPersist(OSU_ID);

    expect(previousUsernamesOf(updates)).toEqual([]);
  });

  it('collapses duplicates while preserving API order', async () => {
    const { service, updates } = createHarness(
      buildApiUser({
        previous_usernames: [
          'hotdog2000',
          'HotDog2000',
          'oldname',
          'hotdog2000',
        ],
      })
    );

    await service.fetchAndPersist(OSU_ID);

    expect(previousUsernamesOf(updates)).toEqual(['hotdog2000', 'oldname']);
  });

  it('drops blank entries and the current username', async () => {
    const { service, updates } = createHarness(
      buildApiUser({
        previous_usernames: ['', '   ', '  oldname  ', 'CurrentName'],
      })
    );

    await service.fetchAndPersist(OSU_ID);

    expect(previousUsernamesOf(updates)).toEqual(['oldname']);
  });

  it('clears the column when the API omits the field', async () => {
    const { service, updates } = createHarness(buildApiUser({}));

    await service.fetchAndPersist(OSU_ID);

    expect(previousUsernamesOf(updates)).toEqual([]);
  });
});

// The mock above, whose constructor takes just a message.
const APIError = (await import('../../client')).APIError as unknown as new (
  message: string
) => Error;

describe('PlayerFetchService restricted players', () => {
  // osu! answers 404 for a restricted player's profile.
  const notFound = () =>
    Promise.reject(
      Object.assign(new APIError('Not found'), {
        response: { status_code: 404 },
      })
    );

  const fetchWith = async (
    getUser: () => Promise<unknown>,
    statusBefore: number = DataFetchStatus.Fetching
  ) => {
    const updates: PlayerUpdate[] = [];
    const db = {
      query: {
        players: {
          findFirst: async () => ({
            id: PLAYER_ID,
            dataFetchStatus: statusBefore,
          }),
        },
      },
      update: () => ({
        set: (values: PlayerUpdate) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      }),
      insert: () => ({
        values: () => ({ onConflictDoUpdate: async () => undefined }),
      }),
    } as unknown as DatabaseClient;

    const service = new PlayerFetchService({
      db,
      api: { getUser } as unknown as API,
      rateLimiter: {
        schedule: <T>(task: () => Promise<T>) => task(),
      } as unknown as RateLimiter,
      logger: createLogger(),
    });

    const fetched = await service.fetchAndPersist(OSU_ID);
    return { fetched, updates, last: updates.at(-1) };
  };

  it('marks the player restricted when osu! returns not found', async () => {
    const { fetched, last } = await fetchWith(notFound);

    expect(fetched).toBe(false);
    expect(last).toMatchObject({
      dataFetchStatus: DataFetchStatus.NotFound,
      restricted: true,
    });
  });

  it('clears the restricted flag when a fetch succeeds', async () => {
    const { fetched, last } = await fetchWith(async () => buildApiUser({}));

    expect(fetched).toBe(true);
    expect(last).toMatchObject({
      dataFetchStatus: DataFetchStatus.Fetched,
      restricted: false,
    });
  });

  it('keeps the restricted flag when a refetch fails another way', async () => {
    // A player last seen as not found, refetched while osu! refuses the
    // worker's credentials: the fetch starts, then ends in Error.
    const unauthorized = () =>
      Promise.reject(
        Object.assign(new APIError('Unauthorized'), {
          response: { status_code: 401 },
        })
      );

    const { fetched, updates } = await fetchWith(
      unauthorized,
      DataFetchStatus.NotFound
    );

    expect(fetched).toBe(false);
    expect(updates.map((update) => update.dataFetchStatus)).toEqual([
      DataFetchStatus.Fetching,
      DataFetchStatus.Error,
    ]);
    expect(updates.filter((update) => 'restricted' in update)).toEqual([]);
  });
});
