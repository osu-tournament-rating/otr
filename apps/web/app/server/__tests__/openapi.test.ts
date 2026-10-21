import { describe, expect, it } from 'bun:test';
import { os } from '@orpc/server';

import { normalizeApiKeyHeader } from '@/lib/api/api-key-header';
import { LeaderboardRequestSchema } from '@/lib/orpc/schema/leaderboard';
import { TournamentListRequestSchema } from '@/lib/orpc/schema/tournament';

import { createOpenAPIHandler, generatePublicOpenAPISpec } from '../openapi';

// Echoes its parsed input, so a test sees what a query string becomes after
// the REST API's coercion and validation, using the public filters' schemas
const probeRouter = os.router({
  probe: os
    .input(
      TournamentListRequestSchema.pick({
        ruleset: true,
        rulesets: true,
        verificationStatus: true,
        lobbySize: true,
      }).extend(LeaderboardRequestSchema.pick({ tiers: true }).shape)
    )
    .route({ tags: ['public'], method: 'GET', path: '/probe' })
    .handler(({ input }) => input),
  probeBody: os
    .input(LeaderboardRequestSchema.pick({ tiers: true }))
    .route({ tags: ['public'], method: 'POST', path: '/probe' })
    .handler(({ input }) => input),
});

const probeHandler = createOpenAPIHandler(probeRouter);

const parseQuery = async (query: string) => {
  const { response } = await probeHandler.handle(
    new Request(`http://localhost/api/probe?${query}`),
    { prefix: '/api', context: {} }
  );

  return { status: response?.status, body: await response?.json() };
};

describe('public API list filters', () => {
  it('reads one value as a list of one (#1188)', async () => {
    expect(
      await parseQuery('tiers=gold&rulesets=0&verificationStatus=4&lobbySize=2')
    ).toEqual({
      status: 200,
      body: {
        tiers: ['gold'],
        rulesets: [0],
        verificationStatus: [4],
        lobbySize: [2],
      },
    });
  });

  it('reads a repeated key as a list', async () => {
    expect(
      await parseQuery('rulesets=0&rulesets=3&tiers=gold&tiers=master')
    ).toEqual({
      status: 200,
      body: { rulesets: [0, 3], tiers: ['gold', 'master'] },
    });
  });

  it('leaves a single-value filter as a value', async () => {
    expect(await parseQuery('ruleset=1')).toEqual({
      status: 200,
      body: { ruleset: 1 },
    });
  });
});

describe('public API JSON bodies', () => {
  it('still refuses one value where a body takes a list', async () => {
    const { response } = await probeHandler.handle(
      new Request('http://localhost/api/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tiers: 'gold' }),
      }),
      { prefix: '/api', context: {} }
    );

    expect(response?.status).toBe(400);
  });
});

describe('public API reference', () => {
  it('documents list filters as repeated query keys', async () => {
    const spec = await generatePublicOpenAPISpec();
    const queryParameters = Object.values(spec.paths ?? {})
      .flatMap((operations) => Object.values(operations ?? {}))
      .flatMap((operation) =>
        typeof operation === 'object' && 'parameters' in operation
          ? (operation.parameters ?? [])
          : []
      )
      .filter(
        (parameter) => 'in' in parameter && parameter.in === 'query'
      ) as Array<{ name: string; style?: string; schema?: { type?: string } }>;

    const lists = queryParameters.filter(
      (parameter) => parameter.schema?.type === 'array'
    );
    expect(lists.map(({ name }) => name)).toContain('tiers');

    // OpenAPI defines deepObject only for objects, so clients send a list
    // given that style in forms the API does not read
    expect(
      queryParameters
        .filter((parameter) => parameter.style === 'deepObject')
        .map(({ name }) => name)
    ).toEqual([]);
  });

  it('documents each header the API accepts a key in (#1097)', async () => {
    const spec = await generatePublicOpenAPISpec();
    const schemes = (spec.components?.securitySchemes ?? {}) as Record<
      string,
      { type?: string; scheme?: string; in?: string; name?: string }
    >;

    // The headers a client following one security scheme sends
    const requestHeaders = (schemeName: string): Record<string, string> => {
      const scheme = schemes[schemeName];
      if (scheme?.type === 'http' && scheme.scheme === 'bearer') {
        return { authorization: 'Bearer key-123' };
      }
      if (scheme?.type === 'apiKey' && scheme.in === 'header' && scheme.name) {
        return { [scheme.name]: 'key-123' };
      }
      throw new Error(`Unexpected security scheme ${schemeName}`);
    };

    // Each requirement is an alternative a client may satisfy alone
    const alternatives = (spec.security ?? []).map((requirement) => {
      const schemeNames = Object.keys(requirement);
      expect(schemeNames).toHaveLength(1);
      return requestHeaders(schemeNames[0]!);
    });

    expect(alternatives.map((headers) => Object.keys(headers))).toEqual([
      ['authorization'],
      ['x-api-key'],
    ]);

    for (const headers of alternatives) {
      const result = normalizeApiKeyHeader(new Headers(headers));
      expect('headers' in result && result.headers.get('authorization')).toBe(
        'Bearer key-123'
      );
    }
  });
});
