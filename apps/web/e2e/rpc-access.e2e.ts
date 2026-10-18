import { test, expect } from '@playwright/test';

/**
 * `/rpc` serves only the site itself (issue #1030): its pages in the browser
 * and its server renders. Every browser spec covers those; these cover a
 * caller from outside, which is pointed to the public API.
 */
test.describe('Internal API access', () => {
  test('refuses a call without the site Origin', async ({ request }) => {
    const response = await request.post('/rpc/stats/platform', {
      data: {},
    });

    expect(response.status()).toBe(403);
    const body = (await response.json()) as {
      json?: { code?: string; data?: { code?: string } };
    };
    expect(body.json).toMatchObject({
      code: 'FORBIDDEN',
      data: { code: 'SITE_ONLY' },
    });
  });

  test('serves a call with the site Origin', async ({ request, baseURL }) => {
    const response = await request.post('/rpc/stats/platform', {
      data: {},
      headers: { origin: new URL(baseURL!).origin },
    });

    expect(response.status()).toBe(200);
  });
});
