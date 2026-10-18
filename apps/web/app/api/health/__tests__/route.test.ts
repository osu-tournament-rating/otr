import { describe, expect, it } from 'bun:test';

import { GET, HEAD } from '@/app/api/health/route';
import { BUILD_ID, BUILD_ID_HEADER } from '@/lib/build-id';
import { READINESS_HEADER, setDraining } from '@/lib/shutdown';

describe('/api/health', () => {
  it('names the build it runs, uncached, so open tabs can see a release', () => {
    for (const handler of [GET, HEAD]) {
      const response = handler();
      expect(response.status).toBe(200);
      expect(response.headers.get(BUILD_ID_HEADER)).toBe(BUILD_ID);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  // The reverse proxy probes with READINESS_HEADER and reads a 503 as down,
  // moving requests to the other web container during a deploy. Everyone
  // else keeps getting 200 until the server exits.
  it("fails only the proxy's readiness probe while the server drains", () => {
    setDraining(true);
    try {
      const probe = () =>
        new Request('http://otr/api/health', {
          headers: { [READINESS_HEADER]: '1' },
        });
      for (const handler of [GET, HEAD]) {
        expect(handler(probe()).status).toBe(503);
        expect(handler(new Request('http://otr/api/health')).status).toBe(200);
      }
    } finally {
      setDraining(false);
    }
  });
});
