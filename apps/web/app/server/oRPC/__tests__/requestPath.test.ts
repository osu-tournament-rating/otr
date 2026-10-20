import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { call } from '@orpc/server';
import * as tracing from '@otr/core/tracing';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { GET } from '@/app/api/[[...openapi]]/route';
import { createOpenAPIHandler, openAPIHandler } from '@/app/server/openapi';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';

import { publicProcedure } from '../procedures/base';

let spanAttributes: ReturnType<
  typeof spyOn<typeof tracing, 'setActiveSpanAttributes'>
>;
let logLines: ReturnType<typeof spyOn<typeof console, 'info'>>;

beforeEach(() => {
  spanAttributes = spyOn(tracing, 'setActiveSpanAttributes');
  logLines = spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  spanAttributes.mockRestore();
  logLines.mockRestore();
});

/** What the call's procedure span recorded as its request path. */
const spanRequestPath = () => {
  const values = spanAttributes.mock.calls
    .map(([attributes]) => attributes['otr.request_path'])
    .filter((value) => value !== undefined);

  expect(values).toHaveLength(1);
  return values[0];
};

/** The path on the call's "procedure completed" log line. */
const loggedRequestPath = () => {
  const lines = logLines.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.includes('message="procedure completed"'));

  expect(lines).toHaveLength(1);
  return lines[0]!.match(/ path=(\S+)/)?.[1];
};

describe('the request path on spans and log lines', () => {
  // The site's own calls send their input in the body, but /rpc also takes
  // it in the query string of a GET
  it('leaves out the input of a GET call to /rpc (#1095)', async () => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { searchKey: 'Stage' } })
    );
    const probe = publicProcedure.handler(() => ({ ok: true }));

    await call(probe, undefined, {
      path: ['search', 'query'],
      context: {
        headers: new Headers(),
        requestUrl: `http://localhost:3000/rpc/search/query?data=${input}`,
        rpc: { kind: 'browser', clientIp: '203.0.113.7' },
      },
    });

    expect(spanRequestPath()).toBe('/rpc/search/query');
    expect(loggedRequestPath()).toBe('/rpc/search/query');
  });

  // A player's name can be part of a REST address, and user input never goes
  // on a span; the log line already carries the input
  it('records the address of a public API request, and only its route on the span (#1096)', async () => {
    const probeHandler = createOpenAPIHandler({
      players: {
        get: publicProcedure
          .route({ tags: ['public'], method: 'GET', path: '/players/{id}' })
          .input(z.object({ id: z.string(), keyType: z.string().optional() }))
          .handler(() => ({ ok: true })),
      },
    });
    const handle = spyOn(openAPIHandler, 'handle').mockImplementation(
      (request, options) =>
        probeHandler.handle(
          request,
          options as Parameters<typeof probeHandler.handle>[1]
        )
    );
    const verifyApiKey = spyOn(auth.api, 'verifyApiKey').mockResolvedValue({
      valid: true,
      key: {
        id: 'key-123',
        referenceId: 'user-1',
        name: 'probe',
        enabled: true,
      },
      error: null,
    } as never);
    const findOwner = spyOn(db.query.auth_users, 'findFirst').mockResolvedValue(
      { id: 'user-1', name: 'Stage', playerId: null, player: null } as never
    );

    try {
      const response = await GET(
        new NextRequest('http://localhost/api/players/Stage?keyType=username', {
          headers: { authorization: 'Bearer key-123' },
        })
      );

      expect(response.status).toBe(200);
      expect(spanRequestPath()).toBe('/api/players/{id}');
      expect(loggedRequestPath()).toBe('/api/players/Stage');
    } finally {
      handle.mockRestore();
      verifyApiKey.mockRestore();
      findOwner.mockRestore();
    }
  });
});
