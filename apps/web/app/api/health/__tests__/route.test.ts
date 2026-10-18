import { describe, expect, it } from 'bun:test';

import { GET, HEAD } from '@/app/api/health/route';
import { BUILD_ID, BUILD_ID_HEADER } from '@/lib/build-id';

describe('/api/health', () => {
  it('names the build it runs, uncached, so open tabs can see a release', () => {
    for (const handler of [GET, HEAD]) {
      const response = handler();
      expect(response.status).toBe(200);
      expect(response.headers.get(BUILD_ID_HEADER)).toBe(BUILD_ID);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
