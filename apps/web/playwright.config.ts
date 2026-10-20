import { defineConfig, devices } from '@playwright/test';

import { FAKE_OSU_URL } from './e2e/fixtures/fake-osu';

/**
 * A site that is already running, such as a worktree's stack, to test instead
 * of building this checkout and serving it on port 3001:
 * `E2E_BASE_URL=http://127.0.0.1:20010 bun run test:e2e`.
 */
const runningSite = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: runningSite ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'bun e2e/fixtures/fake-osu-server.ts',
      url: FAKE_OSU_URL,
      reuseExistingServer: !process.env.CI,
    },
    ...(runningSite
      ? []
      : [
          {
            command:
              'NEXT_PUBLIC_APP_BASE_URL=http://localhost:3001 E2E_TEST_AUTH=true bun run build && E2E_TEST_AUTH=true bun run start -p 3001',
            url: 'http://localhost:3001',
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
            env: {
              E2E_TEST_AUTH: 'true',
              // The maintenance-window spec forces the window per-request instead
              MAINTENANCE_WINDOW_ENABLED: 'false',
              // The whole suite calls /rpc from one IP, faster than any person
              RPC_RATE_LIMIT: 'off',
              // Sign-in goes through the fake osu! server, which returns to this
              // server's OAuth callback.
              BETTER_AUTH_URL: 'http://localhost:3001',
              E2E_OSU_URL: FAKE_OSU_URL,
              WEB_OSU_CLIENT_ID: '1',
              WEB_OSU_CLIENT_SECRET: 'e2e',
            },
          },
        ]),
  ],
});
