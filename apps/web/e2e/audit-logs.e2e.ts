import { test, expect, type Locator, type Page } from '@playwright/test';
import { TEST_TOURNAMENT_ID, ROUTES } from './fixtures/test-config';

async function openFilters(page: Page) {
  await page
    .locator('[data-testid="audit-filter-bar"]')
    .getByRole('button', { name: /^Filters/ })
    .click();
}

test.describe('Audit Event Feed Page', () => {
  test.describe('Page Load', () => {
    test('displays page heading and description', async ({ page }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      const heading = page.locator('[data-testid="audit-logs-heading"]');
      await expect(heading).toBeVisible({ timeout: 10000 });
      await expect(heading).toHaveText('Audit logs');

      const description = page.locator('text=Browse the history of changes');
      await expect(description).toBeVisible();
    });

    test('renders the toolbar with the filters and the system switch', async ({
      page,
    }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      const filterBar = page.locator('[data-testid="audit-filter-bar"]');
      await expect(filterBar).toBeVisible({ timeout: 10000 });

      await expect(
        filterBar.getByRole('button', { name: /^Filters/ })
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="filter-show-system"]')
      ).toBeVisible();
    });

    test('displays event cards after loading', async ({ page }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      const eventList = page.locator('[data-testid="audit-event-list"]');
      await expect(eventList).toBeVisible({ timeout: 15000 });

      const cards = page.locator('[data-testid="audit-event-card"]');
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Filter Controls', () => {
    test('filter panel shows action type, entity type and field options', async ({
      page,
    }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      await openFilters(page);
      const panel = page.getByRole('dialog', { name: 'Filter audit events' });
      await expect(panel).toBeVisible();

      for (const name of ['Created', 'Updated', 'Deleted']) {
        await expect(panel.getByRole('button', { name })).toBeVisible();
      }
      await expect(
        panel.getByRole('button', { name: 'Tournament' })
      ).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Match' })).toBeVisible();
      await expect(panel.getByPlaceholder('Search fields')).toBeVisible();
    });

    test('show system events switch toggles and is kept in the address', async ({
      page,
    }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      const toggle = page.locator('[data-testid="filter-show-system"]');
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(page).toHaveURL(/[?&]system=true/);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page).not.toHaveURL(/system=/);
    });

    test('a filter shows as a chip, lives in the address and clears', async ({
      page,
    }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      const activeFilters = page.getByRole('group', { name: 'Active filters' });
      await expect(activeFilters).toHaveCount(0);

      await openFilters(page);
      await page
        .getByRole('dialog', { name: 'Filter audit events' })
        .getByRole('button', { name: 'Tournament' })
        .click();
      await page.keyboard.press('Escape');

      await expect(page).toHaveURL(/[?&]entity=tournament/);
      await expect(activeFilters).toBeVisible();
      await expect(activeFilters).toContainText('Entity type: Tournament');

      await activeFilters.getByRole('button', { name: 'Clear all' }).click();
      await expect(activeFilters).toHaveCount(0);
      await expect(page).not.toHaveURL(/entity=/);
    });

    test('clear all leaves the system events switch alone', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.auditLogs}?entity=tournament&system=true`);
      await page.waitForLoadState('networkidle');

      const activeFilters = page.getByRole('group', { name: 'Active filters' });
      await activeFilters.getByRole('button', { name: 'Clear all' }).click();

      await expect(activeFilters).toHaveCount(0);
      await expect(page).not.toHaveURL(/entity=/);
      await expect(page).toHaveURL(/[?&]system=true/);
      await expect(
        page.locator('[data-testid="filter-show-system"]')
      ).toHaveAttribute('aria-checked', 'true');
    });

    test('filters in the address apply on load', async ({ page }) => {
      await page.goto(`${ROUTES.auditLogs}?action=updated&entity=match`);
      await page.waitForLoadState('networkidle');

      const activeFilters = page.getByRole('group', { name: 'Active filters' });
      await expect(activeFilters).toContainText('Action type: Updated');
      await expect(activeFilters).toContainText('Entity type: Match');
      await expect(
        page.locator('[data-testid="audit-filter-bar"]').getByRole('button', {
          name: 'Filters, 2 active',
        })
      ).toBeVisible();
    });
  });

  test.describe('Event Cards', () => {
    test('event cards display description and timestamp', async ({ page }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      const eventList = page.locator('[data-testid="audit-event-list"]');
      await expect(eventList).toBeVisible({ timeout: 15000 });

      const firstCard = page
        .locator('[data-testid="audit-event-card"]')
        .first();
      await expect(firstCard).toBeVisible();

      const description = firstCard.locator(
        '[data-testid="event-card-description"]'
      );
      await expect(description).toBeVisible();
      await expect(description).not.toBeEmpty();

      const timestamp = firstCard.locator(
        '[data-testid="event-card-timestamp"] time'
      );
      await expect(timestamp).toBeVisible();
    });

    test('expandable event card shows its details on click', async ({
      page,
    }) => {
      // Updates carry the changed fields, so their cards expand.
      await page.goto(`${ROUTES.auditLogs}?action=updated`);
      await page.waitForLoadState('networkidle');

      const eventList = page.locator('[data-testid="audit-event-list"]');
      await expect(eventList).toBeVisible({ timeout: 15000 });

      const expandableCard = page
        .locator('[data-testid="audit-event-card"]')
        .filter({ has: page.locator('[data-testid="audit-event-toggle"]') })
        .first();
      await expect(expandableCard).toBeVisible();

      const toggle = expandableCard.locator(
        '[data-testid="audit-event-toggle"]'
      );
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');

      const diff = expandableCard.locator('[data-testid="event-card-diff"]');
      await expect(diff).toBeVisible({ timeout: 5000 });
    });

    test('diff display shows field label, old value, and new value', async ({
      page,
    }) => {
      await page.goto(`${ROUTES.auditLogs}?action=updated`);
      await page.waitForLoadState('networkidle');

      const eventList = page.locator('[data-testid="audit-event-list"]');
      await expect(eventList).toBeVisible({ timeout: 15000 });

      // An event that changed one entity lists its fields; one that changed
      // several lists the entities instead.
      const cards = page
        .locator('[data-testid="audit-event-card"]')
        .filter({ has: page.locator('[data-testid="audit-event-toggle"]') });
      const cardCount = await cards.count();
      let diffRow: Locator | null = null;

      for (let i = 0; i < cardCount && !diffRow; i++) {
        const card = cards.nth(i);
        await card.locator('[data-testid="audit-event-toggle"]').click();
        const row = card.locator('[data-audit-field]').first();
        const shown = await row.waitFor({ timeout: 3000 }).then(
          () => true,
          () => false
        );
        if (shown) diffRow = row;
      }

      expect(diffRow, 'no updated event lists its fields').not.toBeNull();
      await expect(diffRow!.locator('dt')).not.toBeEmpty();
      // The old value struck through, then the new one, or "No value".
      const values = diffRow!.locator('dd');
      await expect(values.locator('del, ins').first()).not.toBeEmpty();
      await expect(values).toContainText('changed to');
    });

    test('event card entity link navigates to audit timeline', async ({
      page,
    }) => {
      await page.goto(ROUTES.auditLogs);
      await page.waitForLoadState('networkidle');

      const eventList = page.locator('[data-testid="audit-event-list"]');
      await expect(eventList).toBeVisible({ timeout: 15000 });

      const firstCard = page
        .locator('[data-testid="audit-event-card"]')
        .first();
      const entityLink = firstCard
        .locator('[data-testid="event-card-description"] a[href^="/audit/"]')
        .first();

      await expect(entityLink).toBeVisible();
      const href = await entityLink.getAttribute('href');
      await entityLink.click();
      await page.waitForURL(`**${href}`, { timeout: 10000 });
      await expect(
        page.locator('[data-testid="audit-page-header"]')
      ).toBeVisible({ timeout: 10000 });
    });
  });
});

test.describe('Entity Audit Timeline Page', () => {
  test.describe('Page Header', () => {
    test('displays the entity title and which record it is', async ({
      page,
    }) => {
      await page.goto(ROUTES.auditTournament(TEST_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const header = page.locator('[data-testid="audit-page-header"]');
      await expect(header).toBeVisible({ timeout: 10000 });

      const title = page.locator('[data-testid="audit-entity-title"]');
      await expect(title).toBeVisible();
      await expect(title).not.toBeEmpty();

      await expect(
        page.locator('[data-testid="audit-entity-description"]')
      ).toContainText(`#${TEST_TOURNAMENT_ID}`);
    });

    test('back link opens the tournament', async ({ page }) => {
      await page.goto(ROUTES.auditTournament(TEST_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const backLink = page
        .locator('[data-testid="audit-page-header"]')
        .getByRole('link', { name: 'View tournament' });
      await expect(backLink).toBeVisible({ timeout: 10000 });
      await expect(backLink).toHaveAttribute(
        'href',
        `/tournaments/${TEST_TOURNAMENT_ID}`
      );
    });
  });

  test.describe('Timeline Content', () => {
    test('shows change count in the toolbar', async ({ page }) => {
      await page.goto(ROUTES.auditTournament(TEST_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const summary = page.locator('[data-testid="timeline-summary"]');
      await expect(summary).toBeVisible({ timeout: 15000 });
      await expect(summary).toContainText(/\d+ changes?/);
    });

    test('renders timeline entries with their actions', async ({ page }) => {
      await page.goto(ROUTES.auditTournament(TEST_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const entryList = page.locator('[data-testid="timeline-entry-list"]');
      await expect(entryList).toBeVisible({ timeout: 15000 });

      const entries = page.locator('[data-testid="timeline-entry"]');
      const count = await entries.count();
      expect(count).toBeGreaterThan(0);

      const verbs = page.locator('[data-testid="timeline-action-badge"]');
      const verbCount = await verbs.count();
      expect(verbCount).toBeGreaterThan(0);
    });

    test('timeline entry expands to show field diffs', async ({ page }) => {
      await page.goto(ROUTES.auditTournament(TEST_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const entryList = page.locator('[data-testid="timeline-entry-list"]');
      await expect(entryList).toBeVisible({ timeout: 15000 });

      const entry = page
        .locator('[data-testid="timeline-entry"]')
        .filter({ has: page.locator('[data-testid="timeline-entry-toggle"]') })
        .first();

      await expect(entry).toBeVisible();
      // Entries with fewer than 10 changes open on their own.
      if ((await entry.getAttribute('data-state')) !== 'open') {
        await entry.locator('[data-testid="timeline-entry-toggle"]').click();
      }

      const diff = entry.locator('[data-testid="timeline-entry-diff"]');
      await expect(diff).toBeVisible({ timeout: 5000 });
      await expect(entry.locator('[data-audit-field]').first()).toBeVisible();
    });

    test('timeline entries display timestamps', async ({ page }) => {
      await page.goto(ROUTES.auditTournament(TEST_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      const entryList = page.locator('[data-testid="timeline-entry-list"]');
      await expect(entryList).toBeVisible({ timeout: 15000 });

      const firstEntry = page.locator('[data-testid="timeline-entry"]').first();
      const timestamp = firstEntry.locator('time');
      await expect(timestamp).toBeVisible();
      await expect(timestamp).not.toBeEmpty();
    });

    test('a failed load more keeps the rows and offers to try again', async ({
      page,
    }) => {
      // Fail every batch after the first.
      await page.route('**/rpc/audit/descendants**', async (route) => {
        if (/"page":[2-9]/.test(route.request().postData() ?? '')) {
          await route.fulfill({ status: 500, body: '{}' });
          return;
        }
        await route.continue();
      });
      await page.goto(
        `${ROUTES.auditTournament(TEST_TOURNAMENT_ID)}?tab=scores`
      );
      await page.waitForLoadState('networkidle');

      // The test tournament has hundreds of changed scores.
      const loadMore = page.getByRole('button', { name: 'Load more' });
      await expect(loadMore).toBeVisible({ timeout: 15000 });
      const rows = page.locator('[data-testid="timeline-entry"]');
      const shown = await rows.count();

      await loadMore.click();
      await expect(
        page.getByText('More changed scores could not load')
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByRole('button', { name: 'Try again' })
      ).toBeVisible();
      expect(await rows.count()).toBe(shown);
    });

    test('tabs switch to descendants and stay in the address', async ({
      page,
    }) => {
      await page.goto(ROUTES.auditTournament(TEST_TOURNAMENT_ID));
      await page.waitForLoadState('networkidle');

      // While the page streams in after a load, React briefly holds a
      // second, hidden copy of it; only the visible tabs count.
      const tab = (name: string) =>
        page
          .locator(`[data-testid="audit-tab-${name}"]`)
          .filter({ visible: true });

      const tabs = page.locator('[data-testid="audit-scope-tabs"]');
      await expect(tabs).toBeVisible({ timeout: 10000 });
      await expect(tab('self')).toHaveAttribute('aria-current', 'page');

      await tab('matches').click();
      await expect(page).toHaveURL(/[?&]tab=matches/);
      await expect(tab('matches')).toHaveAttribute('aria-current', 'page');
      await expect(
        page
          .locator(
            '[data-testid="timeline-entry-list"], [data-testid="audit-timeline-empty"]'
          )
          .first()
      ).toBeVisible({ timeout: 15000 });

      await page.reload();
      await expect(tab('matches')).toHaveAttribute('aria-current', 'page', {
        timeout: 10000,
      });
    });
  });
});
