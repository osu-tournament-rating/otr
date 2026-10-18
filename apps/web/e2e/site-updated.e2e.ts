import { expect, test } from '@playwright/test';

import { BUILD_ID_HEADER } from '../lib/build-id';

/**
 * A tab left open across a release offers a reload. Most pages make no /rpc
 * calls from the tab, so the tab asks /api/health for the site's build; these
 * tests answer that check themselves.
 */

const UPDATED_NOTICE = 'o!TR has been updated';

const answerHealthAs = (build: string) => ({
  status: 200,
  headers: { [BUILD_ID_HEADER]: build },
  body: 'OK',
});

test.describe('Site updated notice', () => {
  test('stays on screen until the tab reloads onto the current release', async ({
    page,
  }) => {
    await page.route('**/api/health', (route) =>
      route.fulfill(answerHealthAs('another-release'))
    );
    await page.goto('/tournaments');

    const notice = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: UPDATED_NOTICE });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-dismissible', 'false');
    await expect(notice.getByRole('button', { name: /close/i })).toHaveCount(0);

    await page.unroute('**/api/health');
    const recheck = page.waitForResponse('**/api/health');
    await notice.getByRole('button', { name: 'Reload' }).click();
    expect((await recheck).headers()[BUILD_ID_HEADER]).toBeTruthy();
    await expect(notice).toHaveCount(0);
  });
});
