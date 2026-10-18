import { expect, type Page, type Response } from '@playwright/test';

import { FAKE_OSU_URL, FAKE_OSU_USER_COOKIE } from './fake-osu';
import { ROUTES } from './test-config';

/**
 * Clicks Log in on the home page and answers on the fake osu! as `fakeUser`:
 * an osu! user id, or one of `FAKE_OSU_FAILURE`. Resolves with the OAuth
 * callback's redirect once the browser is back on the site.
 */
export async function logInWithFakeOsu(
  page: Page,
  fakeUser: number | string
): Promise<Response> {
  await page.context().addCookies([
    {
      name: FAKE_OSU_USER_COOKIE,
      value: String(fakeUser),
      url: FAKE_OSU_URL,
    },
  ]);
  await page.goto(ROUTES.home);
  await page.waitForLoadState('networkidle');

  const callback = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/callback/osu'
  );
  // Every hop through osu! and the callback is a redirect, so the next page
  // the tab commits is the one the callback sent it back to.
  const returned = page.waitForEvent(
    'framenavigated',
    (frame) => frame === page.mainFrame()
  );
  await page
    .getByRole('button', { name: 'Log in', exact: true })
    .first()
    .click();

  const response = await callback;
  expect(response.status(), 'the OAuth callback should redirect').toBe(302);
  await returned;
  return response;
}
