import { test, expect, type Page } from '@playwright/test';

import { STORAGE_STATE } from './fixtures/auth';
import {
  ROUTES,
  TEST_PUBLIC_TOURNAMENT_ID,
  Ruleset,
} from './fixtures/test-config';

/** SEARCH_DEBOUNCE_MS plus room for the navigation it schedules. */
const SEARCH_DEBOUNCE_SETTLE_MS = 800;

/** A list change renders on the server first, which can take seconds. */
const NAVIGATION_TIMEOUT = { timeout: 15_000 };

const searchBox = (page: Page) =>
  page.getByRole('searchbox', { name: 'Search tournaments' });

const filtersButtonOf = (page: Page) =>
  page.getByRole('button', { name: /^Filters/ });

test.describe('Tournaments', () => {
  test.describe('Listing and Search', () => {
    test('loads the tournaments page with a list of tournaments', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('heading', { level: 1, name: 'Tournaments' })
      ).toBeVisible();
      await expect(
        page.getByText(/browse tournament submissions and their review status/i)
      ).toBeVisible();
      await expect(
        page.getByText(/only verified data is included in ratings/i)
      ).toBeVisible();

      const items = page.locator('[data-testid="tournament-list-item"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      expect(await items.count()).toBeGreaterThan(0);

      const results = page.locator('[data-testid="tournament-results"]');
      await expect(results).toBeVisible();
      await expect(results.locator('[data-slot="card"]')).toHaveCount(0);
      await expect(
        results.getByText('Tournament', { exact: true })
      ).toBeVisible();
      await expect(
        results.getByText('Tournament and review status', { exact: true })
      ).toHaveCount(0);
    });

    test('displays the search input', async ({ page }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      await expect(searchBox(page)).toBeVisible({ timeout: 10000 });
    });

    test('marks admin notes without a hover-only preview or shifting rows', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const items = page.locator('[data-testid="tournament-list-item"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });

      const noteSlots = page.locator(
        '[data-testid="tournament-admin-note-slot"]'
      );
      await expect(noteSlots).toHaveCount(await items.count());

      const slotWidths = await noteSlots.evaluateAll((slots) =>
        slots.map((slot) => slot.getBoundingClientRect().width)
      );
      expect(new Set(slotWidths)).toEqual(new Set([20]));

      const markers = page.locator(
        '[data-testid="tournament-admin-notes-marker"]'
      );
      await markers.first().scrollIntoViewIfNeeded();
      await expect(markers.first()).toBeVisible();
      expect(await markers.count()).toBeLessThan(await noteSlots.count());

      const marker = markers.first();
      const row = marker.locator(
        'xpath=ancestor::*[@data-testid="tournament-list-item"]'
      );
      const abbreviationBox = await row
        .locator('[data-testid="tournament-abbreviation"]')
        .boundingBox();
      const markerBox = await marker.boundingBox();
      expect(abbreviationBox).not.toBeNull();
      expect(markerBox).not.toBeNull();
      expect(markerBox!.x).toBeGreaterThanOrEqual(
        abbreviationBox!.x + abbreviationBox!.width
      );

      // The row is one link: its name says how many notes there are, and
      // nothing inside it opens on hover alone.
      await expect(row.getByRole('link')).toHaveAccessibleName(
        /^View .+, \d+ admin notes?$/
      );
      const rowBox = await row.boundingBox();
      await marker.hover();
      // Longer than a tooltip's open delay, so a hover preview would show.
      await page.waitForTimeout(800);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      expect(await row.boundingBox()).toEqual(rowBox);
    });

    test('says "Not in ratings yet" instead of an amber pill', async ({
      page,
    }) => {
      // Pending (0), Pre-rejected (1) and Pre-verified (2) are not in ratings.
      await page.goto(`${ROUTES.tournaments}?status=0&status=1&status=2`);
      await page.waitForLoadState('networkidle');

      const items = page.locator('[data-testid="tournament-list-item"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      await expect(items.first().getByText('Not in ratings yet')).toBeVisible();
      await expect(page.getByText('Awaiting review')).toHaveCount(0);
    });

    test('search by title returns matching tournaments', async ({ page }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const search = searchBox(page);
      await expect(search).toBeVisible({ timeout: 10000 });
      await search.fill('Dio');

      await page.waitForURL(/[?&]q=Dio/i, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      const items = page.locator('[data-testid="tournament-list-item"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      await expect(items.first().getByText(/Dio/i).first()).toBeVisible({
        timeout: 10000,
      });
    });

    test('search by abbreviation returns matching tournaments', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const search = searchBox(page);
      await expect(search).toBeVisible({ timeout: 10000 });
      await search.fill('DAS');
      await search.press('Enter');

      await page.waitForURL(/[?&]q=DAS/i, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      const items = page.locator('[data-testid="tournament-list-item"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      expect(await items.count()).toBeGreaterThan(0);
    });

    test('filter by ruleset narrows results via URL query', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.tournaments}?ruleset=${Ruleset.Osu}`);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain(`ruleset=${Ruleset.Osu}`);

      const items = page.locator('[data-testid="tournament-list-item"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      expect(await items.count()).toBeGreaterThan(0);
    });

    test('opens the filters panel when the filters button is clicked', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const filtersButton = filtersButtonOf(page);
      await expect(filtersButton).toBeVisible({ timeout: 10000 });
      await filtersButton.click();

      const filterSheet = page.getByRole('dialog', {
        name: 'Filter tournaments',
      });
      await expect(filterSheet).toBeVisible({ timeout: 10000 });
      for (const label of [
        'Status',
        'Lobby size',
        'Rejection reason',
        'Rank restriction',
        'Tournament dates',
      ]) {
        await expect(
          filterSheet.getByRole('group', { name: label, exact: true })
        ).toBeVisible();
      }
      await expect(filterSheet.getByText('Team size')).toHaveCount(0);
    });

    test('rank slider uses tiered keyboard steps', async ({ page }) => {
      const thresholds = [
        { current: 999, next: 1_000 },
        { current: 1_000, next: 1_100 },
        { current: 5_000, next: 5_500 },
        { current: 10_000, next: 11_000 },
      ];

      for (const { current, next } of thresholds) {
        await page.goto(`${ROUTES.tournaments}?minRankRange=${current}`);
        await page.waitForLoadState('networkidle');
        await filtersButtonOf(page).click();

        const minimumRank = page.getByRole('slider', {
          name: 'Minimum rank',
        });
        await minimumRank.press('ArrowRight');

        await expect(
          page.getByRole('textbox', { name: 'Minimum rank' })
        ).toHaveValue(next.toLocaleString('en-US'));
        await expect
          .poll(
            () => new URL(page.url()).searchParams.get('minRankRange') ?? '1',
            NAVIGATION_TIMEOUT
          )
          .toBe(String(next));
      }
    });

    test('ruleset chips pick several rulesets and clear back to all', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const rulesets = page.getByRole('group', { name: 'Filter by ruleset' });
      await rulesets
        .getByRole('button', { name: 'taiko', exact: true })
        .click();
      await page.waitForURL(/ruleset=1/);
      await rulesets
        .getByRole('button', { name: 'catch', exact: true })
        .click();
      await expect
        .poll(
          () => new URL(page.url()).searchParams.getAll('ruleset'),
          NAVIGATION_TIMEOUT
        )
        .toEqual(['1', '2']);

      await rulesets.getByRole('button', { name: 'All', exact: true }).click();
      await page.waitForURL(
        (url) =>
          url.pathname === ROUTES.tournaments &&
          !url.searchParams.has('ruleset')
      );
    });

    test('sort direction exposes its state and updates the URL', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      await page
        .getByRole('button', { name: /sort order is descending/i })
        .click();

      await page.waitForURL(/dir=asc/);
      await expect(
        page.getByRole('button', { name: /sort order is ascending/i })
      ).toBeVisible();
    });

    test('status filter stays visible and can be removed', async ({ page }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      await filtersButtonOf(page).click();
      await page
        .getByRole('group', { name: 'Status', exact: true })
        .getByRole('button', { name: 'Verified', exact: true })
        .click();
      await page.waitForURL(/status=4/);
      await page.keyboard.press('Escape');

      const activeFilter = page.getByRole('button', {
        name: 'Remove Status: Verified filter',
      });
      await expect(activeFilter).toBeVisible();
      await activeFilter.click();
      await page.waitForURL(
        (url) =>
          url.pathname === ROUTES.tournaments && !url.searchParams.has('status')
      );
    });

    test('rank restriction sends a maximum only below the ceiling', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');
      await filtersButtonOf(page).click();

      const maximumRank = page.getByRole('textbox', { name: 'Maximum rank' });
      await expect(maximumRank).toHaveValue('');
      await maximumRank.fill('250000');
      await maximumRank.blur();

      await expect
        .poll(
          () => new URL(page.url()).searchParams.get('maxRankRange'),
          NAVIGATION_TIMEOUT
        )
        .toBe('250000');

      await maximumRank.fill('1000000');
      await maximumRank.blur();

      await expect
        .poll(
          () => new URL(page.url()).searchParams.has('maxRankRange'),
          NAVIGATION_TIMEOUT
        )
        .toBe(false);
    });

    test('filters by several rejection reasons', async ({ page }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');
      await filtersButtonOf(page).click();

      const reasons = page.getByRole('group', {
        name: 'Rejection reason',
        exact: true,
      });
      await reasons
        .getByRole('button', { name: 'No verified matches', exact: true })
        .click();
      await reasons
        .getByRole('button', { name: 'Abnormal format', exact: true })
        .click();

      await expect
        .poll(
          () => new URL(page.url()).searchParams.get('rejectionReason'),
          NAVIGATION_TIMEOUT
        )
        .toBe('9');
    });

    test('an empty search clears from the search box', async ({ page }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const search = searchBox(page);
      await search.fill('definitely-not-a-real-tournament-12345');
      await search.press('Enter');
      await page.waitForURL(/q=definitely-not-a-real-tournament-12345/);

      const emptyState = page.locator('[data-testid="tournament-empty-state"]');
      await expect(emptyState).toBeVisible();
      await expect(emptyState.getByText('No tournaments match')).toBeVisible();
      // "Clear filters" clears filters only; a search alone offers none.
      await expect(
        emptyState.getByRole('link', { name: 'Clear filters' })
      ).toHaveCount(0);

      await page.getByRole('button', { name: 'Clear search' }).click();
      await page.waitForURL(
        (url) => url.pathname === ROUTES.tournaments && url.search === ''
      );
      await expect(search).toHaveValue('');
      await expect(
        page.locator('[data-testid="tournament-list-item"]').first()
      ).toBeVisible();
    });

    test('clear filters keeps the search and ruleset', async ({ page }) => {
      await page.goto(
        `${ROUTES.tournaments}?q=definitely-not-a-real-tournament-12345&ruleset=1&status=4`
      );
      await page.waitForLoadState('networkidle');

      const emptyState = page.locator('[data-testid="tournament-empty-state"]');
      await expect(emptyState).toBeVisible();
      await emptyState.getByRole('link', { name: 'Clear filters' }).click();

      await page.waitForURL((url) => !url.searchParams.has('status'));
      const url = new URL(page.url());
      expect(url.searchParams.get('q')).toBe(
        'definitely-not-a-real-tournament-12345'
      );
      expect(url.searchParams.get('ruleset')).toBe('1');
    });

    test('browser back restores the previous search query', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const search = searchBox(page);
      await search.fill('Dio');
      await search.press('Enter');
      await page.waitForURL(/[?&]q=Dio/i, { timeout: 10000 });
      await page.waitForLoadState('networkidle');

      await search.fill('DAS');
      await search.press('Enter');
      await page.waitForURL(/[?&]q=DAS/i, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(SEARCH_DEBOUNCE_SETTLE_MS);

      await page.goBack();
      await page.waitForURL(/[?&]q=Dio/i, { timeout: 10000 });
      await expect(search).toHaveValue('Dio');
      await page.waitForTimeout(SEARCH_DEBOUNCE_SETTLE_MS);
      expect(new URL(page.url()).searchParams.get('q')).toBe('Dio');
      await expect(search).toHaveValue('Dio');
    });

    test('combination of search and ruleset filters works together', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.tournaments}?ruleset=${Ruleset.Osu}&q=Dio`);
      await page.waitForLoadState('networkidle');

      expect(page.url()).toContain(`ruleset=${Ruleset.Osu}`);
      expect(page.url()).toContain('q=Dio');

      const items = page.locator('[data-testid="tournament-list-item"]');
      await expect(items.first()).toBeVisible({ timeout: 10000 });
      await expect(items.first().getByText(/Dio/i).first()).toBeVisible({
        timeout: 10000,
      });
    });

    test('old toolbar links open the same list', async ({ page }) => {
      await page.goto(
        `${ROUTES.tournaments}?searchQuery=Dio&verificationStatus=4&descending=false`
      );

      await page.waitForURL((url) => url.searchParams.get('q') === 'Dio');
      const url = new URL(page.url());
      expect(url.searchParams.getAll('status')).toEqual(['4']);
      expect(url.searchParams.get('dir')).toBe('asc');
      expect(url.searchParams.has('searchQuery')).toBe(false);
    });

    test('pages through the list with numbered pages', async ({ page }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      const pagination = page.locator('[data-testid="tournament-pagination"]');
      await expect(pagination.getByText(/^1–30 of /)).toBeVisible();
      await pagination
        .getByRole('link', { name: 'Page 2', exact: true })
        .click();

      await page.waitForURL(/[?&]page=2/);
      await expect(pagination.getByText(/^31–60 of /)).toBeVisible();
      await expect(
        page.locator('[data-testid="tournament-list-item"]')
      ).toHaveCount(30);
    });
  });

  test.describe('Detail Page', () => {
    test('loads with tournament header info', async ({ page }) => {
      await page.goto(ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible({ timeout: 10000 });
      await expect(heading).not.toBeEmpty();

      await expect(page.locator('[data-testid="tournament-tabs"]')).toBeVisible(
        { timeout: 10000 }
      );
      await expect(
        page.getByRole('link', { name: 'View audit history' })
      ).toBeVisible();
    });

    test('four tabs fit a 360px phone and keep their counts in their names', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const tabs = page.locator('[data-testid="tournament-tabs"]');
      await expect(tabs).toBeVisible({ timeout: 10000 });
      const overflow = await tabs.evaluate(
        (nav) => nav.scrollWidth - nav.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page.locator('[data-testid="tab-stats"]')).toBeInViewport({
        ratio: 1,
      });
      await expect(
        page.locator('[data-testid="tab-matches"]')
      ).toHaveAccessibleName(/^Matches\s*[\d,]+$/);
    });

    test('page title is populated', async ({ page }) => {
      await page.goto(ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    });

    test('matches tab lists matches', async ({ page }) => {
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=matches`
      );
      await page.waitForLoadState('networkidle');

      const matchesTab = page.locator('[data-testid="tab-matches"]');
      await expect(matchesTab).toBeVisible({ timeout: 10000 });
      await matchesTab.click();
      await page.waitForLoadState('networkidle');

      const content = page.locator('[data-testid="tab-content-matches"]');
      await expect(content).toBeVisible({ timeout: 10000 });
      await expect(content.getByText('Matches').first()).toBeVisible({
        timeout: 10000,
      });
    });

    test('match sort lives in the address', async ({ page }) => {
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=matches`
      );
      await page.waitForLoadState('networkidle');

      const content = page.locator('[data-testid="tab-content-matches"]');
      await content.getByRole('combobox', { name: 'Sort matches by' }).click();
      await page.getByRole('option', { name: 'Match name' }).click();

      await expect
        .poll(() => new URL(page.url()).searchParams.get('sort'))
        .toBe('name');
      expect(new URL(page.url()).searchParams.get('tab')).toBe('matches');

      await page.reload();
      await expect(
        content.getByRole('combobox', { name: 'Sort matches by' })
      ).toHaveText('Match name');
    });

    test('beatmaps tab lists pooled beatmaps', async ({ page }) => {
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=beatmaps`
      );
      await page.waitForLoadState('networkidle');

      const beatmapsTab = page.locator('[data-testid="tab-beatmaps"]');
      await expect(beatmapsTab).toBeVisible({ timeout: 10000 });
      await beatmapsTab.click();
      await page.waitForLoadState('networkidle');

      const content = page.locator('[data-testid="tab-content-beatmaps"]');
      await expect(content).toBeVisible({ timeout: 10000 });
      await expect(content.getByText('Pooled beatmaps').first()).toBeVisible({
        timeout: 10000,
      });
    });

    test('a sortable header reorders the pooled beatmaps', async ({ page }) => {
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=beatmaps`
      );
      // The rows render on the server; the sort only answers once hydrated
      await page.waitForLoadState('networkidle');

      const table = page
        .locator('[data-testid="tab-content-beatmaps"]')
        .locator('table');
      await expect(table.locator('tbody tr').first()).toBeVisible({
        timeout: 15000,
      });

      const starRatings = () =>
        table
          .locator('tbody tr [data-testid="beatmap-star-rating-value"]')
          .allInnerTexts();
      const pool = () =>
        table.locator('tbody tr td:nth-child(1)').allInnerTexts();

      const before = await pool();
      const header = table.getByRole('columnheader', { name: /^SR/ });
      await expect(header).toHaveAttribute('aria-sort', 'none');

      await header.getByRole('button').click();
      await expect(header).toHaveAttribute('aria-sort', 'descending');
      expect(await pool()).not.toEqual(before);
      const descending = (await starRatings()).map(Number);
      expect(descending.length).toBeGreaterThan(1);
      expect(descending.every(Number.isFinite)).toBe(true);
      expect(descending).toEqual([...descending].sort((a, b) => b - a));

      await header.getByRole('button').click();
      await expect(header).toHaveAttribute('aria-sort', 'ascending');
      const ascending = (await starRatings()).map(Number);
      expect(ascending).toEqual([...ascending].sort((a, b) => a - b));

      await expect(
        table.locator('thead th[aria-sort]:not([aria-sort="none"])')
      ).toHaveCount(1);
    });

    test('phones show the pool as cover rows', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=beatmaps`
      );

      const row = page
        .getByRole('list', { name: 'Pooled beatmaps' })
        .getByRole('listitem')
        .first();
      await expect(row).toBeVisible({ timeout: 15000 });
      // The cover and its audio preview, and the pool's own game count.
      await expect(row.getByTestId('beatmap-cover-cell')).toBeVisible();
      await expect(row.getByTestId('beatmap-games-count')).toBeVisible();
      await expect(row.getByTestId('beatmap-tournaments-count')).toHaveCount(0);
    });

    test('ratings tab shows player ratings', async ({ page }) => {
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=ratings`
      );
      await page.waitForLoadState('networkidle');

      const ratingsTab = page.locator('[data-testid="tab-ratings"]');
      await expect(ratingsTab).toBeVisible({ timeout: 10000 });
      await ratingsTab.click();
      await page.waitForLoadState('networkidle');

      const content = page.locator('[data-testid="tab-content-ratings"]');
      await expect(content).toBeVisible({ timeout: 10000 });
      await expect(
        content.getByRole('table', { name: 'Rating changes' })
      ).toBeVisible();
    });

    test('phones sort the ratings rows, and the sort lives in the address', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=ratings`
      );
      await page.waitForLoadState('networkidle');

      const content = page.locator('[data-testid="tab-content-ratings"]');
      const rows = content.getByRole('list', { name: 'Rating changes' });
      await expect(rows).toBeVisible();
      await expect(
        content.getByRole('table', { name: 'Rating changes' })
      ).toBeHidden();

      const sort = content.getByRole('combobox', {
        name: 'Sort rating changes by',
      });
      await sort.click();
      await page.getByRole('option', { name: 'Player' }).click();
      // The rows re-sort once the closed dropdown hands the page back.
      await expect(sort).toHaveText('Player');

      const url = new URL(page.url());
      expect(url.searchParams.get('sort')).toBe('player');
      expect(url.searchParams.get('dir')).toBe('asc');
      expect(url.searchParams.get('tab')).toBe('ratings');

      const byName = (a: string, b: string) =>
        a.localeCompare(b, 'en-US', { sensitivity: 'base', numeric: true });
      await expect
        .poll(async () => {
          const names = await rows.getByRole('link').allInnerTexts();
          return names.length > 1 && names.join() === names.sort(byName).join();
        })
        .toBe(true);
    });

    test('stats tab renders tournament statistics content', async ({
      page,
    }) => {
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=stats`
      );
      await page.waitForLoadState('networkidle');

      const statsTab = page.locator('[data-testid="tab-stats"]');
      await expect(statsTab).toBeVisible({ timeout: 10000 });
      await statsTab.click();
      await page.waitForLoadState('networkidle');

      const content = page.locator('[data-testid="tab-content-stats"]');
      await expect(content).toBeVisible({ timeout: 15000 });
      await expect(
        content.getByText('Tournament statistics').first()
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Admin on a phone', () => {
    test.use({ storageState: STORAGE_STATE.admin });

    test('closing a dialog with Escape leaves no tooltip on its button', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 844 });
      await page.goto(
        `${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}?tab=matches`
      );

      // On phones Add matches is an icon beside the sort control.
      const addMatches = page.getByRole('button', { name: 'Add matches' });
      await addMatches.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(addMatches).toBeFocused();
      // Longer than a tooltip's open delay, so a tooltip would show.
      await page.waitForTimeout(500);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    });
  });

  test.describe('Submission', () => {
    test('submit page renders the submission form', async ({ page }) => {
      await page.goto(ROUTES.tournamentSubmit);
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('heading', { level: 1, name: 'Tournament submission' })
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="tournament-submission-form"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('submit button is present for the submission action', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournamentSubmit);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="tournament-submit-button"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('an empty submission names each required field', async ({ page }) => {
      await page.goto(ROUTES.tournamentSubmit);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="tournament-submit-button"]').click();

      const form = page.locator('[data-testid="tournament-submission-form"]');
      for (const message of [
        'Tournament abbreviation is required',
        'Tournament name is required',
        'Forum post URL is required',
        'Ruleset is required',
        'Lobby size is required',
        'Rank restriction is required',
      ]) {
        await expect(form.getByText(message, { exact: true })).toBeVisible();
      }
    });

    test('a reload keeps what was typed, select choices included', async ({
      page,
    }) => {
      await page.goto(ROUTES.tournamentSubmit);
      await page.waitForLoadState('networkidle');

      const form = page.locator('[data-testid="tournament-submission-form"]');
      const name = form.getByLabel('Name', { exact: true });
      const ruleset = form.getByRole('combobox', { name: 'Ruleset' });
      const lobbySize = form.getByRole('combobox', { name: 'Lobby size' });

      await name.fill('E2E draft check');
      // taiko rather than osu!: a select restored as empty reads as 0, osu!.
      await ruleset.click();
      await page.getByRole('option', { name: 'taiko', exact: true }).click();
      await lobbySize.click();
      await page.getByRole('option', { name: '2v2', exact: true }).click();

      await page.reload();
      await page.waitForLoadState('networkidle');

      await expect(name).toHaveValue('E2E draft check');
      await expect(ruleset).toHaveText('taiko');
      await expect(lobbySize).toHaveText('2v2');

      await form.getByRole('button', { name: 'Clear' }).click();
      await page.reload();
      await page.waitForLoadState('networkidle');

      await expect(name).toHaveValue('');
      await expect(ruleset).toHaveText('Select ruleset');
    });

    test('submission is auth-gated for unauthenticated users', async ({
      page,
    }) => {
      // Assert the gate at the API boundary rather than submitting for real
      const response = await page.request.post('/api/tournaments:submit', {
        data: {
          name: 'E2E Gate Check',
          abbreviation: 'EGC',
          forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
          ruleset: Ruleset.Osu,
          rankRangeLowerBound: 1,
          lobbySize: 1,
          ids: [1],
          beatmapIds: [],
        },
        failOnStatusCode: false,
      });

      expect(response.ok()).toBe(false);
      expect([401, 403]).toContain(response.status());
    });
  });
});
