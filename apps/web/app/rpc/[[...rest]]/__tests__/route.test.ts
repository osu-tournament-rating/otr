import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { NextRequest } from 'next/server';

import { SITE_ONLY_MESSAGE } from '@/lib/rpc/access';
import {
  CLIENT_IP_HEADER,
  getInternalRpcToken,
  INTERNAL_RPC_HEADER,
} from '@/lib/rpc/internal-token';
import { consume, RATE_LIMITS } from '@/lib/rpc/rate-limit';

import { POST } from '../route';

const ORIGIN = 'http://localhost:3000';

/**
 * What Next hands a route handler: a Proxy around a NextRequest that reads
 * every property, and binds every method, on the target (see the OpenAPI
 * route test).
 */
const nextRouteRequest = (request: Request) =>
  new Proxy(new NextRequest(request), {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

/**
 * The site's own oRPC client, sending its calls through the route, so the
 * tests read responses the way the site does. No procedure matches the path,
 * so nothing reaches the database.
 */
const clientWith = (headers: Record<string, string>) => {
  const responses: Response[] = [];
  const link = new RPCLink({
    url: `${ORIGIN}/rpc`,
    headers: () => headers,
    fetch: async (request) => {
      const response = await POST(nextRouteRequest(request));
      responses.push(response);
      return response.clone();
    },
  });
  const client = createORPCClient(link) as unknown as {
    doesNotExist(input: object): Promise<unknown>;
  };

  return { client, responses };
};

const captureError = async (call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    return error;
  }

  throw new Error('Expected the call to fail');
};

const env = process.env as Record<string, string | undefined>;
const originalMode = env.RPC_RATE_LIMIT;

beforeEach(() => {
  globalThis.__otrRpcRateLimit = undefined;
});

afterEach(() => {
  if (originalMode === undefined) {
    delete env.RPC_RATE_LIMIT;
  } else {
    env.RPC_RATE_LIMIT = originalMode;
  }
  globalThis.__otrRpcRateLimit = undefined;
});

describe('/rpc route', () => {
  it('refuses a call from outside the site with a readable 403', async () => {
    const { client, responses } = clientWith({});

    const error = await captureError(client.doesNotExist({}));

    expect(responses[0]?.status).toBe(403);
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      message: SITE_ONLY_MESSAGE,
      data: { code: 'SITE_ONLY' },
    });
  });

  it('passes a same-origin call on to the procedures', async () => {
    const { client, responses } = clientWith({
      'sec-fetch-site': 'same-origin',
    });

    await captureError(client.doesNotExist({}));

    expect(responses[0]?.status).toBe(404);
  });

  it('refuses a browser over the general limit with a 429 and Retry-After', async () => {
    env.RPC_RATE_LIMIT = 'enforce';
    for (let call = 0; call < RATE_LIMITS.general.capacity; call++) {
      consume('general', 'ip:203.0.113.7');
    }
    const { client, responses } = clientWith({
      'sec-fetch-site': 'same-origin',
      'cf-connecting-ip': '203.0.113.7',
    });

    const error = await captureError(client.doesNotExist({}));

    expect(responses[0]?.status).toBe(429);
    expect(responses[0]?.headers.get('retry-after')).toBe('1');
    expect(error).toBeInstanceOf(ORPCError);
    expect(error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Try again in 1 second.',
      data: { code: 'RATE_LIMITED', retryAfter: 1 },
    });
  });

  it('leaves server-side calls out of the general limit', async () => {
    env.RPC_RATE_LIMIT = 'enforce';
    for (let call = 0; call < RATE_LIMITS.general.capacity; call++) {
      consume('general', 'ip:203.0.113.7');
    }
    const { client, responses } = clientWith({
      [INTERNAL_RPC_HEADER]: await getInternalRpcToken(),
      [CLIENT_IP_HEADER]: '203.0.113.7',
    });

    await captureError(client.doesNotExist({}));

    expect(responses[0]?.status).toBe(404);
  });
});
