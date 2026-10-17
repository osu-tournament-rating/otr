import { readFileSync } from 'node:fs';

import { test, expect } from '@playwright/test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

import { BUILD_ID, BUILD_ID_HEADER } from '../lib/build-id';
import { STORAGE_STATE } from './fixtures/auth';
import { ROUTES } from './fixtures/test-config';

/**
 * Coverage for `/tools/filter` and the public `/tools/filter-reports` lookup.
 * Submitting the filter form writes a report and publishes queue messages, so
 * these specs never submit it.
 */

test.describe('Tournament Registrant Filtering', () => {
  test.describe('Unauthenticated access', () => {
    test('/tools/filter redirects to /unauthorized when signed out', async ({
      page,
    }) => {
      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveURL(/\/unauthorized/, { timeout: 10000 });
    });
  });

  test.describe('Signed-in user', () => {
    test.use({ storageState: STORAGE_STATE.user });

    test('renders the filtering form with its key inputs and submit button', async ({
      page,
    }) => {
      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="filter-form"]')).toBeVisible({
        timeout: 10000,
      });

      await expect(page.locator('[data-testid="filter-ruleset"]')).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator('[data-testid="filter-minRating"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="filter-maxRating"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="filter-player-ids"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="filter-submit-button"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('displays the page heading', async ({ page }) => {
      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('heading', {
          name: 'Tournament registrant filtering',
          exact: true,
        })
      ).toBeVisible({ timeout: 10000 });
    });

    test('selecting a ruleset updates the trigger label', async ({ page }) => {
      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      const ruleset = page.locator('[data-testid="filter-ruleset"]');
      await expect(ruleset).toBeVisible({ timeout: 10000 });
      await ruleset.click();

      const option = page.getByRole('option', { name: 'osu!', exact: true });
      if (await option.isVisible({ timeout: 10000 }).catch(() => false)) {
        await option.click();
        await expect(ruleset).toContainText('osu!', { timeout: 10000 });
      }
    });

    test('an empty form reports each field rule without submitting', async ({
      page,
    }) => {
      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="filter-submit-button"]').click();

      const form = page.locator('[data-testid="filter-form"]');
      await expect(form.getByText('Ruleset is required')).toBeVisible({
        timeout: 10000,
      });
      await expect(
        form.getByText('A minimum or maximum rating is required')
      ).toBeVisible();
      await expect(
        form.getByText('At least one osu! player ID is required')
      ).toBeVisible();
      await expect(page.locator('[data-testid="filter-results"]')).toHaveCount(
        0
      );
    });

    test('rating bounds are checked as whole numbers in range', async ({
      page,
    }) => {
      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      const min = page.locator('[data-testid="filter-minRating"]');
      await expect(min).toBeVisible({ timeout: 10000 });
      await min.fill('50');
      await expect(
        page.getByText('Minimum rating must be at least 100')
      ).toBeVisible();
      await min.fill('500.5');
      await expect(
        page.getByText('Minimum rating must be a whole number')
      ).toBeVisible();
    });

    test('player IDs textarea accepts input', async ({ page }) => {
      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      const textarea = page.locator('[data-testid="filter-player-ids"]');
      await expect(textarea).toBeVisible({ timeout: 10000 });
      await textarea.fill('1234567, 2345678');
      await expect(textarea).toHaveValue('1234567, 2345678');
    });
  });
});

