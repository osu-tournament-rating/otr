import { readFileSync } from 'node:fs';

import { test, expect } from '@playwright/test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

import { BUILD_ID, BUILD_ID_HEADER } from '../lib/build-id';
import { STORAGE_STATE } from './fixtures/auth';

/**
 * The weekly maintenance window (Tuesdays 11:45-12:15 UTC) blocks admin
 * mutations (issue #763). The window is forced per-request with the test-only
 * `x-e2e-maintenance-window` header, and every id is non-existent so nothing
 * real is ever mutated.
 */

type MaintenanceOverride = 'active' | 'inactive';

const MISSING_ID = 999_999_999;

/** A valid score-update body, so a request reaching the handler fails at lookup. */
const SCORE_UPDATE_BODY = {
  id: MISSING_ID,
  scoreOverride: null,
  placement: 1,
  maxCombo: 0,
  statGreat: null,
  statOk: null,
  statMeh: null,
  statMiss: null,
  statGood: null,
  statPerfect: null,
  accuracy: 0.95,
  grade: 3, // ScoreGrade.S
  mods: 0,
  ruleset: 0, // Ruleset.Osu
  verificationStatus: 4, // VerificationStatus.Verified
  rejectionReason: 0,
  team: 0, // Team.NoTeam
} as const;

/** Cookie header for the admin session minted by the setup project. */
const adminCookieHeader = (): string => {
  const state = JSON.parse(readFileSync(STORAGE_STATE.admin, 'utf-8')) as {
    cookies: Array<{ name: string; value: string }>;
  };

  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
};

/** Minimal shape of the admin mutation procedures exercised here. */
interface AdminMutationClient {
  scores: {
    admin: {
      delete(input: { id: number }): Promise<unknown>;
      update(input: typeof SCORE_UPDATE_BODY): Promise<unknown>;
    };
  };
  games: { admin: { delete(input: { id: number }): Promise<unknown> } };
  matches: { admin: { delete(input: { id: number }): Promise<unknown> } };
  tournaments: { admin: { delete(input: { id: number }): Promise<unknown> } };
}

const adminClient = (
  baseURL: string,
  override: MaintenanceOverride
): AdminMutationClient => {
  const link = new RPCLink({
    url: `${baseURL}/rpc`,
    headers: () => ({
      cookie: adminCookieHeader(),
      [BUILD_ID_HEADER]: BUILD_ID,
      'x-e2e-maintenance-window': override,
    }),
  });

  return createORPCClient(link) as unknown as AdminMutationClient;
};

type CapturedError = {
  code?: string;
  status?: number;
  data?: { code?: string };
};

/** Runs a mutation expected to throw and returns the oRPC error. */
const captureError = async (call: Promise<unknown>): Promise<CapturedError> => {
  try {
    await call;
  } catch (error) {
    return error as CapturedError;
  }

  throw new Error('expected the mutation to be rejected, but it resolved');
};

const expectBlocked = (error: CapturedError) => {
  expect(error.code).toBe('SERVICE_UNAVAILABLE');
  expect(error.data?.code).toBe('MAINTENANCE_WINDOW');
};

test.describe('Maintenance window', () => {
  test('shows the site banner during the window', async ({ page }) => {
    await page.setExtraHTTPHeaders({
      'x-e2e-maintenance-window': 'active',
    });

    await page.goto('/');

    await expect(
      page.locator('[data-testid="maintenance-window-banner"]')
    ).toContainText(
      'Ratings are pending recalculation, performance may be degraded'
    );
  });

  test('hides the site banner outside the window', async ({ page }) => {
    await page.setExtraHTTPHeaders({
      'x-e2e-maintenance-window': 'inactive',
    });

    await page.goto('/');

    await expect(
      page.locator('[data-testid="maintenance-window-banner"]')
    ).toHaveCount(0);
  });

  test('blocks admins from deleting data during the window', async ({
    baseURL,
  }) => {
    const client = adminClient(baseURL!, 'active');

    expectBlocked(
      await captureError(client.scores.admin.delete({ id: MISSING_ID }))
    );
    expectBlocked(
      await captureError(client.games.admin.delete({ id: MISSING_ID }))
    );
    expectBlocked(
      await captureError(client.matches.admin.delete({ id: MISSING_ID }))
    );
    expectBlocked(
      await captureError(client.tournaments.admin.delete({ id: MISSING_ID }))
    );
  });

  test('blocks admins from verifying/modifying data during the window', async ({
    baseURL,
  }) => {
    const client = adminClient(baseURL!, 'active');

    expectBlocked(
      await captureError(client.scores.admin.update(SCORE_UPDATE_BODY))
    );
  });

  test('allows the same admin mutations outside the window', async ({
    baseURL,
  }) => {
    // NOT_FOUND proves the 503 above came from the guard, not auth or routing
    const client = adminClient(baseURL!, 'inactive');

    const deleteError = await captureError(
      client.scores.admin.delete({ id: MISSING_ID })
    );
    expect(deleteError.code).toBe('NOT_FOUND');

    const updateError = await captureError(
      client.scores.admin.update(SCORE_UPDATE_BODY)
    );
    expect(updateError.code).toBe('NOT_FOUND');
  });
});
