import { test, expect, type Locator, type Page } from '@playwright/test';
import { STORAGE_STATE } from './fixtures/auth';
import { createOrpcClientForRole } from './fixtures/orpc';
import {
  TEST_MATCH_ID,
  TEST_PUBLIC_TOURNAMENT_ID,
  ROUTES,
} from './fixtures/test-config';

test.describe('Match Detail Page', () => {
  test.describe('Page Load', () => {
    test('loads with the match name as the page heading', async ({ page }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const matchName = page.locator('[data-testid="match-name"]');
      await expect(matchName).toBeVisible({ timeout: 10000 });
      await expect(matchName).not.toBeEmpty();
      await expect(
        page.getByRole('heading', { level: 1 }).getByTestId('match-name')
      ).toBeVisible();
    });

    test('displays match name and parent tournament context', async ({
      page,
    }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="match-name"]')).toBeVisible({
        timeout: 10000,
      });

      const tournamentLink = page.locator(
        '[data-testid="match-tournament-link"]'
      );
      await expect(tournamentLink).toBeVisible({ timeout: 10000 });
      await expect(tournamentLink).not.toBeEmpty();
    });

    test('the verification badge fits a 375px screen', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const badge = page.locator('[data-slot="verification-status-badge"]');
      await expect(badge).toBeVisible({ timeout: 10000 });
      expect(
        await badge.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(375);
    });

    test('page title contains match name', async ({ page }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const matchName = page.locator('[data-testid="match-name"]');
      await expect(matchName).not.toBeEmpty({ timeout: 10000 });
      await expect(page).toHaveTitle(`${await matchName.innerText()} | o!TR`);
    });

    test('displays match tabs', async ({ page }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="match-tabs"]')).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.locator('[data-testid="tab-trigger-games"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="tab-trigger-stats"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="tab-trigger-games"]')
      ).toHaveAttribute('aria-current', 'page');
    });

    test('links to the public audit history from the header', async ({
      page,
    }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('link', { name: 'View audit history' }).first()
      ).toHaveAttribute('href', `/audit/matches/${TEST_MATCH_ID}`);
    });
  });

  test.describe('Games Tab', () => {
    test('lists individual games with beatmap info', async ({ page }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const beatmapLinks = page.locator('[data-testid="beatmap-link"]');
      await expect(beatmapLinks.first()).toBeVisible({ timeout: 10000 });

      const count = await beatmapLinks.count();
      expect(count).toBeGreaterThan(0);
    });

    test('individual game rows show scores and player performance', async ({
      page,
    }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const playerLinks = page.locator(
        '[data-testid="score-player-link"]:visible'
      );
      await expect(playerLinks.first()).toBeVisible({ timeout: 10000 });

      const count = await playerLinks.count();
      expect(count).toBeGreaterThan(0);
    });

    test('displays game outcome for completed games', async ({ page }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const outcomes = page.locator('[data-testid="game-outcome"]');
      await expect(outcomes.first()).toBeVisible({ timeout: 10000 });
    });

    test('each game card has one actions menu with its public actions', async ({
      page,
    }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const firstGame = page.locator('[id^="game-"]').first();
      const actions = firstGame.getByTestId('game-actions');
      await expect(actions).toHaveCount(1);
      // Named with the game's place, as one beatmap can be played twice.
      await expect(actions).toHaveAccessibleName(/^Actions for Game 1(:|,|$)/);
      await actions.click();

      const menu = page.getByTestId('game-actions-content');
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'View audit history' })
      ).toHaveAttribute('href', /^\/audit\/games\/\d+$/);
    });
  });

  test.describe('Stats Tab', () => {
    test('displays match statistics table when stats tab is active', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.match(TEST_MATCH_ID)}?tab=stats`);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="player-stats-table"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="match-stats-summary"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole('heading', { name: 'Match statistics' })
      ).toBeVisible();
    });

    test('navigating to stats tab via trigger reveals statistics', async ({
      page,
    }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const statsTrigger = page.locator('[data-testid="tab-trigger-stats"]');
      await expect(statsTrigger).toBeVisible({ timeout: 10000 });
      await statsTrigger.click();
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="player-stats-table"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('displays team scores chart with rendered content', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.match(TEST_MATCH_ID)}?tab=stats`);
      await page.waitForLoadState('networkidle');

      const chart = page.locator('[data-testid="team-scores-chart"]');
      await expect(chart).toBeVisible({ timeout: 15000 });
      await expect(chart.locator('.recharts-wrapper')).toBeVisible({
        timeout: 15000,
      });
      await expect(chart.getByRole('img')).toHaveAccessibleName(
        /Line chart of verified team scores/
      );
    });

    test('displays player statistics rows', async ({ page }) => {
      await page.goto(`${ROUTES.match(TEST_MATCH_ID)}?tab=stats`);
      await page.waitForLoadState('networkidle');

      const statRows = page.locator('[data-testid^="player-stats-row-"]');
      await expect(statRows.first()).toBeVisible({ timeout: 10000 });

      const count = await statRows.count();
      expect(count).toBeGreaterThan(0);
    });

    test('sort controls expose state and reorder player rows', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.match(TEST_MATCH_ID)}?tab=stats`);
      await page.waitForLoadState('networkidle');

      const costHeader = page.locator('[data-testid="match-cost-header"]');
      // The rows are all on the page, so the header sorts them in place.
      const costSort = costHeader.getByRole('button', { name: 'Match cost' });
      const rows = page.locator('[data-testid^="player-stats-row-"]');
      const getMatchCosts = () =>
        rows.evaluateAll((elements) =>
          elements.map((element) =>
            Number(element.getAttribute('data-match-cost'))
          )
        );

      await expect(costHeader).toHaveAttribute('aria-sort', 'descending');
      const descendingCosts = await getMatchCosts();
      expect(descendingCosts).toEqual(
        [...descendingCosts].sort((first, second) => second - first)
      );

      await costSort.click();
      await expect(costHeader).toHaveAttribute('aria-sort', 'ascending');
      await expect(page).toHaveURL(/[?&]dir=asc/);
      const ascendingCosts = await getMatchCosts();
      expect(ascendingCosts).toEqual(
        [...ascendingCosts].sort((first, second) => first - second)
      );
    });

    // Back right after a sort leaves the rows in the new order (#1134).
    test.fixme('Back right after a sort restores the previous order', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.match(TEST_MATCH_ID)}?tab=stats`);
      await page.waitForLoadState('networkidle');

      const costHeader = page.locator('[data-testid="match-cost-header"]');
      const getMatchCosts = () =>
        page
          .locator('[data-testid^="player-stats-row-"]')
          .evaluateAll((elements) =>
            elements.map((element) =>
              Number(element.getAttribute('data-match-cost'))
            )
          );
      await expect(costHeader).toHaveAttribute('aria-sort', 'descending');
      const descendingCosts = await getMatchCosts();
      await costHeader.getByRole('button', { name: 'Match cost' }).click();
      await expect(page).toHaveURL(/[?&]dir=asc/);

      await page.goBack();
      await expect(page).not.toHaveURL(/dir=/);
      await expect(costHeader).toHaveAttribute('aria-sort', 'descending');
      expect(await getMatchCosts()).toEqual(descendingCosts);
    });

    test('mobile player rows keep every metric visible without page overflow', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${ROUTES.match(TEST_MATCH_ID)}?tab=stats`);
      await page.waitForLoadState('networkidle');

      const firstPlayer = page
        .locator('[data-testid^="player-stats-phone-row-"]')
        .first();
      await expect(firstPlayer).toBeVisible({ timeout: 10000 });

      for (const label of [
        'Match cost',
        'Record',
        'Score',
        'Accuracy',
        'Misses',
        'Placement',
      ]) {
        await expect(
          firstPlayer.getByText(label, { exact: true })
        ).toBeVisible();
      }

      const hasPageOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      );
      expect(hasPageOverflow).toBe(false);

      await page.getByLabel('Sort players by').click();
      await page.getByRole('option', { name: 'Player' }).click();
      await expect(page.getByLabel('Sort players by')).toContainText('Player');

      const directionButton = page.getByRole('button', {
        name: 'Sort order is ascending',
      });
      await directionButton.click();
      await expect(
        page.getByRole('button', { name: 'Sort order is descending' })
      ).toBeVisible();
      await expect(page).toHaveURL(/[?&]sort=player/);
    });
  });

  test.describe('Navigation and Links', () => {
    test('links back to the parent tournament page', async ({ page }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const tournamentLink = page.locator(
        '[data-testid="match-tournament-link"]'
      );
      await expect(tournamentLink).toBeVisible({ timeout: 10000 });

      const href = await tournamentLink.getAttribute('href');
      expect(href).toContain(ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID));

      await tournamentLink.click();
      await page.waitForURL(
        `**${ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)}**`,
        {
          timeout: 20000,
        }
      );
      expect(page.url()).toContain(
        ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID)
      );
    });

    test('links to a player profile from match participants', async ({
      page,
    }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const playerLink = page
        .locator('[data-testid="score-player-link"]:visible')
        .first();
      await expect(playerLink).toBeVisible({ timeout: 10000 });

      const href = await playerLink.getAttribute('href');
      expect(href).toContain('/players/');

      await playerLink.click();
      await page.waitForURL('**/players/**', { timeout: 20000 });
      expect(page.url()).toContain('/players/');
    });

    test('links to a beatmap page from a game listing', async ({ page }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      const beatmapLink = page.locator('[data-testid="beatmap-link"]').first();
      await expect(beatmapLink).toBeVisible({ timeout: 10000 });

      const href = await beatmapLink.getAttribute('href');
      expect(href).toContain('/beatmaps/');

      await beatmapLink.click();
      await page.waitForURL('**/beatmaps/**', { timeout: 20000 });
      expect(page.url()).toContain('/beatmaps/');
    });
  });

  test.describe('Admin forms', () => {
    test.use({ storageState: STORAGE_STATE.admin });

    /**
     * Opens a menu and chooses an item, clicking the trigger again until the
     * item shows, since the dev server can still be hydrating the page when
     * the first click lands.
     */
    async function chooseMenuItem(
      page: Page,
      trigger: Locator,
      name: string | RegExp
    ): Promise<void> {
      const item = page.getByRole('menuitem', { name });
      await expect(async () => {
        if (!(await item.isVisible())) await trigger.click();
        await expect(item).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30000 });
      await item.click();
    }

    test('the note step of a sensitive score edit labels its field', async ({
      page,
    }) => {
      await page.goto(ROUTES.match(TEST_MATCH_ID));
      await page.waitForLoadState('networkidle');

      await chooseMenuItem(
        page,
        page.locator('[data-testid="score-actions"]:visible').first(),
        'Edit score'
      );

      // A changed combo asks for a note; Back leaves the score unsaved.
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveAccessibleName('Edit score');
      const maxCombo = dialog.getByLabel('Max combo');
      await maxCombo.fill(String(Number(await maxCombo.inputValue()) + 1));
      await dialog.getByRole('button', { name: 'Save changes' }).click();

      await expect(dialog).toHaveAccessibleName('Admin note required');
      await expect(
        dialog.getByRole('textbox', { name: 'Admin note' })
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Back' }).click();
      await expect(dialog).toHaveAccessibleName('Edit score');
    });

    test('a cancelled note edit opens again with the saved text', async ({
      page,
    }) => {
      const admin = createOrpcClientForRole('admin');
      const saved = `E2E note ${Date.now()}`;
      const note = await admin.matches.adminNotes.create({
        matchId: TEST_MATCH_ID,
        note: saved,
      });

      try {
        await page.goto(ROUTES.match(TEST_MATCH_ID));
        await page.waitForLoadState('networkidle');

        await chooseMenuItem(
          page,
          page.getByTestId('match-admin-menu'),
          /^Admin notes/
        );

        const dialog = page.getByTestId('admin-notes-dialog');
        const item = dialog.getByRole('listitem').filter({ hasText: saved });
        await item.getByRole('button', { name: 'Edit note' }).click();

        const editor = dialog.getByRole('textbox', { name: 'Edit note' });
        await expect(editor).toHaveValue(saved);
        await editor.fill('A draft that was never saved');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(editor).toBeHidden();

        await item.getByRole('button', { name: 'Edit note' }).click();
        await expect(editor).toHaveValue(saved);
      } finally {
        await admin.matches.adminNotes.delete({ noteId: note.id });
      }
    });
  });
});
