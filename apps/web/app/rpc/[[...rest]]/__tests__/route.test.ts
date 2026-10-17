import { describe, expect, it } from 'bun:test';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { NextRequest } from 'next/server';

import { SITE_ONLY_MESSAGE } from '@/lib/rpc/access';

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
});
