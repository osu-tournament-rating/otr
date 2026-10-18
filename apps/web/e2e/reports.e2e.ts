import { randomUUID } from 'node:crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ReportEntityType, ReportStatus } from '@otr/core/osu';

import { STORAGE_STATE } from './fixtures/auth';
import { createOrpcClientForRole } from './fixtures/orpc';
import {
  ROUTES,
  TEST_MATCH_ID,
  TEST_PUBLIC_TOURNAMENT_ID,
  TEST_TOURNAMENT_ID,
} from './fixtures/test-config';

type UserClient = ReturnType<typeof createOrpcClientForRole>;

type ReportTarget = {
  entityId: number;
  route: string;
};

/**
 * Opens the report dialog for an entity: its flag button, or the "Report an
 * issue" item in the card's actions menu where the page keeps it there.
 * Retries until the dialog shows, since the dev server can still be
 * hydrating the page when the first click lands.
 */
async function openReportDialog(
  page: Page,
  entityType: ReportEntityType,
  target: ReportTarget
): Promise<Locator> {
  const dialog = page.locator(
    `[data-testid="report-dialog"][data-entity-type="${entityType}"][data-entity-id="${target.entityId}"]`
  );

  await expect(async () => {
    if (await dialog.isVisible()) return;
    await clickReportTrigger(page, entityType, target);
    await expect(dialog).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });

  return dialog;
}

async function clickReportTrigger(
  page: Page,
  entityType: ReportEntityType,
  target: ReportTarget
): Promise<void> {
  const triggerSelector = [
    '[data-testid="report-button"]',
    `[data-entity-type="${entityType}"]`,
    `[data-entity-id="${target.entityId}"]`,
  ].join('');

  const card =
    entityType === ReportEntityType.Score
      ? page.locator(`#score-${target.entityId}`)
      : entityType === ReportEntityType.Game
        ? page.locator(`#game-${target.entityId}`)
        : null;
  if (card) {
    await expect(card).toBeVisible({ timeout: 10000 });
    // Score cards show their actions on hover.
    await card.hover();
  }

  const scope: Page | Locator = card ?? page;
  const trigger = scope.locator(`${triggerSelector}:visible`);
  const actions = scope.getByRole('button', { name: /^Actions for/ }).first();
  // The flag renders once the page knows the session, after hydration.
  await expect(trigger.or(actions).first()).toBeVisible({ timeout: 5000 });
  if ((await trigger.count()) > 0) {
    await expect(trigger).toHaveCount(1);
    await trigger.click();
    return;
  }

  await actions.click();
  await page.getByRole('menuitem', { name: 'Report an issue' }).click();
}

const REPORT_SCENARIOS = [
  { name: 'tournament', entityType: ReportEntityType.Tournament },
  { name: 'match', entityType: ReportEntityType.Match },
  { name: 'game', entityType: ReportEntityType.Game },
  { name: 'score', entityType: ReportEntityType.Score },
] as const;

async function getReportTarget(
  client: UserClient,
  entityType: ReportEntityType
): Promise<ReportTarget> {
  if (entityType === ReportEntityType.Tournament) {
    return {
      entityId: TEST_PUBLIC_TOURNAMENT_ID,
      route: ROUTES.tournament(TEST_PUBLIC_TOURNAMENT_ID),
    };
  }

  if (entityType === ReportEntityType.Match) {
    return {
      entityId: TEST_MATCH_ID,
      route: ROUTES.match(TEST_MATCH_ID),
    };
  }

  const match = await client.matches.get({
    id: TEST_MATCH_ID,
    keyType: 'otr',
  });
  const game = match.games.find((candidate) => candidate.scores.length > 0);
  if (!game) {
    throw new Error(
      `Match ${TEST_MATCH_ID} must contain a game with scores for report E2E coverage`
    );
  }

  if (entityType === ReportEntityType.Game) {
    return {
      entityId: game.id,
      route: ROUTES.match(TEST_MATCH_ID),
    };
  }

  const score = game.scores.at(0);
  if (!score) {
    throw new Error(
      `Game ${game.id} must contain a score for report E2E coverage`
    );
  }

  return {
    entityId: score.id,
    route: ROUTES.match(TEST_MATCH_ID),
  };
}

