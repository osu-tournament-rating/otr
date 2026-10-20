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

// The Terms of Use and the settings page promise each key 1,000 a minute
describe.skipIf(!enabled)('an API key’s 1,000 requests a minute', () => {
  const osuUser = useFakeOsuUser();

  let cookies: CookieJar;
  let userId: string;
  let key: string;
  let start: number;

  /** `count` REST API requests with the key at once, `offset` after the first. */
  const burstAt = (offset: number, count: number) => {
    setSystemTime(new Date(start + offset));
    return Promise.all(
      Array.from({ length: count }, () =>
        call(probe, undefined, {
          context: {
            headers: new Headers({ authorization: `Bearer ${key}` }),
            apiKeyRequired: true,
          },
        }).catch((error: unknown) => error)
      )
    );
  };

  const requestAt = async (offset: number) => (await burstAt(offset, 1))[0];

  const countAllowed = (results: unknown[]) =>
    results.filter((result) => result === 'ok').length;

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

    // 85 requests every 10 seconds for 2 minutes: 510 a minute, 1,020 in all
    for (let burst = 0; burst < 12; burst++) {
      const results = await burstAt(burst * 10 * SECOND, 85);
      results.forEach((result, index) => {
        if (result !== 'ok') {
          refused.push(burst * 85 + index + 1);
        }
      });
    }

    expect(refused).toEqual([]);
  });

  test('refuse the 1,001st request in a minute until the next minute', async () => {
    expect(countAllowed(await burstAt(0, 1000))).toBe(1000);

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
      .set({ rateLimitMax: 1010 })
      .where(eq(schema.apiKeys.referenceId, userId));

    expect(countAllowed(await burstAt(0, 1010))).toBe(1010);
    expect(await requestAt(30 * SECOND)).toMatchObject({ status: 429 });
  });
});
