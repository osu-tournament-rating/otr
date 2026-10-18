import { describe, expect, test } from 'bun:test';

import { getSession, useFakeOsuUser } from '../osu-sign-in.test-utils';

// Signing up writes through DATABASE_URL, so this runs only when that is the
// disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

describe.skipIf(!enabled)('osu! sign-up', () => {
  const osuUser = useFakeOsuUser();

  const signInWithOsu = async () => {
    const { cookies, location } = await osuUser.signIn();
    expect(location).not.toContain('error=');

    const session = await getSession(cookies);
    expect(session).not.toBeNull();
    return session!;
  };

  test('a new osu! user signs up, then signs back in to the same account', async () => {
    const signUp = await signInWithOsu();
    expect(signUp.user.osuId).toBe(osuUser.osuId);
    expect(signUp.dbPlayer?.username).toBe(osuUser.username);
    expect(signUp.user.playerId).toBe(signUp.dbPlayer!.id);

    const signIn = await signInWithOsu();
    expect(signIn.user.id).toBe(signUp.user.id);
  });
});
