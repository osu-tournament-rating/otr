import { describe, expect, it } from 'bun:test';

import {
  normalizeApiKeyHeader,
  parseBearerAuthorization,
  type BearerCredential,
} from '../api-key-header';

const REQUIRED = 'An API key is required to access this endpoint.';
const MISSING = 'API key is missing.';
const WRONG_SCHEME =
  'Provide the API key using the Authorization: Bearer <key> header.';

const expectUnauthorized = async (headers: HeadersInit, message: string) => {
  const result = normalizeApiKeyHeader(new Headers(headers));

  if (!('response' in result)) {
    throw new Error('Expected a 401 response');
  }

  expect(result.response.status).toBe(401);
  expect(result.response.headers.get('www-authenticate')).toBe(
    'Bearer realm="otr_api"'
  );
  expect(await result.response.json()).toEqual({ error: message });
};

describe('parseBearerAuthorization', () => {
  const cases: Array<[string | null, BearerCredential]> = [
    [null, { kind: 'absent' }],
    ['', { kind: 'absent' }],
    ['   ', { kind: 'absent' }],
    ['Bearer', { kind: 'blank' }],
    ['bearer   ', { kind: 'blank' }],
    ['Bearer k', { kind: 'key', key: 'k' }],
    ['bEaReR   k ', { kind: 'key', key: 'k' }],
    ['Bearer\tk', { kind: 'key', key: 'k' }],
    ['Basic dXNlcjpwYXNz', { kind: 'other-scheme' }],
    ['Bearerk', { kind: 'other-scheme' }],
    ['Token k', { kind: 'other-scheme' }],
    // Only SP and HTAB separate the scheme, not other whitespace such as NBSP
    ['Bearer k', { kind: 'other-scheme' }],
  ];

  it.each(cases)('reads %p', (value, expected) => {
    expect(parseBearerAuthorization(value)).toEqual(expected);
  });
});

describe('normalizeApiKeyHeader', () => {
  it('passes a Bearer authorization through unchanged', () => {
    const headers = new Headers({ authorization: 'Bearer key-123' });

    expect(normalizeApiKeyHeader(headers)).toEqual({ headers });
  });

  it('accepts the Bearer scheme in any case', () => {
    for (const authorization of [
      'bearer key-123',
      'BEARER key-123',
      'bEaReR key-123',
    ]) {
      const headers = new Headers({ authorization });
      const result = normalizeApiKeyHeader(headers);

      if (!('headers' in result)) {
        throw new Error(`Expected headers for ${authorization}`);
      }

      expect(result.headers).toBe(headers);
    }
  });

  it('turns an x-api-key header into a Bearer authorization', () => {
    const headers = new Headers({ 'x-api-key': ' key-123 ', accept: 'a/b' });
    const result = normalizeApiKeyHeader(headers);

    if (!('headers' in result)) {
      throw new Error('Expected headers');
    }

    expect(result.headers.get('authorization')).toBe('Bearer key-123');
    expect(result.headers.get('accept')).toBe('a/b');
    expect(headers.has('authorization')).toBe(false);
  });

  it('reads x-api-key when the authorization header is empty', () => {
    const result = normalizeApiKeyHeader(
      new Headers({ authorization: '', 'x-api-key': 'key-123' })
    );

    if (!('headers' in result)) {
      throw new Error('Expected headers');
    }

    expect(result.headers.get('authorization')).toBe('Bearer key-123');
  });

  it('prefers the authorization header over x-api-key', () => {
    for (const authorization of [
      'Bearer from-authorization',
      'bearer from-authorization',
    ]) {
      const headers = new Headers({
        authorization,
        'x-api-key': 'from-x-api-key',
      });

      expect(normalizeApiKeyHeader(headers)).toEqual({ headers });
    }
  });

  // The procedures find the key with the same parser. When the two disagreed,
  // a request the gate let through ran without its key checked (#1061).
  it('hands the procedures a key they can read for every request it accepts', () => {
    const accepted: HeadersInit[] = [
      { authorization: 'Bearer key-123' },
      { authorization: 'bearer key-123' },
      { authorization: 'BEARER key-123' },
      { authorization: 'bEaReR key-123' },
      { authorization: 'Bearer   key-123' },
      { authorization: 'Bearer\tkey-123' },
      { 'x-api-key': ' key-123 ' },
      { authorization: '', 'x-api-key': 'key-123' },
    ];

    for (const init of accepted) {
      const result = normalizeApiKeyHeader(new Headers(init));

      if (!('headers' in result)) {
        throw new Error(`Expected headers for ${JSON.stringify(init)}`);
      }

      expect(
        parseBearerAuthorization(result.headers.get('authorization'))
      ).toEqual({ kind: 'key', key: 'key-123' });
    }
  });

  it('rejects a request without a key', async () => {
    await expectUnauthorized({}, REQUIRED);
  });

  it('rejects a blank key', async () => {
    await expectUnauthorized({ 'x-api-key': '' }, MISSING);
    await expectUnauthorized({ 'x-api-key': '   ' }, MISSING);
    await expectUnauthorized({ authorization: '' }, MISSING);
  });

  it('rejects an authorization header that is not Bearer', async () => {
    for (const authorization of [
      'Basic dXNlcjpwYXNz',
      'basic dXNlcjpwYXNz',
      'Token key-123',
      'Bearerkey-123',
    ]) {
      await expectUnauthorized({ authorization }, WRONG_SCHEME);
    }
  });

  it('rejects a Bearer authorization without a key', async () => {
    for (const authorization of [
      'Bearer    ',
      'Bearer',
      'bearer',
      'BEARER  ',
    ]) {
      await expectUnauthorized({ authorization }, MISSING);
    }
  });

  it('never falls back to x-api-key when the authorization header is unusable', async () => {
    await expectUnauthorized(
      { authorization: 'Basic dXNlcjpwYXNz', 'x-api-key': 'key-123' },
      WRONG_SCHEME
    );
    await expectUnauthorized(
      { authorization: 'Bearer', 'x-api-key': 'key-123' },
      MISSING
    );
  });
});
