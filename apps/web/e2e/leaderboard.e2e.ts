import { test, expect, type Page } from '@playwright/test';
import { ROUTES, Ruleset } from './fixtures/test-config';

/** Opens the filter panel and returns it. */
async function openFilters(page: Page) {
  const panel = page.getByRole('dialog', { name: 'Filter players' });
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: /^Filters/ }).click();
  }
  await expect(panel).toBeVisible({ timeout: 10000 });
  return panel;
}

async function chooseCountry(page: Page) {
  await page
    .locator('[data-testid="leaderboard-filter-country-button"]')
    .click();

  const countrySearch = page.getByPlaceholder('Search countries');
  await expect(countrySearch).toBeVisible({ timeout: 10000 });
  await countrySearch.fill('United States');

  // Anchor on the country code so "U.S. Outlying Islands" can't match
  const option = page.getByRole('option', { name: /^United States US$/ });
  await expect(option).toBeVisible({ timeout: 10000 });
  await option.click();
}

test.describe('Leaderboard Page', () => {
  // Pre-set the flag so the blocking first-visit dialog never opens
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'otr-leaderboard-first-visit-dismissed',
        'true'
      );
    });
  });

  test.describe('Page Load', () => {
    test('displays leaderboard card and title', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const card = page.locator('[data-testid="leaderboard-card"]');
      await expect(card).toBeVisible({ timeout: 10000 });

      const title = page.locator('[data-testid="leaderboard-title"]');
      await expect(title).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole('heading', { level: 1, name: 'Leaderboard' })
      ).toBeVisible();
    });

    test('displays the rankings table', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const table = page.locator('[data-testid="leaderboard-table"]');
      await expect(table).toBeVisible({ timeout: 10000 });
    });

    test('table renders player ranking rows', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const rows = page.locator('[data-testid^="leaderboard-row-"]');
      await expect(rows.first()).toBeVisible({ timeout: 10000 });

      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    });

    test('table displays rank, player, tier and rating columns', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const table = page.locator('[data-testid="leaderboard-table"]');
      await expect(table).toBeVisible({ timeout: 10000 });

      for (const name of ['Rank', 'Player', 'Tier', 'Rating', 'Win rate']) {
        await expect(table.getByRole('columnheader', { name })).toBeVisible({
          timeout: 10000,
        });
      }
    });

    test('the tier name needs no tooltip where it is written out', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const tierCell = page
        .locator('[data-testid^="leaderboard-row-"]')
        .first()
        .getByRole('cell')
        .nth(2);
      await expect(tierCell).toBeVisible({ timeout: 10000 });
      await expect(tierCell).toContainText(
        /^(Bronze|Silver|Gold|Platinum|Emerald|Diamond|Master|Grandmaster|Elite Grandmaster)/
      );
      await expect(tierCell.getByRole('button')).toHaveCount(0);

      // Below 1024px the column shows the icon alone, which names the tier.
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(
        tierCell.getByRole('button', { name: /^Tier: / })
      ).toBeVisible();
    });

    test('ranks read as #1,234', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const firstRank = page
        .locator('[data-testid^="leaderboard-row-"]')
        .first()
        .getByRole('cell')
        .first();
      await expect(firstRank).toHaveText(/^#[\d,]+$/);
    });

    test('page title contains expected text', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle('Leaderboard | o!TR');
    });
  });

  test.describe('Search and sort', () => {
    test('player search updates the URL', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const search = page.getByRole('searchbox', { name: 'Search players' });
      await search.fill('mr');
      await search.press('Enter');

      await page.waitForURL(/q=mr/, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      await expect(search).toHaveValue('mr');
    });

    test('loads a search from the header search "See all" link', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.leaderboard}?q=mr`);
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('searchbox', { name: 'Search players' })
      ).toHaveValue('mr');
    });

    test('a sortable header sorts the list and the toolbar agrees', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const table = page.locator('[data-testid="leaderboard-table"]');
      await table
        .getByRole('columnheader', { name: 'Matches' })
        .getByRole('link')
        .click();

      await page.waitForURL(/sort=matches/, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      await expect(
        table.getByRole('columnheader', { name: 'Matches' })
      ).toHaveAttribute('aria-sort', 'descending');
      await expect(page.getByLabel('Sort players by')).toContainText('Matches');
    });
  });

  test.describe('Filters', () => {
    // A taller viewport keeps the whole filter panel on screen
    test.use({ viewport: { width: 1280, height: 1080 } });

    test('opens the filter panel from the Filters button', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const panel = await openFilters(page);
      for (const label of ['Rating', 'osu! rank', 'Matches', 'Tiers']) {
        await expect(panel.getByRole('group', { name: label })).toBeVisible();
      }
    });

    test('ruleset switch updates URL and rankings', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const taiko = page.getByRole('radio', { name: 'taiko' });
      await expect(taiko).toBeVisible({ timeout: 10000 });
      await taiko.click();

      await page.waitForURL(/ruleset=1/, { timeout: 10000 });
      expect(page.url()).toContain('ruleset=1');

      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('country filter narrows results to a selected country', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      await openFilters(page);
      await chooseCountry(page);

      await page.waitForURL(/country=US/, { timeout: 10000 });
      expect(page.url()).toContain('country=US');

      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole('button', {
          name: 'Remove Country: United States filter',
        })
      ).toBeVisible();
      // The combobox names the chosen country with its flag.
      await openFilters(page);
      await expect(
        page.locator('[data-testid="leaderboard-filter-country-button"]')
      ).toHaveText('United States');
    });

    test('tier filter narrows results to a selected tier', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const panel = await openFilters(page);
      await panel.getByRole('button', { name: 'Gold', exact: true }).click();

      await page.waitForURL(/tiers=gold/, { timeout: 10000 });
      expect(page.url()).toContain('tiers=gold');

      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole('button', { name: /^Filters, 1 active$/ })
      ).toBeVisible();
    });

    test('combining ruleset and country filters works together', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      await page.getByRole('radio', { name: 'taiko' }).click();
      await page.waitForURL(/ruleset=1/, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      await openFilters(page);
      await chooseCountry(page);

      await page.waitForURL(/country=US/, { timeout: 10000 });
      expect(page.url()).toContain('ruleset=1');
      expect(page.url()).toContain('country=US');

      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('clear all resets the filters to the base leaderboard URL', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.leaderboard}?country=US`);
      await page.waitForLoadState('networkidle');

      const panel = await openFilters(page);
      await panel.getByRole('button', { name: 'Clear all' }).click();

      await page.waitForURL(/\/leaderboard$/, { timeout: 10000 });
      expect(page.url()).not.toContain('country=');
    });

    test('clear all keeps the search, sort and ruleset', async ({ page }) => {
      await page.goto(
        `${ROUTES.leaderboard}?q=mr&sort=matches&ruleset=${Ruleset.Taiko}&tiers=gold`
      );
      await page.waitForLoadState('networkidle');

      await page
        .getByRole('group', { name: 'Active filters' })
        .getByRole('button', { name: 'Clear all' })
        .click();

      await page.waitForURL((url) => !url.searchParams.has('tiers'), {
        timeout: 10000,
      });
      const params = new URL(page.url()).searchParams;
      expect(params.get('q')).toBe('mr');
      expect(params.get('sort')).toBe('matches');
      expect(params.get('ruleset')).toBe(String(Ruleset.Taiko));
    });
  });

  test.describe('Query Parameters', () => {
    test('loads filtered state from a ruleset query param', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.leaderboard}?ruleset=${Ruleset.Taiko}`);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain(`ruleset=${Ruleset.Taiko}`);
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('radio', { name: 'taiko' })).toBeChecked();

      const rows = page.locator('[data-testid^="leaderboard-row-"]');
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
    });

    test('loads filtered state from a country query param', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.leaderboard}?country=US`);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain('country=US');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('preserves query params on page reload', async ({ page }) => {
      await page.goto(`${ROUTES.leaderboard}?ruleset=${Ruleset.Taiko}`);
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain(`ruleset=${Ruleset.Taiko}`);
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('a page past the end goes to the last page', async ({ page }) => {
      await page.goto(`${ROUTES.leaderboard}?country=US&page=100000`);
      await page.waitForLoadState('networkidle');

      const pageParam = new URL(page.url()).searchParams.get('page');
      expect(Number(pageParam ?? '1')).toBeLessThan(100000);
    });
  });

  test.describe('Pagination', () => {
    test('displays pagination controls', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const pagination = page.locator('[data-testid="leaderboard-pagination"]');
      await expect(pagination).toBeVisible({ timeout: 10000 });

      await expect(
        pagination.getByRole('link', { name: 'Previous page' })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        pagination.getByRole('link', { name: 'Next page' })
      ).toBeVisible({ timeout: 10000 });
    });

    test('next button advances to page 2 and updates the URL', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const firstRowId = await page
        .locator('[data-testid^="leaderboard-row-"]')
        .first()
        .getAttribute('data-testid');

      const nextButton = page
        .locator('[data-testid="leaderboard-pagination"]')
        .getByRole('link', { name: 'Next page' });
      await expect(nextButton).toBeVisible({ timeout: 10000 });
      await nextButton.click();

      await page.waitForURL(/page=2/, { timeout: 10000 });
      expect(page.url()).toContain('page=2');

      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });

      const newFirstRowId = await page
        .locator('[data-testid^="leaderboard-row-"]')
        .first()
        .getAttribute('data-testid');
      expect(newFirstRowId).not.toBe(firstRowId);
    });

    test('prev button returns from page 2 to page 1', async ({ page }) => {
      await page.goto(`${ROUTES.leaderboard}?page=2`);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain('page=2');

      const prevButton = page
        .locator('[data-testid="leaderboard-pagination"]')
        .getByRole('link', { name: 'Previous page' });
      await expect(prevButton).toBeVisible({ timeout: 10000 });
      await prevButton.click();

      // Page 1 drops the parameter entirely
      await page.waitForURL((url) => url.searchParams.get('page') === null, {
        timeout: 10000,
      });
      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
      expect(page.url()).not.toContain('page=2');
    });

    test('clicking a numbered page control updates the URL', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const pageTwo = page
        .locator('[data-testid="leaderboard-pagination"]')
        .getByRole('link', { name: 'Page 2', exact: true });
      await expect(pageTwo).toBeVisible({ timeout: 10000 });
      await pageTwo.click();

      await page.waitForURL(/page=2/, { timeout: 10000 });
      expect(page.url()).toContain('page=2');

      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Navigation and Links', () => {
    test('a player row link navigates to the player profile', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const playerLink = page
        .locator('[data-testid^="leaderboard-row-"]')
        .first()
        .locator('a[href*="/players/"]');
      await expect(playerLink).toBeVisible({ timeout: 10000 });

      const href = await playerLink.getAttribute('href');
      expect(href).toMatch(/\/players\/\d+/);

      await playerLink.click();
      await page.waitForURL(/\/players\/\d+/, { timeout: 10000 });
      expect(page.url()).toMatch(/\/players\/\d+/);
    });

    test('a country link navigates to a filtered country leaderboard', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const countryLink = page
        .locator('[data-testid^="leaderboard-row-"]')
        .first()
        .locator('a[href*="country="]');
      await expect(countryLink).toBeVisible({ timeout: 10000 });

      const href = await countryLink.getAttribute('href');
      expect(href).toContain('country=');

      await countryLink.click();
      await page.waitForURL(/country=/, { timeout: 10000 });
      expect(page.url()).toContain('country=');
    });

    test('the country link names its country on keyboard focus', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const row = page.locator('[data-testid^="leaderboard-row-"]').first();
      await row.locator('a[href*="/players/"]').focus();
      await page.keyboard.press('Tab');

      const countryLink = row.locator('a[href*="country="]');
      await expect(countryLink).toBeFocused();
      const name = await countryLink.getAttribute('aria-label');
      const country = name?.replace(/^#[\d,]+ in /, '');
      expect(country).toBeTruthy();
      await expect(page.getByRole('tooltip')).toHaveText(country!);
    });
  });

  test.describe('Avatars', () => {
    /** The image optimizer's requests for osu! avatars. */
    const isAvatar = (url: URL) =>
      url.pathname === '/_next/image' &&
      (url.searchParams.get('url') ?? '').startsWith('https://a.ppy.sh/');

    // A 1x1 PNG, so the test never waits on osu!'s servers.
    const PIXEL = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );

    const firstAvatar = (page: Page) =>
      page
        .locator('[data-testid="leaderboard-table"] [data-slot="avatar"]')
        .first();

    // A slow or stalled avatar fires no error, so the slot used to stay
    // empty until it loaded (#919).
    test('an avatar shows a placeholder until it loads', async ({ page }) => {
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(isAvatar, async (route) => {
        await released;
        await route.fulfill({ contentType: 'image/png', body: PIXEL });
      });

      await page.goto(ROUTES.leaderboard);
      const avatar = firstAvatar(page);
      const placeholder = avatar.locator('[data-slot="avatar-fallback"]');
      await expect(placeholder).toBeVisible({ timeout: 10000 });

      release();
      await expect(placeholder).toHaveCount(0, { timeout: 10000 });
      await expect(avatar.locator('img')).toHaveJSProperty('naturalWidth', 1);
    });

    test('an avatar that fails to load shows the placeholder', async ({
      page,
    }) => {
      await page.route(isAvatar, (route) => route.abort('failed'));

      await page.goto(ROUTES.leaderboard);
      const avatar = firstAvatar(page);
      const placeholder = avatar.locator('[data-slot="avatar-fallback"]');
      await expect(avatar.locator('img')).toHaveCount(0, { timeout: 10000 });
      await expect(placeholder).toBeVisible();
    });
  });

  test.describe('Tablets', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('the table fits the panel, five-digit ranks included', async ({
      page,
    }) => {
      // The last page holds the longest ranks ("#26,963").
      await page.goto(`${ROUTES.leaderboard}?page=9999`);
      await page.waitForLoadState('networkidle');

      const table = page.locator('[data-testid="leaderboard-table"]');
      await expect(table).toBeVisible({ timeout: 10000 });

      // The table's own scroll container would scroll it sideways.
      const overflow = await table.evaluate((element) => {
        const container = element.closest('[data-slot="table-container"]')!;
        return container.scrollWidth - container.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });

  test.describe('Phones', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('shows rows instead of the table, with nothing scrolling sideways', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid^="leaderboard-phone-row-"]').first()
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeHidden();
      await expect(
        page.getByRole('button', { name: /^Filters/ })
      ).toBeInViewport();

      const hasPageOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      );
      expect(hasPageOverflow).toBe(false);
    });

    test('the avatar opens the profile without a second tab stop', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const firstRow = page
        .locator('[data-testid^="leaderboard-phone-row-"]')
        .first();
      const avatarLink = firstRow.locator(
        '[data-slot="phone-row-leading"] a[href*="/players/"]'
      );
      await expect(avatarLink).toBeVisible({ timeout: 10000 });
      await expect(avatarLink).toHaveAttribute('tabindex', '-1');

      // The name links to the same profile and is the row's one tab stop.
      const nameHref = await firstRow
        .getByRole('link')
        .first()
        .getAttribute('href');
      expect(await avatarLink.getAttribute('href')).toBe(nameHref);
    });

    test('rows name the win rate, or the count the list is sorted by', async ({
      page,
    }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const firstRow = page
        .locator('[data-testid^="leaderboard-phone-row-"]')
        .first();
      await expect(firstRow).toContainText(/[\d.]+% win rate/, {
        timeout: 10000,
      });

      await page.goto(`${ROUTES.leaderboard}?sort=tournaments`);
      await page.waitForLoadState('networkidle');
      await expect(firstRow).toContainText(/[\d,]+ tournaments?/, {
        timeout: 10000,
      });
      await expect(firstRow).not.toContainText('win rate');
    });
  });

  test.describe('Authentication Gating', () => {
    test('friends tab is gated for unauthenticated users', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      const tabs = page.locator('[data-testid="leaderboard-tabs"]');
      await expect(tabs).toHaveCount(0);
    });

    test('navigating directly to the friends tab redirects to the base leaderboard', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.leaderboard}?friend=true`);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="leaderboard-table"]')
      ).toBeVisible({ timeout: 10000 });
      expect(page.url()).not.toContain('friend=true');
    });
  });
});
