import { describe, expect, it } from 'bun:test';

import { BUILD_ID_HEADER } from '@/lib/build-id';
import { createSiteFetch } from '@/lib/orpc/site-fetch';

const stamped = (build: string, status = 200) =>
  new Response('{}', { status, headers: { [BUILD_ID_HEADER]: build } });

function siteFetch(respond: () => Promise<Response>) {
  const otherBuilds: number[] = [];
  const fetch = createSiteFetch({
    fetch: respond,
    buildId: 'abc',
    onOtherBuild: () => otherBuilds.push(1),
  });
  return { fetch, otherBuilds };
}

const request = () => new Request('http://localhost/rpc/tournaments/submit');

describe('createSiteFetch', () => {
  it('passes the site’s own answers through, errors included', async () => {
    for (const status of [200, 400, 503]) {
      const { fetch, otherBuilds } = siteFetch(async () =>
        stamped('abc', status)
      );
      expect((await fetch(request())).status).toBe(status);
      expect(otherBuilds).toHaveLength(0);
    }
  });

  it('reports an answer from another build and still returns it', async () => {
    const { fetch, otherBuilds } = siteFetch(async () => stamped('def', 400));
    expect((await fetch(request())).status).toBe(400);
    expect(otherBuilds).toHaveLength(1);
  });

  it('returns an unstamped answer without reporting it', async () => {
    const { fetch, otherBuilds } = siteFetch(
      async () => new Response('Not found', { status: 404 })
    );
    expect((await fetch(request())).status).toBe(404);
    expect(otherBuilds).toHaveLength(0);
  });
});