/** Report creation, and My reports: every signed-in user's own reports. */
test.describe('My reports', () => {
  test.describe('Unauthenticated access', () => {
    test('redirects an unauthenticated visitor to /unauthorized', async ({
      page,
    }) => {
      await page.goto(ROUTES.reports);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveURL(/\/unauthorized/, { timeout: 10000 });
    });
  });

  test.describe('Admin role', () => {
    test.use({ storageState: STORAGE_STATE.admin });

    test('sees their own reports, not the admin queue', async ({ page }) => {
      await page.goto(ROUTES.reports);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveURL(/\/reports$/, { timeout: 10000 });
      await expect(
        page.getByRole('heading', { level: 1, name: 'My reports' })
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="admin-reports-heading"]')
      ).toHaveCount(0);
    });

    test('requires a comment before closing a report', async ({ page }) => {
      const userClient = createOrpcClientForRole('user');
      const adminClient = createOrpcClientForRole('admin');
      const templateResponse = await userClient.reports.templates({
        entityType: ReportEntityType.Tournament,
      });
      const template = templateResponse.templates.at(0);
      if (!template) {
        throw new Error('No tournament report templates were returned');
      }

      const created = await userClient.reports.create({
        entityType: ReportEntityType.Tournament,
        entityId: TEST_TOURNAMENT_ID,
        reasonKey: template.key,
        additionalInformation: `E2E admin resolution ${randomUUID()}`,
      });
      const reportId = created.reportId;
      if (!reportId) {
        throw new Error('The test report was not created');
      }

      await page.goto(ROUTES.adminReports);
      await page.waitForLoadState('networkidle');

      const reportRow = page.locator(
        `[data-testid="admin-reports-row"][data-report-id="${reportId}"]`
      );
      await expect(reportRow).toBeVisible({ timeout: 10000 });
      await reportRow.getByTestId('admin-reports-view-details').click();

      const dialog = page.getByTestId('admin-report-detail');
      const reason = dialog.getByRole('textbox', {
        name: 'Comment',
      });
      const dismiss = dialog.getByRole('button', { name: 'Dismiss' });
      const confirm = dialog.getByRole('button', { name: 'Confirm report' });

      await expect(reason).toBeVisible();
      await expect(dismiss).toBeDisabled();
      await expect(confirm).toBeDisabled();

      await reason.fill('   ');
      await expect(dismiss).toBeDisabled();
      await expect(confirm).toBeDisabled();

      const comment = `Confirmed by E2E ${randomUUID()}`;
      await reason.fill(comment);
      await expect(dismiss).toBeEnabled();
      await expect(confirm).toBeEnabled();
      await confirm.click();

      await expect(
        page.getByText('Report confirmed', { exact: true })
      ).toBeVisible({ timeout: 10000 });
      await expect
        .poll(async () => {
          const report = await adminClient.reports.get({ reportId });
          return {
            status: report.status,
            adminNote: report.adminNote,
          };
        })
        .toEqual({
          status: ReportStatus.Approved,
          adminNote: comment,
        });
    });
  });

  test.describe('Regular user role', () => {
    test.use({ storageState: STORAGE_STATE.user });

    test('renders the My reports heading and card', async ({ page }) => {
      await page.goto(ROUTES.reports);
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('heading', { level: 1, name: 'My reports' })
      ).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="my-reports-card"]')).toBeVisible(
        { timeout: 10000 }
      );
    });

    test('the account menu exposes My reports (and not Admin) for a regular user', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="account-menu-trigger"]').click();

      const reportsItem = page.getByRole('menuitem', { name: /^My reports/ });
      await expect(reportsItem).toBeVisible({ timeout: 10000 });
      await expect(reportsItem).toHaveAttribute('href', ROUTES.reports);
      await expect(page.getByRole('menuitem', { name: 'Admin' })).toHaveCount(
        0
      );
    });

    for (const scenario of REPORT_SCENARIOS) {
      test(`submits a ${scenario.name} report with templates loaded for that entity`, async ({
        page,
      }) => {
        const userClient = createOrpcClientForRole('user');
        const target = await getReportTarget(userClient, scenario.entityType);
        const templateResponse = await userClient.reports.templates({
          entityType: scenario.entityType,
        });

        expect(templateResponse.entityType).toBe(scenario.entityType);
        expect(templateResponse.templates.length).toBeGreaterThan(0);

        const selectedTemplate = templateResponse.templates.at(0);
        if (!selectedTemplate) {
          throw new Error(
            `No ${scenario.name} report templates were returned by the server`
          );
        }

        const reportsBeforeSubmission = await userClient.reports.listMine({});
        const existingReportIds = new Set(
          reportsBeforeSubmission.reports.map((report) => report.id)
        );

        await page.goto(target.route);
        await page.waitForLoadState('networkidle');

        const dialog = await openReportDialog(
          page,
          scenario.entityType,
          target
        );
        await expect(dialog.getByRole('checkbox')).toHaveCount(0);

        const reason = dialog.getByRole('combobox', { name: /^Reason/ });
        const submit = dialog.getByRole('button', { name: /submit report/i });
        await expect(reason).toBeEnabled({ timeout: 10000 });
        if (scenario.entityType === ReportEntityType.Tournament) {
          // Submitting without a reason names the missing field.
          await submit.click();
          await expect(dialog.getByText('Reason is required')).toBeVisible();
          await expect(dialog).toBeVisible();
        }
        await reason.click();

        const options = page.getByRole('option');
        await expect(options).toHaveCount(templateResponse.templates.length);
        for (const [index, template] of templateResponse.templates.entries()) {
          await expect(options.nth(index)).toHaveText(template.label);
        }
        await options.first().click();

        const additionalInformation =
          scenario.entityType === ReportEntityType.Score
            ? null
            : `E2E ${scenario.name} report ${randomUUID()}`;
        const additionalInformationInput = dialog.getByRole('textbox', {
          name: 'Additional information',
        });
        await expect(additionalInformationInput).toBeVisible();
        if (additionalInformation !== null) {
          await additionalInformationInput.fill(additionalInformation);
        }
        await submit.click();

        await expect(
          page.getByText('Report submitted successfully', { exact: true })
        ).toBeVisible({ timeout: 10000 });
        await expect(dialog).toBeHidden({ timeout: 10000 });

        await expect
          .poll(
            async () => {
              const { reports } = await userClient.reports.listMine({});
              const persisted = reports.find(
                (report) =>
                  !existingReportIds.has(report.id) &&
                  report.entityType === scenario.entityType &&
                  report.entityId === target.entityId &&
                  report.additionalInformation === additionalInformation
              );

              return persisted
                ? {
                    reasonKey: persisted.reason.key,
                    additionalInformation: persisted.additionalInformation,
                  }
                : null;
            },
            { timeout: 10000 }
          )
          .toEqual({
            reasonKey: selectedTemplate.key,
            additionalInformation,
          });
      });
    }

    test('an unread admin update shows a dot that clears when the report is opened', async ({
      page,
    }) => {
      const userClient = createOrpcClientForRole('user');
      const adminClient = createOrpcClientForRole('admin');

      const templateResponse = await userClient.reports.templates({
        entityType: ReportEntityType.Tournament,
      });
      const template = templateResponse.templates.at(0);
      if (!template) {
        throw new Error('No tournament report templates were returned');
      }

      const created = await userClient.reports.create({
        entityType: ReportEntityType.Tournament,
        entityId: TEST_TOURNAMENT_ID,
        reasonKey: template.key,
        additionalInformation: `E2E unread indicator ${randomUUID()}`,
      });
      expect(created.reportId).toBeGreaterThan(0);

      await adminClient.reports.resolve({
        reportId: created.reportId!,
        status: ReportStatus.Approved,
        adminNote: 'E2E admin comment',
      });

      // Other report specs run in parallel, so target the seeded report by id
      await page.goto(ROUTES.reports);
      await page.waitForLoadState('networkidle');

      const reportRow = page.locator(
        `[data-testid="my-reports-row"][data-report-id="${created.reportId}"]`
      );
      await expect(
        reportRow.locator('[data-testid="my-reports-unread-dot"]')
      ).toBeVisible({ timeout: 10000 });
      // The row is not clickable; its labelled View button opens the report.
      await reportRow
        .getByRole('button', { name: `View report #${created.reportId}` })
        .click();

      const dialog = page.locator('[data-testid="my-report-detail"]');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await expect(
        dialog.getByRole('heading', { name: 'Report details' })
      ).toBeVisible();
      await expect(dialog.getByText('Comment', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E admin comment')).toBeVisible();
      await expect(
        dialog.getByRole('button', {
          name: /^(Confirm report|Dismiss|Reopen)$/,
        })
      ).toHaveCount(0);

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 10000 });
      await expect(
        reportRow.locator('[data-testid="my-reports-unread-dot"]')
      ).toHaveCount(0, { timeout: 10000 });

      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(
        page
          .locator(
            `[data-testid="my-reports-row"][data-report-id="${created.reportId}"]`
          )
          .locator('[data-testid="my-reports-unread-dot"]')
      ).toHaveCount(0, { timeout: 10000 });
    });
  });
});
