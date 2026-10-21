import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { call, ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';

import { generateUserApiKey } from '@/app/server/oRPC/procedures/apiKeyProcedures';
import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import {
  getSession,
  postAuthJson,
  useFakeOsuUser,
  type CookieJar,
} from '../osu-sign-in.test-utils';

// Signing up writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

describe.skipIf(!enabled)('the three API keys a user may hold', () => {
  const osuUser = useFakeOsuUser();

  let cookies: CookieJar;
  let userId: string;

  const keyCount = () =>
    db.$count(schema.apiKeys, eq(schema.apiKeys.referenceId, userId));

  /** Creates a key as the settings page does. */
  const createKey = (name: string) =>
    call(
      generateUserApiKey,
      { name },
      {
        context: {
          headers: new Headers({
            cookie: [...cookies]
              .map(([cookie, value]) => `${cookie}=${value}`)
              .join('; '),
          }),
        },
      }
    );

  beforeAll(async () => {
    ({ cookies } = await osuUser.signIn());
    userId = (await getSession(cookies))!.user.id;
  });

  beforeEach(async () => {
    await db
      .delete(schema.apiKeys)
      .where(eq(schema.apiKeys.referenceId, userId));
  });

  test('cannot be added to through the auth endpoint', async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await postAuthJson(cookies, '/api-key/create', {
        name: `direct ${attempt}`,
      });
      expect(response.status).toBe(404);
    }

    expect(await keyCount()).toBe(0);
  });

  test('stop at three when the settings page creates several at once', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) => createKey(`at once ${index}`))
    );
    const refusals = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    );

    expect(refusals).toHaveLength(3);
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(ORPCError);
      expect(refusal).toMatchObject({
        code: 'CONFLICT',
        message: 'You can create up to 3 API keys',
      });
    }
    expect(await keyCount()).toBe(3);
  });
});
