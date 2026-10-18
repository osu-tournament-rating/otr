import { test, expect } from '@playwright/test';
import { ROUTES } from './fixtures/test-config';

test.describe('Statistics Page', () => {
  test.describe('Page Load', () => {
    test('displays heading and description', async ({ page }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const heading = page.getByRole('heading', {
        level: 1,
        name: 'Platform statistics',
      });
      await expect(heading).toBeVisible({ timeout: 10000 });

      await expect(
        page.getByText('Statistics covering all of osu! tournaments')
      ).toBeVisible({ timeout: 10000 });
    });

    test('page title contains expected text', async ({ page }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle('Platform statistics | o!TR');
    });
  });

  test.describe('Chart Rendering', () => {
    test('displays tournament verification chart with rendered content', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const chart = page.locator(
        '[data-testid="chart-tournament-verification"]'
      );
      await expect(chart).toBeVisible({ timeout: 15000 });
      await expect(chart.locator('.recharts-wrapper')).toBeVisible({
        timeout: 10000,
      });
    });

    test('groups undecided tournaments into one "Not in ratings yet" bar', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const chart = page.locator(
        '[data-testid="chart-tournament-verification"]'
      );
      const labels = chart.locator('.recharts-cartesian-axis-tick-value');
      await expect(labels.first()).toBeVisible({ timeout: 15000 });

      const text = await labels.allTextContents();
      expect(text).toEqual(
        expect.arrayContaining(['Verified', 'Not in ratings yet', 'Rejected'])
      );
      expect(text).not.toContain('Pending');
      expect(text).not.toContain('Awaiting Review');
    });

    test('displays tournaments by year chart with rendered content', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const chart = page.locator('[data-testid="chart-tournaments-by-year"]');
      await expect(chart).toBeVisible({ timeout: 15000 });
      await expect(chart.locator('.recharts-wrapper')).toBeVisible({
        timeout: 10000,
      });
    });

    test('displays tournaments by ruleset chart with rendered content', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const chart = page.locator(
        '[data-testid="chart-tournaments-by-ruleset"]'
      );
      await expect(chart).toBeVisible({ timeout: 15000 });
      await expect(chart.locator('.recharts-wrapper')).toBeVisible({
        timeout: 10000,
      });
    });

    test('displays tournaments by lobby size chart with rendered content', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const chart = page.locator(
        '[data-testid="chart-tournaments-by-lobby-size"]'
      );
      await expect(chart).toBeVisible({ timeout: 15000 });
      await expect(chart.locator('.recharts-wrapper')).toBeVisible({
        timeout: 10000,
      });
    });

    test('displays at least one rating distribution chart with rendered content', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const charts = page.locator(
        '[data-testid^="chart-rating-distribution-"]'
      );
      await expect(charts.first()).toBeVisible({ timeout: 15000 });

      const count = await charts.count();
      expect(count).toBeGreaterThan(0);

      await expect(charts.first().locator('.recharts-wrapper')).toBeVisible({
        timeout: 10000,
      });
    });

    test('draws the cumulative share on its own percentage axis', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const chart = page.locator('[data-testid="chart-rating-distribution-0"]');
      await expect(chart.locator('.recharts-wrapper')).toBeVisible({
        timeout: 15000,
      });
      await expect(
        chart.getByText('Cumulative', { exact: true })
      ).toBeVisible();
      await expect(
        chart.locator('.recharts-cartesian-axis-tick-value', {
          hasText: /^100%$/,
        })
      ).toBeVisible();
    });
  });

  test.describe('Rating distribution ruleset', () => {
    test('shows osu! by default and keeps the choice in the address', async ({
      page,
    }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');

      const rulesets = page.getByRole('radiogroup', { name: 'Ruleset' });
      await expect(
        rulesets.getByRole('radio', { name: 'osu!' })
      ).toHaveAttribute('aria-checked', 'true');
      await expect(
        page.locator('[data-testid="chart-rating-distribution-0"]')
      ).toBeVisible({ timeout: 15000 });

      await rulesets.getByRole('radio', { name: 'taiko' }).click();

      await expect(page).toHaveURL(/[?&]ruleset=1(&|$)/);
      await expect(
        page.locator('[data-testid="chart-rating-distribution-1"]')
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.locator('[data-testid="chart-rating-distribution-0"]')
      ).toHaveCount(0);

      await page.goBack();
      await expect(page).not.toHaveURL(/ruleset=/);
      await expect(
        page.locator('[data-testid="chart-rating-distribution-0"]')
      ).toBeVisible({ timeout: 15000 });
    });

    test('switches without rendering the page again', async ({ page }) => {
      await page.goto(ROUTES.stats);
      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="chart-rating-distribution-0"]')
      ).toBeVisible({ timeout: 15000 });

      // Every ruleset's distribution is on the page already, so a switch
      // only rewrites the address: no React Server Components request.
      // Production builds prefetch the links in view, which is not a render.
      const serverRenders: string[] = [];
      page.on('request', (request) => {
        const headers = request.headers();
        if (headers['next-router-prefetch']) return;
        if (headers['rsc'] === '1' || request.url().includes('_rsc=')) {
          serverRenders.push(request.url());
        }
      });

      await page
        .getByRole('radiogroup', { name: 'Ruleset' })
        .getByRole('radio', { name: 'catch' })
        .click();

      await expect(page).toHaveURL(/[?&]ruleset=2(&|$)/);
      await expect(
        page.locator('[data-testid="chart-rating-distribution-2"]')
      ).toBeVisible({ timeout: 15000 });
      expect(serverRenders).toEqual([]);
    });

    test('opens on the ruleset named in the address', async ({ page }) => {
      await page.goto(`${ROUTES.stats}?ruleset=4`);
      await page.waitForLoadState('networkidle');

      await expect(
        page
          .getByRole('radiogroup', { name: 'Ruleset' })
          .getByRole('radio', { name: 'mania 4K' })
      ).toHaveAttribute('aria-checked', 'true');
      await expect(
        page.locator('[data-testid="chart-rating-distribution-4"]')
      ).toBeVisible({ timeout: 15000 });
    });
  });
});
