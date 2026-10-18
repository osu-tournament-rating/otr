import { test, expect } from '@playwright/test';
import { ROUTES } from './fixtures/test-config';

test.describe('Homepage and Global Navigation', () => {
  test.describe('Page Load', () => {
    test('loads with hero section', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const hero = page.locator('[data-testid="hero-section"]');
      await expect(hero).toBeVisible({ timeout: 10000 });
    });

    test('has one h1, the site name', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText('osu! Tournament Rating');
    });

    test('page title contains expected text', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveTitle('osu! Tournament Rating');
    });

    test('renders the rating ladder section', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const ladder = page.locator('[data-testid="rating-ladder-section"]');
      await expect(ladder).toBeVisible({ timeout: 10000 });
    });

    test('displays home action cards', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const actionCards = page.locator('[data-testid="home-action-cards"]');
      await expect(actionCards).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Feature Cards', () => {
    test('displays verified tournaments card', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="verified-tournaments-card"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('displays beatmap histories card', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="beatmap-histories-card"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('displays updates Tuesday card', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="updates-tuesday-card"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('displays all modes card', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="all-modes-card"]')).toBeVisible({
        timeout: 10000,
      });
    });

    test('displays open source card', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="open-source-card"]')
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Header Navigation', () => {
    test('displays header with logo', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="header"]')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('[data-testid="header-logo"]')).toBeVisible({
        timeout: 10000,
      });
    });

    test('displays primary nav links', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="nav-leaderboard"]')).toBeVisible(
        { timeout: 10000 }
      );
      await expect(page.locator('[data-testid="nav-tournaments"]')).toBeVisible(
        { timeout: 10000 }
      );
      await expect(page.locator('[data-testid="nav-beatmaps"]')).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('[data-testid="nav-stats"]')).toBeVisible({
        timeout: 10000,
      });
    });

    test('the first Tab offers a skip past the header', async ({ page }) => {
      await page.goto(ROUTES.tournaments);
      await page.waitForLoadState('networkidle');

      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to content' });
      await expect(skip).toBeFocused();
      await expect(skip).toBeVisible();

      await page.keyboard.press('Enter');
      await expect(page.locator('main#main')).toBeFocused();
      // The next Tab lands in the page, not back in the header.
      await page.keyboard.press('Tab');
      const inHeader = await page.evaluate(
        () => document.activeElement?.closest('[data-testid="header"]') !== null
      );
      expect(inHeader).toBe(false);
    });

    test('logo links back to the homepage', async ({ page }) => {
      await page.goto(ROUTES.leaderboard);
      await page.waitForLoadState('networkidle');

      // The first-visit modal intercepts pointer events until dismissed
      const welcomeAck = page.getByRole('button', { name: 'I understand' });
      if (await welcomeAck.isVisible().catch(() => false)) {
        await welcomeAck.click();
        await expect(welcomeAck).toBeHidden({ timeout: 10000 });
      }

      await page.locator('[data-testid="header-logo"]').click();
      await page.waitForURL(/\/$/, { timeout: 10000 });
      await expect(page.locator('[data-testid="hero-section"]')).toBeVisible({
        timeout: 10000,
      });
    });

    test('Leaderboard nav navigates to /leaderboard', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="nav-leaderboard"]').click();
      await page.waitForURL(/\/leaderboard/, { timeout: 10000 });
      expect(page.url()).toContain('/leaderboard');
    });

    test('Beatmaps nav navigates to /beatmaps', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="nav-beatmaps"]').click();
      await page.waitForURL(/\/beatmaps/, { timeout: 10000 });
      expect(page.url()).toContain('/beatmaps');
    });

    test('Stats nav navigates to /stats', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="nav-stats"]').click();
      await page.waitForURL(/\/stats/, { timeout: 10000 });
      expect(page.url()).toContain('/stats');
    });

    test('Tournaments dropdown reveals Browse link to /tournaments', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const tournamentsTrigger = page.locator(
        '[data-testid="nav-tournaments"]'
      );
      await expect(tournamentsTrigger).toBeVisible({ timeout: 10000 });
      await tournamentsTrigger.click();

      const browseLink = page
        .locator('a[href="/tournaments"]')
        .filter({ hasText: 'Browse' });
      await expect(browseLink.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Header menus', () => {
    test('More lists the docs and the API reference', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="nav-more"]').click();

      const nav = page.getByRole('navigation', { name: 'Main' });
      await expect(nav.getByRole('link', { name: /^Docs/ })).toHaveAttribute(
        'href',
        'https://docs.otr.stagec.net'
      );
      await expect(
        nav.getByRole('link', { name: 'API reference' })
      ).toHaveAttribute('href', ROUTES.spec);
      await expect(nav.getByRole('link', { name: /^Support/ })).toHaveCount(0);
    });

    test('the support heart sits at the top right', async ({ page }) => {
      await page.goto(ROUTES.home);

      await expect(page.getByTestId('header-support')).toHaveAttribute(
        'href',
        'https://buymeacoffee.com/stagecodes'
      );
    });

    test('Tools items are in sentence case', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="nav-tools"]').click();

      const nav = page.getByRole('navigation', { name: 'Main' });
      await expect(
        nav.getByRole('link', { name: 'Filter reports' })
      ).toBeVisible({ timeout: 10000 });
      await expect(nav.getByRole('link', { name: 'Audit logs' })).toBeVisible();
    });

    test('signed-out visitors get no Admin menu and a Log in button', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="nav-admin"]')).toHaveCount(0);
      await expect(
        page.getByRole('banner').getByRole('button', { name: 'Log in' })
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Footer', () => {
    test('displays footer with content', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const footer = page.locator('[data-testid="footer"]');
      await expect(footer).toBeVisible({ timeout: 10000 });
      await expect(footer).toContainText('osu! Tournament Rating');
    });

    test('displays footer browse links', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="footer-leaderboard-link"]')
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.locator('[data-testid="footer-tournaments-link"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('footer leaderboard link navigates to /leaderboard', async ({
      page,
    }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await page.locator('[data-testid="footer-leaderboard-link"]').click();
      await page.waitForURL(/\/leaderboard/, { timeout: 10000 });
      expect(page.url()).toContain('/leaderboard');
    });
  });

  test.describe('Authentication Gate', () => {
    test('shows login prompt for unauthenticated users', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const loginCard = page.locator('[data-testid="home-login-button"]');
      await expect(loginCard).toBeVisible({ timeout: 10000 });
      await expect(loginCard).toContainText('Log in');
    });
  });

  test.describe('Responsive Layout', () => {
    test('shows desktop nav and hides mobile trigger at desktop width', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="nav-leaderboard"]')).toBeVisible(
        { timeout: 10000 }
      );
      await expect(
        page.locator('[data-testid="mobile-nav-trigger"]')
      ).toBeHidden();
    });

    test('shows mobile nav trigger at mobile width', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="mobile-nav-trigger"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('shows mobile nav trigger at tablet width', async ({ page }) => {
      // Desktop nav starts at the `lg` breakpoint (1024px)
      await page.setViewportSize({ width: 1023, height: 1024 });
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="mobile-nav-trigger"]')
      ).toBeVisible({ timeout: 10000 });
    });

    test('mobile nav trigger reveals navigation links when opened', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const trigger = page.locator('[data-testid="mobile-nav-trigger"]');
      await expect(trigger).toBeVisible({ timeout: 10000 });
      await trigger.click();

      // The link also exists in the hidden desktop nav, so scope to the sheet
      const mobileSheet = page.locator('[data-slot="sheet-content"]');
      await expect(mobileSheet).toBeVisible({ timeout: 10000 });
      await expect(
        mobileSheet.locator('[data-testid="nav-leaderboard"]')
      ).toBeVisible({ timeout: 10000 });

      // Same structure as the desktop bar: More expands in place
      await mobileSheet.locator('[data-testid="nav-more"]').click();
      await expect(
        mobileSheet.getByRole('link', { name: 'API reference' })
      ).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Theme Toggle', () => {
    test('toggles the theme class on the html element', async ({ page }) => {
      await page.goto(ROUTES.home);
      await page.waitForLoadState('networkidle');

      const toggle = page.locator('[data-testid="header-theme-toggle"]');
      await expect(toggle).toBeVisible({ timeout: 10000 });

      const html = page.locator('html');
      const initialClass = (await html.getAttribute('class')) ?? '';
      const initiallyDark = initialClass.includes('dark');

      await toggle.click();

      if (initiallyDark) {
        await expect(html).not.toHaveClass(/dark/, { timeout: 10000 });
      } else {
        await expect(html).toHaveClass(/dark/, { timeout: 10000 });
      }
    });
  });
});
