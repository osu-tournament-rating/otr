import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import { auth } from '../auth';
import {
  getSession,
  postAuthJson,
  sendAuthRequest,
  useFakeOsuUser,
  type CookieJar,
} from '../osu-sign-in.test-utils';

// Admin rights come only from `users.scopes`, through the site's own
// procedures. Better Auth's admin endpoints act on `auth_users.role`
// instead, so the auth handler must not serve them.
describe('auth admin endpoints', () => {
  test('none are served', () => {
    const paths = Object.values(auth.api).flatMap((endpoint) =>
      'path' in endpoint && typeof endpoint.path === 'string'
        ? [endpoint.path]
        : []
    );

    expect(paths).toContain('/update-user');
    expect(paths.filter((path) => path.startsWith('/admin'))).toEqual([]);
  });
});

// Signing up writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

describe.skipIf(!enabled)('a non-admin whose auth user has role admin', () => {
  const osuUser = useFakeOsuUser();
  // Another player, which the user tries to take over.
  const otherOsuId = osuUser.osuId + 1;

  let cookies: CookieJar;
  let userId: string;
  let playerId: number;
  let otherPlayerId: number;

  const storedPlayerId = async () => {
    const authUser = await db.query.auth_users.findFirst({
      columns: { playerId: true },
      where: eq(schema.auth_users.id, userId),
    });
    return authUser?.playerId;
  };

  beforeAll(async () => {
    ({ cookies } = await osuUser.signIn());
    const session = await getSession(cookies);
    userId = session!.user.id;
    playerId = session!.user.playerId;

    const appUser = await db.query.users.findFirst({
      where: eq(schema.users.playerId, playerId),
    });
    expect(appUser?.scopes ?? []).not.toContain('admin');

    // The role sign-in used to grant to admins, and never took back.
    await db
      .update(schema.auth_users)
      .set({ role: 'admin' })
      .where(eq(schema.auth_users.id, userId));

    const [otherPlayer] = await db
      .insert(schema.players)
      .values({ osuId: otherOsuId, username: `other-${otherOsuId}` })
      .returning({ id: schema.players.id });
    otherPlayerId = otherPlayer.id;
  });

  afterAll(async () => {
    await db.delete(schema.players).where(eq(schema.players.osuId, otherOsuId));
  });

  test.each([
    [
      '/admin/update-user',
      () => ({ userId, data: { playerId: otherPlayerId } }),
    ],
    ['/admin/set-role', () => ({ userId, role: 'superadmin' })],
    ['/admin/ban-user', () => ({ userId })],
    ['/admin/unban-user', () => ({ userId })],
    ['/admin/impersonate-user', () => ({ userId })],
    ['/admin/revoke-user-sessions', () => ({ userId })],
    ['/admin/remove-user', () => ({ userId })],
  ])('cannot reach %s', async (path, body) => {
    const response = await postAuthJson(cookies, path, body());
    expect(response.status).toBe(404);
  });

  test('cannot list users', async () => {
    const response = await sendAuthRequest(cookies, '/admin/list-users');
    expect(response.status).toBe(404);
  });

  test('cannot change their playerId', async () => {
    const response = await postAuthJson(cookies, '/update-user', {
      playerId: otherPlayerId,
    });
    expect(response.status).toBe(400);

    expect(await storedPlayerId()).toBe(playerId);
    expect((await getSession(cookies))?.user.playerId).toBe(playerId);
  });
});
