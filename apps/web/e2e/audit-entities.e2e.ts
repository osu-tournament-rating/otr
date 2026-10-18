import { test, expect, type Page } from '@playwright/test';
import {
  TEST_AUDIT_MATCH_ID,
  TEST_AUDIT_GAME_ID,
  TEST_AUDIT_SCORE_ID,
  ROUTES,
} from './fixtures/test-config';

type EntityCase = {
  label: string;
  id: number;
  route: string;
  /**
   * The page header's back link: the entity's own page, where a game or
   * score is its match's page scrolled to it.
   */
  backLink: { name: string; href: string | RegExp };
  /** Tabs for the entity's descendants. */
  descendantTabs: string[];
};

const ENTITY_CASES: EntityCase[] = [
  {
    label: 'Match',
    id: TEST_AUDIT_MATCH_ID,
    route: ROUTES.auditMatch(TEST_AUDIT_MATCH_ID),
    backLink: { name: 'View match', href: `/matches/${TEST_AUDIT_MATCH_ID}` },
    descendantTabs: ['games', 'scores'],
  },
  {
    label: 'Game',
    id: TEST_AUDIT_GAME_ID,
    route: ROUTES.auditGame(TEST_AUDIT_GAME_ID),
    backLink: {
      name: 'View game',
      href: new RegExp(`^/matches/\\d+\\?gameId=${TEST_AUDIT_GAME_ID}$`),
    },
    descendantTabs: ['scores'],
  },
  {
    label: 'Score',
    id: TEST_AUDIT_SCORE_ID,
    route: ROUTES.auditScore(TEST_AUDIT_SCORE_ID),
    backLink: {
      name: 'View score',
      href: new RegExp(`^/matches/\\d+\\?scoreId=${TEST_AUDIT_SCORE_ID}$`),
    },
    descendantTabs: [],
  },
];

async function gotoAudit(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}

for (const entity of ENTITY_CASES) {
  test.describe(`${entity.label} Audit Timeline Page`, () => {
    test.describe('Page Header', () => {
      test('displays the entity title and which record it is', async ({
        page,
      }) => {
        await gotoAudit(page, entity.route);

        const header = page.locator('[data-testid="audit-page-header"]');
        await expect(header).toBeVisible({ timeout: 10000 });

        const title = page.locator('[data-testid="audit-entity-title"]');
        await expect(title).toBeVisible();
        await expect(title).not.toBeEmpty();

        await expect(
          page.locator('[data-testid="audit-entity-description"]')
        ).toContainText(`#${entity.id}`);
      });

      test("back link goes to the entity's page", async ({ page }) => {
        await gotoAudit(page, entity.route);

        const backLink = page
          .locator('[data-testid="audit-page-header"]')
          .getByRole('link', { name: entity.backLink.name });
        await expect(backLink).toBeVisible({ timeout: 10000 });
        await expect(backLink).toHaveAttribute('href', entity.backLink.href);

        // A game or score opens on its match's page, scrolled to it.
        const { href } = entity.backLink;
        if (href instanceof RegExp) {
          await backLink.click();
          await page.waitForURL((url) => href.test(url.pathname + url.search), {
            timeout: 15000,
          });
        }
      });

      test('shows a tab per descendant level', async ({ page }) => {
        await gotoAudit(page, entity.route);

        const tabs = page.locator('[data-testid="audit-scope-tabs"]');
        if (entity.descendantTabs.length === 0) {
          await expect(tabs).toHaveCount(0);
          return;
        }

        await expect(tabs).toBeVisible({ timeout: 10000 });
        for (const tab of entity.descendantTabs) {
          await expect(
            page.locator(`[data-testid="audit-tab-${tab}"]`)
          ).toBeVisible();
        }
      });
    });

    test.describe('Timeline Content', () => {
      test('shows change count in the toolbar', async ({ page }) => {
        await gotoAudit(page, entity.route);

        const summary = page.locator('[data-testid="timeline-summary"]');
        await expect(summary).toBeVisible({ timeout: 15000 });
        await expect(summary).toContainText(/\d+ changes?/);
      });

      test('renders timeline entries with their actions', async ({ page }) => {
        await gotoAudit(page, entity.route);

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
        await gotoAudit(page, entity.route);

        const entryList = page.locator('[data-testid="timeline-entry-list"]');
        await expect(entryList).toBeVisible({ timeout: 15000 });

        const entry = page
          .locator('[data-testid="timeline-entry"]')
          .filter({
            has: page.locator('[data-testid="timeline-entry-toggle"]'),
          })
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
        await gotoAudit(page, entity.route);

        const entryList = page.locator('[data-testid="timeline-entry-list"]');
        await expect(entryList).toBeVisible({ timeout: 15000 });

        const firstEntry = page
          .locator('[data-testid="timeline-entry"]')
          .first();
        const timestamp = firstEntry.locator('time');
        await expect(timestamp).toBeVisible();
        await expect(timestamp).not.toBeEmpty();
      });

      test('system events switch is kept in the address', async ({ page }) => {
        await gotoAudit(page, entity.route);

        const toggle = page.locator('[data-testid="audit-show-system"]');
        await expect(toggle).toBeVisible({ timeout: 10000 });
        await expect(toggle).toHaveAttribute('aria-checked', 'false');

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(page).toHaveURL(/[?&]system=true/);
      });
    });
  });
}

test.describe('Audit timeline on a phone', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("a match's history fits the screen without sideways scroll", async ({
    page,
  }) => {
    await gotoAudit(page, ROUTES.auditMatch(TEST_AUDIT_MATCH_ID));

    const entries = page.locator('[data-testid="timeline-entry"]');
    await expect(entries.first()).toBeVisible({ timeout: 15000 });
    expect(await entries.count()).toBeGreaterThan(1);

    // Open every entry, so the field diffs count toward the width too.
    const closed = page.locator(
      '[data-testid="timeline-entry-toggle"][aria-expanded="false"]'
    );
    while ((await closed.count()) > 0) {
      await closed.first().click();
    }
    await expect(
      page.locator('[data-testid="timeline-entry-diff"]').first()
    ).toBeVisible();

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth
    );
    expect(scrollWidth).toBeLessThanOrEqual(375);

    // The panel clips what spills past it, so the page alone can't show a
    // row that is too wide; each row and its time must fit as well.
    const tooWide = await entries.evaluateAll((rows) =>
      rows
        .filter((row) => row.scrollWidth > row.clientWidth)
        .map((row) => row.id)
    );
    expect(tooWide).toEqual([]);

    const timeRights = await entries
      .locator('time')
      .evaluateAll((times) =>
        times.map((time) => time.getBoundingClientRect().right)
      );
    expect(timeRights.length).toBeGreaterThan(1);
    expect(Math.max(...timeRights)).toBeLessThanOrEqual(375);
  });
});
