import { describe, expect, test } from 'bun:test';
import { call, ORPCError } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';
import {
  getSession,
  useFakeOsuUser,
  type CookieJar,
} from '@/lib/auth/osu-sign-in.test-utils';

import { deleteMyAccount } from '../userProcedures';

// Signing up and deleting write through DATABASE_URL, so this runs only when
// that is the disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

describe.skipIf(!enabled)('deleting your account', () => {
  const osuUser = useFakeOsuUser();

  const signIn = async () => {
    const { cookies } = await osuUser.signIn();
    const userId = (await getSession(cookies))!.user.id;
    return { cookies, userId };
  };

  const deleteAs = (cookies: CookieJar) =>
    call(deleteMyAccount, undefined, {
      context: {
        headers: new Headers({
          cookie: [...cookies]
            .map(([name, value]) => `${name}=${value}`)
            .join('; '),
        }),
      },
    }).catch((error: unknown) => error);

  const authUserExists = async (userId: string) =>
    (await db.$count(schema.auth_users, eq(schema.auth_users.id, userId))) > 0;

  test('asks a player who logged in over a day ago to log in again', async () => {
    const { cookies, userId } = await signIn();
    await db
      .update(schema.auth_sessions)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(schema.auth_sessions.userId, userId));

    const error = await deleteAs(cookies);

    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      message:
        'Deleting your account needs a log in from the last day. Log out and log back in, then try again.',
      data: { code: 'SESSION_NOT_FRESH' },
    });
    expect(await authUserExists(userId)).toBe(true);
  });

  test('deletes the account of a player who just logged in', async () => {
    const { cookies, userId } = await signIn();

    expect(await deleteAs(cookies)).toEqual({ success: true });
    expect(await authUserExists(userId)).toBe(false);
  });
});