test.describe('Filtering during the maintenance window', () => {
  test.describe('Signed-in user', () => {
    test.use({ storageState: STORAGE_STATE.user });

    test('shows only the unavailable notice during the window', async ({
      page,
    }) => {
      await page.setExtraHTTPHeaders({
        'x-e2e-maintenance-window': 'active',
      });

      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="filtering-unavailable"]')
      ).toContainText('Filtering is temporarily unavailable', {
        timeout: 10000,
      });
      // The outage notice takes the compliance rules' place.
      await expect(
        page.locator('[data-testid="filtering-compliance"]')
      ).toHaveCount(0);
      await expect(page.locator('[data-testid="filter-form"]')).toHaveCount(0);
    });

    test('shows the form outside the window', async ({ page }) => {
      await page.setExtraHTTPHeaders({
        'x-e2e-maintenance-window': 'inactive',
      });

      await page.goto(ROUTES.filter);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="filter-form"]')).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator('[data-testid="filtering-compliance"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="filtering-unavailable"]')
      ).toHaveCount(0);
    });
  });

  test('rejects filter submissions during the window with a 503', async ({
    baseURL,
  }) => {
    // The gate runs before any lookup or write, so nothing is ever persisted.
    const state = JSON.parse(readFileSync(STORAGE_STATE.user, 'utf-8')) as {
      cookies: Array<{ name: string; value: string }>;
    };
    const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const link = new RPCLink({
      url: `${baseURL}/rpc`,
      headers: () => ({
        cookie,
        [BUILD_ID_HEADER]: BUILD_ID,
        'x-e2e-maintenance-window': 'active',
      }),
    });
    const client = createORPCClient(link) as unknown as {
      filtering: {
        filter(input: {
          ruleset: number;
          osuPlayerIds: number[];
        }): Promise<unknown>;
      };
    };

    type CapturedError = { code?: string; data?: { code?: string } };
    let captured: CapturedError | null = null;

    try {
      await client.filtering.filter({ ruleset: 0, osuPlayerIds: [1] });
    } catch (error) {
      captured = error as CapturedError;
    }

    expect(captured).not.toBeNull();
    expect(captured?.code).toBe('SERVICE_UNAVAILABLE');
    expect(captured?.data?.code).toBe('MAINTENANCE_WINDOW');
  });
});

test.describe('Filter Reports', () => {
  test.describe('Public access', () => {
    test('is reachable without authentication', async ({ page }) => {
      await page.goto(ROUTES.filterReports);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain('/tools/filter-reports');

      await expect(
        page.getByRole('heading', { name: 'Filter reports', exact: true })
      ).toBeVisible({ timeout: 10000 });
    });

    test('renders the report-id input and submit button', async ({ page }) => {
      await page.goto(ROUTES.filterReports);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="filter-report-view"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="filter-report-id-input"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="filter-report-submit"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('nonexistent report id goes in the address and says so', async ({
      page,
    }) => {
      await page.goto(ROUTES.filterReports);
      await page.waitForLoadState('networkidle');

      const input = page.locator('[data-testid="filter-report-id-input"]');
      await expect(input).toBeVisible({ timeout: 10000 });
      // A valid but almost-certainly-nonexistent report id
      await input.fill('2147483647');
      await page.locator('[data-testid="filter-report-submit"]').click();

      await expect(page).toHaveURL(/[?&]report=2147483647/, {
        timeout: 10000,
      });
      await expect(
        page.locator('[data-testid="filter-report-not-found"]')
      ).toContainText('Filter report does not exist', { timeout: 10000 });
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('2147483647');
    });

    test('a report id in the address loads on arrival', async ({ page }) => {
      await page.goto(`${ROUTES.filterReports}?report=2147483647`);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="filter-report-id-input"]')
      ).toHaveValue('2147483647', { timeout: 10000 });
      await expect(
        page.locator('[data-testid="filter-report-not-found"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('invalid (non-numeric) report id shows a validation message', async ({
      page,
    }) => {
      await page.goto(ROUTES.filterReports);
      await page.waitForLoadState('networkidle');

      const input = page.locator('[data-testid="filter-report-id-input"]');
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill('not-a-number');
      await page.locator('[data-testid="filter-report-submit"]').click();

      await expect(
        page.locator('[data-testid="filter-report-view"]')
      ).toBeVisible({ timeout: 10000 });

      await expect(page.getByText('Report ID must be a number')).toBeVisible({
        timeout: 10000,
      });
      await expect(page).not.toHaveURL(/report=/);
    });
  });
});
