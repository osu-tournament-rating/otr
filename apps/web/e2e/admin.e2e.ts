import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { ReportEntityType } from '@otr/core/osu';
import { STORAGE_STATE, TEST_ADMIN_PLAYER_ID } from './fixtures/auth';
import { createOrpcClientForRole } from './fixtures/orpc';
import { ROUTES, TEST_TOURNAMENT_ID } from './fixtures/test-config';
import { ADMIN_REPORTS_PAGE_SIZE } from '../app/admin/reports/list-params';

/** Files a pending report on the test tournament as the regular user. */
async function createTournamentReport(): Promise<number> {
  const userClient = createOrpcClientForRole('user');
  const { templates } = await userClient.reports.templates({
    entityType: ReportEntityType.Tournament,
  });
  const template = templates.at(0);
  if (!template) {
    throw new Error('No tournament report templates were returned');
  }

  const { reportId } = await userClient.reports.create({
    entityType: ReportEntityType.Tournament,
    entityId: TEST_TOURNAMENT_ID,
    reasonKey: template.key,
    additionalInformation: `E2E admin queue ${randomUUID()}`,
  });
  if (!reportId) {
    throw new Error('The test report was not created');
  }
  return reportId;
}

/**
 * Admin dashboard and reports pages. The reports tests file their own
 * pending reports as the regular user; nothing else writes.
 */
