import { afterEach, describe, expect, it } from 'bun:test';

import { GET } from '../route';

const env = process.env as Record<string, string | undefined>;
const originalToken = env.METRICS_AUTH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) {
    delete env.METRICS_AUTH_TOKEN;
  } else {
    env.METRICS_AUTH_TOKEN = originalToken;
  }
});

const scrape = (authorization?: string) =>
  GET(
    new Request('http://localhost/api/metrics', {
      headers: authorization ? { authorization } : {},
    })
  );

describe('/api/metrics', () => {
  // Production's compose file fills in a blank token when the setting is
  // absent, and Prometheus then sends an empty Bearer credential (#1098)
  it.each([undefined, ''])(
    'refuses every request while the token is %p',
    async (token) => {
      if (token === undefined) {
        delete env.METRICS_AUTH_TOKEN;
      } else {
        env.METRICS_AUTH_TOKEN = token;
      }

      for (const authorization of [undefined, 'Bearer ', `Bearer ${token}`]) {
        expect((await scrape(authorization)).status).toBe(401);
      }
    }
  );

  it('serves the metrics only to a request with the token', async () => {
    env.METRICS_AUTH_TOKEN = 'metrics-token';

    expect((await scrape('Bearer wrong-token')).status).toBe(401);

    const response = await scrape('Bearer metrics-token');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('# TYPE');
  });
});
