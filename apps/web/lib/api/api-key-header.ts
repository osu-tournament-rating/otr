export const API_KEY_MESSAGES = {
  required: 'An API key is required to access this endpoint.',
  missing: 'API key is missing.',
  wrongScheme:
    'Provide the API key using the Authorization: Bearer <key> header.',
} as const;

export type BearerCredential =
  // No header, or a blank value
  | { kind: 'absent' }
  // Basic, Token, 'Bearerabc', ...
  | { kind: 'other-scheme' }
  // The Bearer scheme with no key
  | { kind: 'blank' }
  | { kind: 'key'; key: string };

/**
 * Reads an Authorization header value. The REST gate and the procedure
 * middleware both use this, so they always agree on what counts as a key.
 * The scheme is case-insensitive, and SP or HTAB separate it from the key
 * (RFC 9110).
 */
export const parseBearerAuthorization = (
  value: string | null | undefined
): BearerCredential => {
  const trimmed = value?.trim() ?? '';

  if (!trimmed) {
    return { kind: 'absent' };
  }

  const separator = trimmed.search(/[ \t]/);
  const scheme = separator === -1 ? trimmed : trimmed.slice(0, separator);

  if (scheme.toLowerCase() !== 'bearer') {
    return { kind: 'other-scheme' };
  }

  const key = separator === -1 ? '' : trimmed.slice(separator).trim();

  return key ? { kind: 'key', key } : { kind: 'blank' };
};

export type ApiKeyHeaderResult = { headers: Headers } | { response: Response };

const createUnauthorizedResponse = (message: string): Response => {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="otr_api"',
    },
  });
};

/**
 * Checks a REST API request's key and returns the headers the procedures
 * should see, or a 401 response. A non-blank Authorization header decides
 * alone: a Bearer key, in any case of the scheme, passes through as is, and
 * any other value is refused without looking at `x-api-key`. Otherwise an
 * `x-api-key` value comes back as a Bearer authorization, the only form the
 * procedures read. The request itself is never rebuilt: Next hands route
 * handlers a Proxy that Node's `Request` constructor can't copy.
 */
export const normalizeApiKeyHeader = (headers: Headers): ApiKeyHeaderResult => {
  const credential = parseBearerAuthorization(headers.get('authorization'));

  switch (credential.kind) {
    case 'key':
      return { headers };
    case 'blank':
      return {
        response: createUnauthorizedResponse(API_KEY_MESSAGES.missing),
      };
    case 'other-scheme':
      return {
        response: createUnauthorizedResponse(API_KEY_MESSAGES.wrongScheme),
      };
  }

  const candidate = headers.get('x-api-key')?.trim();

  if (candidate) {
    const forwardedHeaders = new Headers(headers);
    forwardedHeaders.set('authorization', `Bearer ${candidate}`);

    return { headers: forwardedHeaders };
  }

  // A credential header was sent, but blank
  if (headers.has('authorization') || headers.has('x-api-key')) {
    return {
      response: createUnauthorizedResponse(API_KEY_MESSAGES.missing),
    };
  }

  return {
    response: createUnauthorizedResponse(API_KEY_MESSAGES.required),
  };
};
