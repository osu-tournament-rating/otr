import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { NextRequest } from 'next/server';

import { openAPIHandler } from '@/app/server/openapi';
import { auth } from '@/lib/auth/auth';

import { GET } from '../route';

/**
 * What Next hands a route handler: a Proxy around a NextRequest that reads
 * every property, and binds every method, on the target (proxyNextRequest in
 * next/dist/server/route-modules/app-route/module.js). Node's Request
 * constructor can't copy it, so the route must never rebuild the request.
 * Bun's can, so these tests check that the route hands the request on as is.
 */
const nextRouteRequest = (url: string, headers: HeadersInit) =>
  new Proxy(new NextRequest(url, { headers }), {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

describe('OpenAPI route', () => {
  const handle = spyOn(openAPIHandler, 'handle');

  afterEach(() => {
    handle.mockClear();
  });

  it('passes an x-api-key request on unchanged, with the key as a Bearer authorization', async () => {
    const request = nextRouteRequest('http://localhost/api/does-not-exist', {
      'x-api-key': 'key-123',
    });

    const response = await GET(request);

    expect(response.status).toBe(404);
    expect(handle).toHaveBeenCalledTimes(1);

    const [handledRequest, options] = handle.mock.calls[0]!;
    expect(handledRequest).toBe(request);
    expect(options?.context?.headers.get('authorization')).toBe(
      'Bearer key-123'
    );
    expect(options?.context?.apiKeyRequired).toBe(true);
  });

  it('passes a Bearer request on with its own headers', async () => {
    const request = nextRouteRequest('http://localhost/api/does-not-exist', {
      authorization: 'Bearer key-123',
    });

    const response = await GET(request);

    expect(response.status).toBe(404);

    const [handledRequest, options] = handle.mock.calls[0]!;
    expect(handledRequest).toBe(request);
    expect(options?.context?.headers).toBe(request.headers);
    expect(options?.context?.apiKeyRequired).toBe(true);
  });

  it('answers a request without a key with a 401', async () => {
    const response = await GET(
      nextRouteRequest('http://localhost/api/does-not-exist', {})
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="otr_api"'
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('checks the key whatever the case of the Bearer scheme (#1061)', async () => {
    const verifyApiKey = spyOn(auth.api, 'verifyApiKey').mockResolvedValue({
      valid: false,
      key: null,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key.' },
    } as never);

    try {
      for (const scheme of ['Bearer', 'bearer', 'BEARER']) {
        verifyApiKey.mockClear();

        const response = await GET(
          nextRouteRequest('http://localhost/api/stats/platform', {
            authorization: `${scheme} not-a-real-key`,
          })
        );

        expect(response.status).toBe(401);
        expect((await response.json()).message).toBe('Invalid API key.');
        expect(verifyApiKey).toHaveBeenCalledTimes(1);
        expect(verifyApiKey.mock.calls[0]![0]!.body.key).toBe('not-a-real-key');
      }
    } finally {
      verifyApiKey.mockRestore();
    }
  });

  it('answers a Bearer authorization without a key with a 401', async () => {
    const response = await GET(
      nextRouteRequest('http://localhost/api/stats/platform', {
        authorization: 'Bearer',
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="otr_api"'
    );
    expect(await response.json()).toEqual({ error: 'API key is missing.' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('refuses another scheme without falling back to x-api-key', async () => {
    const response = await GET(
      nextRouteRequest('http://localhost/api/stats/platform', {
        authorization: 'Basic dXNlcjpwYXNz',
        'x-api-key': 'key-123',
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error:
        'Provide the API key using the Authorization: Bearer <key> header.',
    });
    expect(handle).not.toHaveBeenCalled();
  });
});
