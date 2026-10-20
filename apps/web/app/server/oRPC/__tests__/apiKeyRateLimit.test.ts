import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
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

import {
  generateUserApiKey,
  getUserApiKeys,
} from '../procedures/apiKeyProcedures';
import { publicProcedure } from '../procedures/base';

// Keys are verified through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

const SECOND = 1000;

const probe = publicProcedure.handler(() => 'ok');

// The Terms of Use promise a regular user's key 60 requests a minute, and the
// settings page shows an admin's key 1,000
describe.skipIf(!enabled)('an API key’s requests a minute', () => {
  const osuUser = useFakeOsuUser();

  let cookies: CookieJar;
  let userId: string;
  let playerId: number;
  let regularScopes: string[];
  let key: string;
  let start: number;

  const setOwnerScopes = (scopes: string[]) =>
    db
      .update(schema.users)
      .set({ scopes })
      .where(eq(schema.users.playerId, playerId));

  /** The owner's browser session, for the settings page's procedures. */
  const sessionContext = () => ({
    context: {
      headers: new Headers({
        cookie: [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      }),
    },
  });

  /** Replaces the owner's keys with one new key, and returns what it shows. */
  const replaceKey = async () => {
    await db
      .delete(schema.apiKeys)
      .where(eq(schema.apiKeys.referenceId, userId));

    const created = await call(
      generateUserApiKey,
      { name: 'rate limit' },
      sessionContext()
    );
    key = created.key;
    return created;
  };

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

  const storedRequestCount = async () => {
    const [row] = await db
      .select({ requestCount: schema.apiKeys.requestCount })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.referenceId, userId));
    return row?.requestCount;
  };

  beforeAll(async () => {
    ({ cookies } = await osuUser.signIn());
    ({ id: userId, playerId } = (await getSession(cookies))!.user);

    const [owner] = await db
      .select({ scopes: schema.users.scopes })
      .from(schema.users)
      .where(eq(schema.users.playerId, playerId));
    regularScopes = owner!.scopes;
  });

  beforeEach(async () => {
    await setOwnerScopes(regularScopes);
    await replaceKey();
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

  test('refuse a regular user’s 61st request in a minute until the next minute', async () => {
    for (let request = 0; request < 60; request++) {
      expect(await requestAt(request * 500)).toBe('ok');
    }

    expect(await requestAt(30 * SECOND)).toMatchObject({
      status: 429,
      data: { code: 'RATE_LIMITED', tryAgainIn: 30 * SECOND },
    });
    expect(await requestAt(60 * SECOND)).toBe('ok');
  });

  // A client that floods its key costs no more than verifying the key
  test('refuse requests over the limit without looking up the key’s owner', async () => {
    const findOwner = spyOn(db.query.auth_users, 'findFirst');

    try {
      expect(countAllowed(await burstAt(0, 60))).toBe(60);
      expect(findOwner).toHaveBeenCalledTimes(60);

      expect(countAllowed(await burstAt(SECOND, 100))).toBe(0);
      expect(findOwner).toHaveBeenCalledTimes(60);
    } finally {
      findOwner.mockRestore();
    }
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

  test('follow a limit raised on the key while its minute is full', async () => {
    expect(countAllowed(await burstAt(0, 61))).toBe(60);

    await db
      .update(schema.apiKeys)
      .set({ rateLimitMax: 120 })
      .where(eq(schema.apiKeys.referenceId, userId));

    expect(await requestAt(30 * SECOND)).toBe('ok');
  });

  // The key was made before its owner became an admin
  test('let an admin’s key send 1,000 requests a minute', async () => {
    await setOwnerScopes(['admin']);

    expect(countAllowed(await burstAt(0, 1000))).toBe(1000);
    expect(await requestAt(30 * SECOND)).toMatchObject({
      status: 429,
      data: { code: 'RATE_LIMITED', tryAgainIn: 30 * SECOND },
    });
  });

  test('hold a key to 60 again once its owner stops being an admin', async () => {
    await setOwnerScopes(['admin']);
    await replaceKey();
    await setOwnerScopes(regularScopes);

    expect(countAllowed(await burstAt(0, 60))).toBe(60);
    expect(await requestAt(30 * SECOND)).toMatchObject({ status: 429 });
  });

  test('keep a limit raised above 1,000 on an admin’s key', async () => {
    await setOwnerScopes(['admin']);
    await db
      .update(schema.apiKeys)
      .set({ rateLimitMax: 1010 })
      .where(eq(schema.apiKeys.referenceId, userId));

    expect(countAllowed(await burstAt(0, 1010))).toBe(1010);
    expect(await requestAt(30 * SECOND)).toMatchObject({ status: 429 });
  });

  // The settings page shows each key's limit from these
  test('show an admin’s key at 1,000 requests a minute when made and listed', async () => {
    await setOwnerScopes(['admin']);
    const adminLimit = { rateLimitMax: 1000, rateLimitTimeWindow: 60 * SECOND };

    expect(await replaceKey()).toMatchObject(adminLimit);
    expect(await call(getUserApiKeys, undefined, sessionContext())).toEqual([
      expect.objectContaining(adminLimit),
    ]);
  });

  // The admin dashboard lists each key's requests
  test('store how many requests the key sent in its current minute', async () => {
    for (let request = 0; request < 3; request++) {
      expect(await requestAt(request * SECOND)).toBe('ok');
    }
    expect(await storedRequestCount()).toBe(3);

    expect(await requestAt(60 * SECOND)).toBe('ok');
    expect(await storedRequestCount()).toBe(1);
  });
});
