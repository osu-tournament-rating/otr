import { test, expect, type Page } from '@playwright/test';
import {
  ROUTES,
  Ruleset,
  TEST_PLAYER_ID,
  TEST_PUBLIC_TOURNAMENT_ID,
  TEST_MATCH_ID,
  TEST_BEATMAP_OSU_ID,
} from './fixtures/test-config';
import { STORAGE_STATE } from './fixtures/auth';

/**
 * Global website search (issue #700). The dialog and the `/search` endpoint are
 * open to everyone; a session only marks friends. Most specs run with a baked
 * regular-user session, the signed-out ones without.
 */

const SEARCH_TRIGGER = '[data-testid="search-trigger-button"]';
const SEARCH_DIALOG = '[data-testid="search-dialog"]';
const SEARCH_INPUT = '[data-testid="search-input"]';
const SEARCH_RESULTS = '[data-testid="search-results-list"]';

async function openSearchViaButton(page: Page) {
  await page.locator(SEARCH_TRIGGER).click();
  await expect(page.locator(SEARCH_DIALOG)).toBeVisible({ timeout: 10000 });
}

async function typeQuery(page: Page, query: string) {
  const input = page.locator(SEARCH_INPUT);
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(query);
}

test.describe('Global Website Search', () => {
  test.describe('Signed out', () => {
    test('the search button opens the dialog without a session', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="header"]')).toBeVisible({
        timeout: 10000,
      });
      await openSearchViaButton(page);
      await expect(page.locator(SEARCH_INPUT)).toBeVisible({ timeout: 10000 });
    });

    test('signed-out session shows the limited-features banner', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText('Some features are not available while signed out.')
      ).toBeVisible({ timeout: 10000 });
    });

    test('Cmd/Ctrl+K opens the dialog without a session', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.keyboard.press('ControlOrMeta+KeyK');
      await expect(page.locator(SEARCH_DIALOG)).toBeVisible({ timeout: 10000 });
    });

    test('a signed-out query finds a player', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');

      await expect(
        page.locator(
          '[data-testid="search-group-players"] [data-value="player-' +
            TEST_PLAYER_ID +
            '"]'
        )
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Search behaviour', () => {
    test.use({ storageState: STORAGE_STATE.user });

    test('a one-character term shows the minimum-length hint and sends nothing', async ({
      page,
    }) => {
      const searchRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/rpc/search/query')) {
          searchRequests.push(request.url());
        }
      });

      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'S');

      await expect(
        page
          .locator(SEARCH_RESULTS)
          .getByText('Type at least 2 characters to search.')
      ).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(800);
      expect(searchRequests).toHaveLength(0);
    });

    test('the clear button empties the field', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');

      await page
        .locator(SEARCH_DIALOG)
        .getByRole('button', { name: 'Clear search' })
        .click();
      await expect(page.locator(SEARCH_INPUT)).toHaveValue('');
      await expect(page.locator(SEARCH_INPUT)).toBeFocused();
    });

    test('See all tournaments opens the tournament list already searched', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'DAS');

      const seeAll = page.locator('[data-testid="search-see-all-tournaments"]');
      await expect(seeAll).toBeVisible({ timeout: 15000 });
      await seeAll.click();

      await page.waitForURL(/\/tournaments\?(.*&)?q=DAS(&|$)/, {
        timeout: 10000,
      });
    });

    test('See all on the leaderboard opens the leaderboard search', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');

      const seeAll = page.locator('[data-testid="search-see-all-players"]');
      await expect(seeAll).toBeVisible({ timeout: 15000 });
      await seeAll.click();

      await page.waitForURL(/\/leaderboard\?(.*&)?q=Stage(&|$)/, {
        timeout: 10000,
      });
    });
  });

  test.describe('Open via Header Affordances', () => {
    test.use({ storageState: STORAGE_STATE.user });

    test('search button opens the command dialog with an input', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await expect(page.locator(SEARCH_INPUT)).toBeVisible({ timeout: 10000 });
      await expect(page.locator(SEARCH_RESULTS)).toBeVisible({
        timeout: 10000,
      });
    });

    test('a failed search shows an error instead of no results', async ({
      page,
    }) => {
      await page.route('**/rpc/search/query', (route) =>
        route.fulfill({ status: 500, body: 'Internal Server Error' })
      );
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');

      const results = page.locator(SEARCH_RESULTS);
      await expect(results.getByRole('alert')).toContainText(
        'Search results could not load',
        {
          timeout: 15000,
        }
      );
      await expect(results).not.toContainText('No results found');
    });

    test('a rate-limited search shows the same error', async ({ page }) => {
      await page.route('**/rpc/search/query', (route) =>
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          headers: { 'retry-after': '1' },
          body: JSON.stringify({
            json: {
              defined: false,
              code: 'TOO_MANY_REQUESTS',
              status: 429,
              message: 'Too many requests. Try again in 1 second.',
              data: { code: 'RATE_LIMITED', retryAfter: 1 },
            },
          }),
        })
      );
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');

      await expect(
        page.locator(SEARCH_RESULTS).getByRole('alert')
      ).toContainText('Search results could not load', { timeout: 15000 });
    });

    test('Cmd/Ctrl+K opens the command dialog', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.keyboard.press('ControlOrMeta+KeyK');
      await expect(page.locator(SEARCH_DIALOG)).toBeVisible({ timeout: 10000 });
      await expect(page.locator(SEARCH_INPUT)).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Query Results and Navigation', () => {
    test.use({ storageState: STORAGE_STATE.user });

    test('arrow keys tint the result Enter opens, without the pointer', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');
      await expect(
        page.locator('[data-testid="search-group-players"]')
      ).toBeVisible({ timeout: 10000 });

      await page.keyboard.press('ArrowDown');
      const selected = page.locator('[cmdk-item][data-selected="true"]');
      await expect(selected).toHaveCount(1);
      // The pointer never touched the list, so only the keyboard set it.
      await expect(selected).not.toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)'
      );
    });

    test('player query "Stage" navigates to the player profile', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');

      const players = page.locator('[data-testid="search-group-players"]');
      await expect(players).toBeVisible({ timeout: 10000 });

      const result = players.locator(
        '[data-value="player-' + TEST_PLAYER_ID + '"]'
      );
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();

      // The dialog always appends a ruleset, never the bare profile path
      await page.waitForURL(
        new RegExp('/players/' + TEST_PLAYER_ID + '\\?ruleset=\\d+'),
        { timeout: 10000 }
      );
      expect(page.url()).toMatch(
        new RegExp('/players/' + TEST_PLAYER_ID + '\\?ruleset=\\d+')
      );
    });

    test('player result links to the profile for its ruleset', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'Stage');

      const result = page.locator(
        '[data-testid="search-group-players"] [data-value="player-' +
          TEST_PLAYER_ID +
          '"]'
      );
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();

      // Stage's rating ruleset is osu!
      await page.waitForURL(
        new RegExp('/players/' + TEST_PLAYER_ID + '\\?ruleset=' + Ruleset.Osu),
        { timeout: 10000 }
      );
      expect(page.url()).toContain(
        '/players/' + TEST_PLAYER_ID + '?ruleset=' + Ruleset.Osu
      );
    });

    test('tournament query by name navigates to the tournament', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, "Dio's Autumn Singles");

      const tournaments = page.locator(
        '[data-testid="search-group-tournaments"]'
      );
      await expect(tournaments).toBeVisible({ timeout: 10000 });

      const result = tournaments.locator(
        '[data-value="tournament-' + TEST_PUBLIC_TOURNAMENT_ID + '"]'
      );
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();

      await page.waitForURL(
        new RegExp('/tournaments/' + TEST_PUBLIC_TOURNAMENT_ID + '(\\?|$)'),
        { timeout: 10000 }
      );
      expect(page.url()).toContain('/tournaments/' + TEST_PUBLIC_TOURNAMENT_ID);
    });

    test('tournament query by abbreviation "DAS" returns a result', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'DAS');

      const result = page.locator(
        '[data-testid="search-group-tournaments"] [data-value="tournament-' +
          TEST_PUBLIC_TOURNAMENT_ID +
          '"]'
      );
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();

      await page.waitForURL(
        new RegExp('/tournaments/' + TEST_PUBLIC_TOURNAMENT_ID + '(\\?|$)'),
        { timeout: 10000 }
      );
      expect(page.url()).toContain('/tournaments/' + TEST_PUBLIC_TOURNAMENT_ID);
    });

    test('match query navigates to the match', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'DAS: (Menty) vs (LINKI)');

      const matches = page.locator('[data-testid="search-group-matches"]');
      await expect(matches).toBeVisible({ timeout: 10000 });

      const result = matches.locator(
        '[data-value="match-' + TEST_MATCH_ID + '"]'
      );
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();

      await page.waitForURL(
        new RegExp('/matches/' + TEST_MATCH_ID + '(\\?|$)'),
        { timeout: 10000 }
      );
      expect(page.url()).toContain('/matches/' + TEST_MATCH_ID);
    });

    test('beatmap query navigates to the beatmap', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'KAC 2012 ULTIMATE MEDLEY');

      const beatmaps = page.locator('[data-testid="search-group-beatmaps"]');
      await expect(beatmaps).toBeVisible({ timeout: 10000 });

      const result = beatmaps.locator(
        '[data-value="beatmap-' + TEST_BEATMAP_OSU_ID + '"]'
      );
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();

      await page.waitForURL(
        new RegExp('/beatmaps/' + TEST_BEATMAP_OSU_ID + '(\\?|$)'),
        { timeout: 10000 }
      );
      expect(page.url()).toContain('/beatmaps/' + TEST_BEATMAP_OSU_ID);
    });

    test('beatmap query by artist returns a result', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await openSearchViaButton(page);
      await typeQuery(page, 'FLOOR LEGENDS -KAC 2012-');

      const result = page.locator(
        '[data-testid="search-group-beatmaps"] [data-value="beatmap-' +
          TEST_BEATMAP_OSU_ID +
          '"]'
      );
      await expect(result).toBeVisible({ timeout: 10000 });
      await result.click();

      await page.waitForURL(
        new RegExp('/beatmaps/' + TEST_BEATMAP_OSU_ID + '(\\?|$)'),
        { timeout: 10000 }
      );
      expect(page.url()).toContain('/beatmaps/' + TEST_BEATMAP_OSU_ID);
    });
  });
});
