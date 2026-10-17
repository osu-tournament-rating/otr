import { readFileSync } from 'node:fs';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { RouterClient } from '@orpc/server';
import { test } from '@playwright/test';

import type { router } from '../../app/server/oRPC/router';
import { BUILD_ID, BUILD_ID_HEADER } from '../../lib/build-id';
import { STORAGE_STATE, type TestRole } from './auth';

/** The production build that `playwright.config.ts` starts. */
const DEFAULT_BASE_URL = 'http://localhost:3001';

/**
 * The site under test: the running test's `baseURL`, so a config pointed at
 * another server (a worktree's stack) reaches that server, then
 * `E2E_BASE_URL`, then the default build.
 */
function getBaseUrl(): string {
  let baseURL: string | undefined;
  try {
    baseURL = test.info().project.use.baseURL;
  } catch {
    // Outside a running test there is no project to ask.
  }
  return baseURL ?? process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL;
}

function cookieHeaderFromStorageState(path: string): string {
  const state = JSON.parse(readFileSync(path, 'utf8')) as {
    cookies?: Array<{ name: string; value: string }>;
  };
  return (state.cookies ?? [])
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

/**
 * A link to the site's `/rpc`, which serves only the site itself: calls send
 * the site's Origin and build, as a page's own calls do, plus any `headers`
 * given.
 */
export function createSiteRpcLink(
  baseURL: string,
  headers: Record<string, string> = {}
) {
  const { origin } = new URL(baseURL);
  return new RPCLink({
    url: `${origin}/rpc`,
    // The server refuses writes from another build. Builds made for tests
    // carry no build stamp, so this process and the server agree.
    headers: () => ({ origin, [BUILD_ID_HEADER]: BUILD_ID, ...headers }),
  });
}

/**
 * oRPC client for a test role, against the site under test unless
 * `baseURL` names another. Storage state is read lazily, after collection.
 */
export function createOrpcClientForRole(
  role: TestRole,
  baseURL: string = getBaseUrl()
): RouterClient<typeof router> {
  const cookie = cookieHeaderFromStorageState(STORAGE_STATE[role]);
  return createORPCClient(createSiteRpcLink(baseURL, { cookie }));
}
