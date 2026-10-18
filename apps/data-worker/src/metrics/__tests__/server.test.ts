import { describe, expect, it } from 'bun:test';

import { handleMetricsRequest, resolveMetricsPort } from '../server';

describe('resolveMetricsPort', () => {
  it('uses METRICS_PORT when it is set', () => {
    expect(resolveMetricsPort('9100')).toBe(9100);
  });

  it.each([undefined, '', '   '])(
    'defaults to 9091 when METRICS_PORT is %p',
    (value) => {
      expect(resolveMetricsPort(value)).toBe(9091);
    }
  );
});

describe('handleMetricsRequest /health', () => {
  const health = (isHealthy: boolean) =>
    handleMetricsRequest(
      new Request('http://localhost/health'),
      () => isHealthy
    );

  it('returns 200 while every consumer is subscribed', async () => {
    expect((await health(true)).status).toBe(200);
  });

  it('returns 503 while a consumer is not subscribed', async () => {
    expect((await health(false)).status).toBe(503);
  });
});
