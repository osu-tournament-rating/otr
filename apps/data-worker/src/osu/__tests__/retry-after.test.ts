import { describe, expect, it } from 'bun:test';

import {
  captureOsuRetryAfter,
  osuRetryAfterMs,
  parseRetryAfter,
  trackOsuRetryAfter,
} from '../retry-after';

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates, and ignores anything else', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');

    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Sun, 18 Oct 2026 12:02:00 GMT', now)).toBe(120_000);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe('captureOsuRetryAfter', () => {
  const respond = (status: number, retryAfter?: string) =>
    captureOsuRetryAfter(
      async (_input: RequestInfo | URL) =>
        new Response(null, {
          status,
          headers: retryAfter ? { 'Retry-After': retryAfter } : {},
        })
    );

  it('keeps the longest wait osu! asks for during a tracked call', async () => {
    const seen = await trackOsuRetryAfter(async () => {
      await respond(429, '10')('https://osu.ppy.sh/api/v2/matches/1');
      await respond(503, '60')('https://osu.ppy.sh/api/v2/matches/1');
      await respond(429, '5')('https://osu.ppy.sh/api/v2/matches/1');
      return osuRetryAfterMs();
    });

    expect(seen).toBe(60_000);
  });

  it('ignores other hosts and other statuses', async () => {
    const seen = await trackOsuRetryAfter(async () => {
      await respond(429, '10')('https://osutrack-api.ameo.dev/stats_history');
      await respond(500, '10')('https://osu.ppy.sh/api/v2/matches/1');
      return osuRetryAfterMs();
    });

    expect(seen).toBeUndefined();
  });
});