test.describe('Admin pages', () => {
  test.describe('Admin role', () => {
    test.use({ storageState: STORAGE_STATE.admin });

    test.describe('Dashboard', () => {
      test('renders heading and main tool cards', async ({ page }) => {
        await page.goto(ROUTES.admin);
        await page.waitForLoadState('networkidle');

        await expect(
          page.locator('[data-testid="admin-dashboard"]')
        ).toBeVisible({ timeout: 10000 });

        const heading = page.locator('[data-testid="admin-heading"]');
        await expect(heading).toBeVisible({ timeout: 10000 });
        await expect(heading).toHaveText('Admin');

        await expect(
          page.locator('[data-testid="admin-tool-user-lookup"]')
        ).toBeVisible({ timeout: 10000 });
        await expect(
          page.locator('[data-testid="admin-tool-mass-enqueue"]')
        ).toBeVisible({ timeout: 10000 });
      });

      test('user lookup suggests players as you type', async ({ page }) => {
        // The admin's own account: setup signed it in, so lookup finds it.
        const { username } = await createOrpcClientForRole('admin').players.get(
          { id: TEST_ADMIN_PLAYER_ID }
        );

        await page.goto(ROUTES.admin);
        await page.waitForLoadState('networkidle');

        const lookup = page.getByTestId('admin-tool-user-lookup');
        await lookup.getByLabel('Username').fill(username);
        await page
          .getByRole('option')
          .filter({ has: page.getByText(username, { exact: true }) })
          .click();
        await expect(
          lookup.getByRole('link', { name: username, exact: true })
        ).toBeVisible();
      });

      test('the ban dialog names its reason group', async ({ page }) => {
        // The admin's own account: setup signed it in, so lookup finds it.
        // Cancelling leaves it unbanned.
        const { username } = await createOrpcClientForRole('admin').players.get(
          { id: TEST_ADMIN_PLAYER_ID }
        );

        await page.goto(ROUTES.admin);
        await page.waitForLoadState('networkidle');

        const lookup = page.getByTestId('admin-tool-user-lookup');
        await lookup.getByLabel('Username').fill(username);
        await page
          .getByRole('option')
          .filter({ has: page.getByText(username, { exact: true }) })
          .click();
        await lookup
          .getByRole('button', { name: /^(Ban user|Update ban reason)$/ })
          .click();

        const dialog = page.getByRole('alertdialog', {
          name: 'Ban this user?',
        });
        const reasons = dialog.getByRole('radiogroup', { name: 'Ban reason' });
        await expect(reasons).toBeVisible();
        expect(await reasons.getByRole('radio').count()).toBeGreaterThan(0);

        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      });
    });

    test.describe('Reports', () => {
      test('renders heading and reports card for an admin', async ({
        page,
      }) => {
        await page.goto(ROUTES.adminReports);
        await page.waitForLoadState('networkidle');

        await expect(page.locator('[data-testid="admin-reports"]')).toBeVisible(
          {
            timeout: 10000,
          }
        );

        const heading = page.locator('[data-testid="admin-reports-heading"]');
        await expect(heading).toBeVisible({ timeout: 10000 });
        await expect(heading).toHaveText('Data reports');

        await expect(
          page.locator('[data-testid="admin-reports-card"]')
        ).toBeVisible({ timeout: 10000 });
      });

      test('renders either a reports list or an empty state', async ({
        page,
      }) => {
        await page.goto(ROUTES.adminReports);
        await page.waitForLoadState('networkidle');

        const list = page.locator('[data-testid="admin-reports-list"]');
        const empty = page.locator('[data-testid="admin-reports-empty"]');

        const hasList = await list
          .isVisible({ timeout: 15000 })
          .catch(() => false);

        if (hasList) {
          const rows = page.locator('[data-testid="admin-reports-row"]');
          expect(await rows.count()).toBeGreaterThan(0);
        } else {
          await expect(empty).toBeVisible({ timeout: 10000 });
        }
      });

      test('the status switch filters the queue and stays in the address', async ({
        page,
      }) => {
        await page.goto(ROUTES.adminReports);
        await page.waitForLoadState('networkidle');

        const filter = page.locator(
          '[data-testid="admin-reports-status-filter"]'
        );
        await expect(filter).toBeVisible({ timeout: 10000 });

        for (const name of ['All', 'Pending', 'Confirmed', 'Dismissed']) {
          await expect(filter.getByRole('radio', { name })).toBeVisible();
        }
        await expect(filter.getByRole('radio', { name: 'All' })).toBeChecked();

        await filter.getByRole('radio', { name: 'Pending' }).click();
        await expect(page).toHaveURL(/[?&]status=0\b/, { timeout: 10000 });
        await expect(
          filter.getByRole('radio', { name: 'Pending' })
        ).toBeChecked();

        await page.reload();
        await page.waitForLoadState('networkidle');
        await expect(
          page
            .locator('[data-testid="admin-reports-status-filter"]')
            .getByRole('radio', { name: 'Pending' })
        ).toBeChecked({ timeout: 10000 });

        const rows = page.locator('[data-testid="admin-reports-row"]');
        const empty = page.locator('[data-testid="admin-reports-empty"]');
        await expect(rows.first().or(empty)).toBeVisible({ timeout: 15000 });
        const statuses = await rows
          .locator('[data-slot="report-status-badge"]')
          .allInnerTexts();
        expect(statuses.every((status) => status.trim() === 'Pending')).toBe(
          true
        );
      });

      test('the sort and page live in the address', async ({ page }) => {
        // Numbered pages appear only when the queue holds more than one page.
        const { totalCount } = await createOrpcClientForRole(
          'admin'
        ).reports.list({ page: 1, pageSize: 1 });
        for (let i = totalCount; i <= ADMIN_REPORTS_PAGE_SIZE; i++) {
          await createTournamentReport();
        }

        await page.goto(`${ROUTES.adminReports}?sort=resolvedAt&dir=asc`);
        await page.waitForLoadState('networkidle');

        await expect(
          page.getByRole('combobox', { name: 'Sort reports by' })
        ).toContainText('Date reviewed', { timeout: 10000 });
        await expect(
          page.getByRole('button', { name: 'Sort order is ascending' })
        ).toBeVisible();

        await page.goto(ROUTES.adminReports);
        await page.waitForLoadState('networkidle');

        const pages = page.getByRole('navigation', { name: 'Report pages' });
        const rows = page.locator('[data-testid="admin-reports-row"]');
        await expect(rows.first()).toBeVisible({ timeout: 15000 });
        await expect(pages).toBeVisible();

        const firstId = await rows.first().getAttribute('data-report-id');
        await pages.getByRole('link', { name: 'Page 2' }).click();
        await expect(page).toHaveURL(/[?&]page=2\b/, { timeout: 10000 });
        await expect(rows.first()).not.toHaveAttribute(
          'data-report-id',
          firstId ?? '',
          { timeout: 15000 }
        );
      });

      test('a report opens from its View button in the report details dialog', async ({
        page,
      }) => {
        const reportId = await createTournamentReport();

        await page.goto(ROUTES.adminReports);
        await page.waitForLoadState('networkidle');

        const row = page.locator(
          `[data-testid="admin-reports-row"][data-report-id="${reportId}"]`
        );
        await expect(row).toBeVisible({ timeout: 15000 });
        await row
          .getByRole('button', { name: `View report #${reportId}` })
          .click();

        const dialog = page.getByTestId('admin-report-detail');
        await expect(
          dialog.getByRole('heading', { name: 'Report details' })
        ).toBeVisible({ timeout: 10000 });
        await expect(dialog).toContainText(`Report #${reportId}`);

        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden({ timeout: 10000 });
      });

      test('a failed load shows an error with a retry, not an empty list', async ({
        page,
      }) => {
        await page.route('**/rpc/reports/list', (route) =>
          route.fulfill({ status: 500, body: 'Internal Server Error' })
        );
        await page.goto(ROUTES.adminReports);

        const card = page.locator('[data-testid="admin-reports-card"]');
        await expect(card.getByRole('alert')).toContainText(
          'Reports could not load',
          { timeout: 15000 }
        );
        await expect(
          page.locator('[data-testid="admin-reports-empty"]')
        ).toHaveCount(0);

        await page.unroute('**/rpc/reports/list');
        await card.getByRole('button', { name: 'Try again' }).click();

        await expect(card.getByRole('alert')).toHaveCount(0, {
          timeout: 15000,
        });
        await expect(
          page.locator(
            '[data-testid="admin-reports-list"], [data-testid="admin-reports-empty"]'
          )
        ).toBeVisible({ timeout: 15000 });
      });

      test('a report entity link navigates to its entity page', async ({
        page,
      }) => {
        const reportId = await createTournamentReport();
        const href = ROUTES.tournament(TEST_TOURNAMENT_ID);

        await page.goto(ROUTES.adminReports);
        await page.waitForLoadState('networkidle');

        const entityLink = page
          .locator(
            `[data-testid="admin-reports-row"][data-report-id="${reportId}"]`
          )
          .getByTestId('admin-reports-entity-link');
        await expect(entityLink).toHaveAttribute('href', href, {
          timeout: 15000,
        });

        await entityLink.click();
        await expect(page).toHaveURL(href, { timeout: 15000 });
      });
    });

    test.describe('Design reference', () => {
      test('renders every gallery section without page errors', async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));

        await page.goto(ROUTES.adminDesign);
        await page.waitForLoadState('networkidle');

        await expect(
          page.getByRole('heading', { level: 1, name: 'Design reference' })
        ).toBeVisible({ timeout: 15000 });
        for (const section of [
          'layout',
          'status',
          'color',
          'lists',
          'tables',
          'feedback',
          'controls',
          'format',
        ]) {
          await expect(
            page.locator(`[data-gallery-section="${section}"]`)
          ).toBeVisible();
        }
        await expect(page.locator('[data-specimen]').first()).toBeVisible();
        expect(errors).toEqual([]);
      });
    });
  });

  test.describe('Regular user role', () => {
    test.use({ storageState: STORAGE_STATE.user });

    test('is redirected away from the admin reports page', async ({ page }) => {
      await page.goto(ROUTES.adminReports);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveURL(/\/unauthorized/, { timeout: 10000 });
    });

    test('is redirected away from the design reference', async ({ page }) => {
      await page.goto(ROUTES.adminDesign);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveURL(/\/unauthorized/, { timeout: 10000 });
    });
  });
});
