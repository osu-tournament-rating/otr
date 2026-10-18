import { expect, test } from '@playwright/test';

import { FAKE_OSU_FAILURE } from './fixtures/fake-osu';
import { logInWithFakeOsu } from './fixtures/osu-login';
import { ROUTES } from './fixtures/test-config';

const FAILURE_TOAST = "Couldn't log in with osu!";

test.describe('Log in failures', () => {
  test('a failed log in shows an error toast', async ({ page }) => {
    await logInWithFakeOsu(page, FAKE_OSU_FAILURE.apiDown);

    await expect(page.getByText(FAILURE_TOAST)).toBeVisible({
      timeout: 15000,
    });
    await expect(page).not.toHaveURL(/[?&]error=/);
    await expect(
      page.getByRole('button', { name: 'Log in', exact: true }).first()
    ).toBeVisible();
  });

  test('a link carrying an error shows no toast', async ({ page }) => {
    await page.goto(
      `${ROUTES.home}?error=x&error_description=Your+account+was+flagged`
    );
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(FAILURE_TOAST)).toHaveCount(0);
    await expect(page.getByText('Your account was flagged')).toHaveCount(0);
  });

  test('cancelling on osu! shows no toast', async ({ page }) => {
    await logInWithFakeOsu(page, FAKE_OSU_FAILURE.cancel);

    // The address losing the error shows the failure has been handled.
    await expect(page).not.toHaveURL(/[?&]error=/, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(FAILURE_TOAST)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Log in', exact: true }).first()
    ).toBeVisible();
  });
});
