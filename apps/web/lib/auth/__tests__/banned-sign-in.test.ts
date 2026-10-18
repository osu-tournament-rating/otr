import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import { getSession, useFakeOsuUser } from '../osu-sign-in.test-utils';

// Signing up writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

describe.skipIf(!enabled)('banned sign-in', () => {
  const osuUser = useFakeOsuUser();

  test('a banned user is sent to the banned page without a session', async () => {
    const signUp = await osuUser.signIn();
    const session = await getSession(signUp.cookies);

    await db
      .update(schema.auth_users)
      .set({ banned: true, banReason: 'API abuse' })
      .where(eq(schema.auth_users.id, session!.user.id));

    const { cookies, location } = await osuUser.signIn();
    const redirect = new URL(location, 'http://localhost');
    expect(redirect.pathname).toBe('/auth/banned');
    expect(redirect.searchParams.get('reason')).toBe('API abuse');
    expect(await getSession(cookies)).toBeNull();
  });
});
