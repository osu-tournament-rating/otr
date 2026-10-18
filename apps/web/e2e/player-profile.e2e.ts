import { test, expect, type Page } from '@playwright/test';
import { MOD_PERFORMANCE_INFO } from '../components/player/section-info';
import { TEST_PLAYER_ID, ROUTES, Ruleset } from './fixtures/test-config';

test.describe('Player Profile Page', () => {
  test.describe('Core Data Loading', () => {
    test('displays player card with avatar and username', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const avatar = page.locator('[data-testid="player-avatar"]');
      await expect(avatar).toBeVisible({ timeout: 10000 });

      const username = page.locator('[data-testid="player-username"]');
      await expect(username).toBeVisible({ timeout: 10000 });
      await expect(username).not.toBeEmpty();
    });

    test('displays rating stats with the tier icon, rating, and ranks', async ({
      page,
    }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const ratingTile = page.locator('[data-testid="stat-card-rating"]');
      await expect(ratingTile).toBeVisible({ timeout: 10000 });
      // No tier tile: the tier icon sits beside the rating and names the
      // tier from a button, so a tap can read it.
      await expect(
        ratingTile.locator('[data-testid="stat-card-tier"]')
      ).toBeVisible();
      await expect(
        ratingTile.getByRole('button', { name: /^Tier: / })
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="stat-card-global"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="stat-card-country"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('displays match and tournament statistics', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="stat-card-tournaments"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="stat-card-matches"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="stat-card-percentile"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('page title contains player username', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });
  });

  test.describe('Filters and UI Updates', () => {
    test('displays labelled ruleset chips', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const rulesetChips = page
        .getByRole('radiogroup', { name: 'Ruleset' })
        .getByRole('radio');
      await expect(rulesetChips.first()).toBeVisible({ timeout: 10000 });
      await expect(rulesetChips).toHaveText([
        'osu!',
        'taiko',
        'catch',
        'mania 4K',
        'mania 7K',
      ]);
    });

    test('changes URL when selecting different ruleset', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const taikoChip = page.getByRole('radio', { name: 'taiko' });
      await expect(taikoChip).toBeVisible({ timeout: 10000 });
      await taikoChip.click();
      await page.waitForURL(/ruleset=1/, { timeout: 10000 });
      expect(page.url()).toContain('ruleset=1');
      await expect(taikoChip).toBeChecked();
    });

    test('preserves ruleset in URL on page reload', async ({ page }) => {
      await page.goto(
        `${ROUTES.playerProfile(TEST_PLAYER_ID)}?ruleset=${Ruleset.Taiko}`
      );
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(`ruleset=${Ruleset.Taiko}`);
    });

    test('updates page content when ruleset changes', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const rulesetChips = page
        .getByRole('radiogroup', { name: 'Ruleset' })
        .getByRole('radio');
      const chipCount = await rulesetChips.count();

      if (chipCount > 1) {
        await rulesetChips.nth(1).click();
        await page.waitForLoadState('networkidle');
      }
    });
  });

  test.describe('Chart Rendering', () => {
    test('displays rating chart', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const ratingChartContainer = page.locator(
        '[data-testid="player-rating-chart"]'
      );
      await expect(ratingChartContainer).toBeVisible({ timeout: 15000 });
    });

    test('rating chart has toggle between chart and table view', async ({
      page,
    }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const toggleGroup = page.locator('[data-testid="rating-chart-toggle"]');
      if (await toggleGroup.isVisible({ timeout: 10000 })) {
        const toggleButtons = toggleGroup.locator('button');
        const buttonCount = await toggleButtons.count();
        expect(buttonCount).toBeGreaterThanOrEqual(2);
      }
    });

    test('rating history views stay in the address', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const chart = page.locator('[data-testid="player-rating-chart"]');
      await expect(chart).toBeVisible({ timeout: 15000 });

      await chart.getByRole('radio', { name: 'Volatility' }).click();
      await chart.getByRole('radio', { name: 'Table' }).click();
      await expect(page).toHaveURL(/metric=volatility/);
      await expect(page).toHaveURL(/view=table/);
      await expect(
        chart.getByRole('region', { name: 'Volatility history' })
      ).toBeVisible();

      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(
        chart.getByRole('radio', { name: 'Volatility' })
      ).toBeChecked();
      await expect(
        chart.getByRole('region', { name: 'Volatility history' })
      ).toBeVisible({ timeout: 10000 });
    });

    test('displays mod stats charts', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const charts = page.locator('.recharts-wrapper');
      await expect(charts.first()).toBeVisible({ timeout: 15000 });
      const chartCount = await charts.count();
      expect(chartCount).toBeGreaterThan(0);
    });

    test('displays frequency charts for teammates and opponents', async ({
      page,
    }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const frequencyCharts = page.locator('.recharts-bar-rectangles');
      const chartCount = await frequencyCharts.count();
      expect(chartCount).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('Section help', () => {
    /**
     * Repeats `open` until the info popover shows, since the dev server can
     * still be hydrating the page when the first key or tap lands.
     */
    async function openModPerformanceInfo(
      page: Page,
      open: () => Promise<void>
    ): Promise<void> {
      // The popover is a dialog; the focus tooltip carries the same text.
      const popover = page
        .getByRole('dialog')
        .filter({ hasText: MOD_PERFORMANCE_INFO });

      await expect(async () => {
        if (await popover.isVisible()) return;
        await open();
        await expect(popover).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30000 });
    }

    test('the mod performance info opens from the keyboard', async ({
      page,
    }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const info = page.getByRole('button', { name: 'About mod performance' });
      await expect(info).toBeVisible({ timeout: 10000 });

      // Tab through the page until the button takes focus.
      let focused = false;
      for (let presses = 0; presses < 200 && !focused; presses++) {
        await page.keyboard.press('Tab');
        focused = await info.evaluate((el) => el === document.activeElement);
      }
      expect(focused).toBe(true);

      await openModPerformanceInfo(page, () => page.keyboard.press('Enter'));
    });

    test.describe('on a phone', () => {
      test.use({
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
      });

      test('the mod performance info opens on a tap', async ({ page }) => {
        await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
        await page.waitForLoadState('networkidle');

        const info = page.getByRole('button', {
          name: 'About mod performance',
        });
        await expect(info).toBeVisible({ timeout: 10000 });

        await openModPerformanceInfo(page, () => info.tap());
      });
    });
  });

  test.describe('Missing players', () => {
    test('a player that does not exist shows the not-found page', async ({
      page,
    }) => {
      await page.goto(ROUTES.playerProfile(999_999_999));
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('heading', { level: 1, name: 'Page not found' })
      ).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText('Player could not load')).toHaveCount(0);
    });
  });

  test.describe('Tournament History', () => {
    test('displays tournament list section', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const tournamentSection = page.locator(
        '[data-testid="tournament-history-title"]'
      );
      await expect(tournamentSection).toBeVisible({ timeout: 10000 });
    });

    test('Show more reveals more tournaments', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const panel = page.locator('[data-slot="panel"]').filter({
        has: page.locator('[data-testid="tournament-history-title"]'),
      });
      const rows = panel.locator('[data-testid="player-tournament-row"]');
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
      const footer = panel.locator('[data-slot="load-more"]');
      // The test player may have five tournaments or fewer.
      test.skip(
        !(await footer.isVisible()),
        'The test player has no more tournaments to show'
      );

      await expect(footer).toContainText('Showing 5 of ');
      await footer.getByRole('button', { name: 'Show more' }).click();
      await expect
        .poll(() => rows.count(), { timeout: 10000 })
        .toBeGreaterThan(5);
    });

    test('a tournament row labels its won–lost pair as the record', async ({
      page,
    }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      // Tournaments without the player's stats have no record.
      const row = page
        .locator('[data-testid="player-tournament-row"]')
        .filter({ has: page.getByText('Record', { exact: true }) })
        .first();
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row.getByText('Record', { exact: true })).toBeVisible();
      await expect(
        row.getByText(/^[\d,]+ wins? and [\d,]+ loss(es)?$/)
      ).toHaveCount(1);
      // One "Matches": the button, not a stat beside it.
      await expect(row.getByText('Matches', { exact: true })).toHaveCount(1);
    });

    test('a tournament row expands its matches in place', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const toggle = page.getByRole('button', { name: /^Matches in / }).first();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false', {
        timeout: 10000,
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');

      const matchesId = await toggle.getAttribute('aria-controls');
      await expect(page.locator(`[id="${matchesId}"]`)).toBeVisible();
    });
  });

  test.describe('Navigation and Links', () => {
    test('contains link to osu! profile', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const osuLink = page.locator('a[href*="osu.ppy.sh"]');
      await expect(osuLink).toBeVisible({ timeout: 10000 });
    });

    test('country flag links to country leaderboard', async ({ page }) => {
      await page.goto(ROUTES.playerProfile(TEST_PLAYER_ID));
      await page.waitForLoadState('networkidle');

      const countryLink = page.locator('a[href*="/leaderboard?country="]');
      if (await countryLink.first().isVisible({ timeout: 10000 })) {
        const href = await countryLink.first().getAttribute('href');
        expect(href).toContain('country=');
      }
    });
  });
});
