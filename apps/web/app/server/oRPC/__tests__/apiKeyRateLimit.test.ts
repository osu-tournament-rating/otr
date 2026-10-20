import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test';
import { call } from '@orpc/server';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';
import {
  getSession,
  useFakeOsuUser,
  type CookieJar,
} from '@/lib/auth/osu-sign-in.test-utils';

import { generateUserApiKey } from '../procedures/apiKeyProcedures';
import { publicProcedure } from '../procedures/base';

// Keys are verified through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

const SECOND = 1000;

const probe = publicProcedure.handler(() => 'ok');

describe.skipIf(!enabled)('an API key’s 60 requests a minute', () => {
  const osuUser = useFakeOsuUser();

  let cookies: CookieJar;
  let userId: string;
  let key: string;
  let start: number;

  /** A REST API request with the key, `offset` after the first. */
  const requestAt = (offset: number) => {
    setSystemTime(new Date(start + offset));
    return call(probe, undefined, {
      context: {
        headers: new Headers({ authorization: `Bearer ${key}` }),
        apiKeyRequired: true,
      },
    }).catch((error: unknown) => error);
  };

  beforeAll(async () => {
    ({ cookies } = await osuUser.signIn());
    userId = (await getSession(cookies))!.user.id;
  });

  beforeEach(async () => {
    await db
      .delete(schema.apiKeys)
      .where(eq(schema.apiKeys.referenceId, userId));

    const cookie = [...cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    ({ key } = await call(
      generateUserApiKey,
      { name: 'rate limit' },
      { context: { headers: new Headers({ cookie }) } }
    ));
    start = Date.now();
  });

  afterEach(() => {
    setSystemTime();
  });

  test('are counted per minute for a client that never pauses', async () => {
    const refused: number[] = [];

    // One request every 2 seconds for 3 minutes: 30 a minute
    for (let request = 0; request < 90; request++) {
      if ((await requestAt(request * 2 * SECOND)) !== 'ok') {
        refused.push(request + 1);
      }
    }

    expect(refused).toEqual([]);
  });

  test('refuse the 61st request in a minute until the next minute', async () => {
    for (let request = 0; request < 60; request++) {
      expect(await requestAt(request * 500)).toBe('ok');
    }

    expect(await requestAt(30 * SECOND)).toMatchObject({
      status: 429,
      data: { code: 'RATE_LIMITED', tryAgainIn: 30 * SECOND },
    });
    expect(await requestAt(60 * SECOND)).toBe('ok');
  });

  // The Terms of Use offer a higher limit on request
  test('follow a limit raised on the key', async () => {
    await db
      .update(schema.apiKeys)
      .set({ rateLimitMax: 120 })
      .where(eq(schema.apiKeys.referenceId, userId));

    for (let request = 0; request < 120; request++) {
      expect(await requestAt(request * 250)).toBe('ok');
    }

    expect(await requestAt(30 * SECOND)).toMatchObject({ status: 429 });
  });
});
