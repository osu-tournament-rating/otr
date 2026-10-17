import { expect, test, type Page } from '@playwright/test';

import {
  E2E_DELETE_PLAYER_PATH,
  E2E_FAKE_OSU_ID_FLOOR,
} from '../lib/auth/e2e-auth';
import { fakeOsuUsername } from './fixtures/fake-osu';
import { logInWithFakeOsu } from './fixtures/osu-login';

// Every run signs up a user the database has never seen.
const newOsuId = () =>
  E2E_FAKE_OSU_ID_FLOOR + Math.floor(Math.random() * 1_000_000_000);

type SessionBody = {
  user: { id: string; osuId: number; playerId: number };
  dbPlayer: { id: number; osuId: number; username: string } | null;
};

/** Signs in through the osu! OAuth callback, with the fake osu! as osuId. */
async function signInWithOsu(page: Page, osuId: number): Promise<SessionBody> {
  const response = await logInWithFakeOsu(page, osuId);
  expect(
    response.headers()['location'],
    'the OAuth callback redirected with an error'
  ).not.toContain('error=');
  await expect(
    page.locator('[data-testid="account-menu-trigger"]')
  ).toBeVisible({ timeout: 15000 });

  // Better Auth rate-limits by IP, and parallel workers share localhost.
  let session: SessionBody | undefined;
  await expect(async () => {
    const sessionResponse = await page.request.get('/api/auth/get-session');
    expect(sessionResponse.status()).toBe(200);
    session = await sessionResponse.json();
  }).toPass({ timeout: 15000 });
  return session!;
}

test.describe('Registration', () => {
  const osuId = newOsuId();

  test.afterEach(async ({ request }) => {
    const response = await request.post(E2E_DELETE_PLAYER_PATH, {
      data: { osuId },
    });
    expect(response.ok()).toBe(true);
  });

  test('a new osu! user signs up, then signs back in to the same account', async ({
    page,
    context,
  }) => {
    const signUp = await signInWithOsu(page, osuId);
    expect(signUp.user.osuId).toBe(osuId);
    expect(signUp.dbPlayer?.osuId).toBe(osuId);
    expect(signUp.dbPlayer?.username).toBe(fakeOsuUsername(osuId));
    expect(signUp.user.playerId).toBe(signUp.dbPlayer!.id);

    await context.clearCookies();

    const signIn = await signInWithOsu(page, osuId);
    expect(signIn.user.id).toBe(signUp.user.id);
    expect(signIn.user.playerId).toBe(signUp.user.playerId);
  });
});
