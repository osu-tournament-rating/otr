import { describe, expect, it } from 'bun:test';

import { BUILD_ID_HEADER } from '@/lib/build-id';
import {
  createSiteFetch,
  RETRY_WHILE_UNREACHABLE,
  SiteUnreachableError,
} from '@/lib/orpc/site-fetch';

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

  it('takes a failed request as the site not answering', async () => {
    const { fetch } = siteFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetch(request())).rejects.toBeInstanceOf(SiteUnreachableError);
  });

  it('takes an unstamped server error as a proxy saying the site is down', async () => {
    for (const status of [502, 503, 504, 521]) {
      const { fetch } = siteFetch(
        async () => new Response('Bad gateway', { status })
      );
      await expect(fetch(request())).rejects.toBeInstanceOf(
        SiteUnreachableError
      );
    }
  });

  it('returns an unstamped answer that is not a server error', async () => {
    const { fetch, otherBuilds } = siteFetch(
      async () => new Response('Not found', { status: 404 })
    );
    expect((await fetch(request())).status).toBe(404);
    expect(otherBuilds).toHaveLength(0);
  });

  it('lets an aborted request fail as an abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('Aborted', 'AbortError');
    const { fetch } = siteFetch(async () => {
      throw abort;
    });
    await expect(
      fetch(new Request('http://localhost/rpc', { signal: controller.signal }))
    ).rejects.toBe(abort);
  });
});

describe('RETRY_WHILE_UNREACHABLE', () => {
  type Attempt = { error: unknown; attemptIndex: number };
  const shouldRetry = RETRY_WHILE_UNREACHABLE.shouldRetry as (
    attempt: Attempt
  ) => boolean;
  const retryDelay = RETRY_WHILE_UNREACHABLE.retryDelay as (
    attempt: Attempt
  ) => number;
  const attempt = (error: unknown, attemptIndex = 0) => ({
    error,
    attemptIndex,
  });

  it('retries only calls the site did not answer', () => {
    expect(shouldRetry(attempt(new SiteUnreachableError()))).toBe(true);
    expect(shouldRetry(attempt(new Error('Input validation failed')))).toBe(
      false
    );
  });

  it('waits 1, 2, 4, 8 and 8 seconds', () => {
    expect(RETRY_WHILE_UNREACHABLE.retry).toBe(5);
    expect(
      [0, 1, 2, 3, 4].map((index) =>
        retryDelay(attempt(new SiteUnreachableError(), index))
      )
    ).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});
