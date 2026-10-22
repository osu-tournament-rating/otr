import { openAPIHandler } from '@/app/server/openapi';
import { normalizeApiKeyHeader } from '@/lib/api/api-key-header';
import { PUBLIC_API_PREFIX } from '@/lib/api/prefix';

async function handle(request: Request) {
  let headers = request.headers;

  if (request.method !== 'OPTIONS') {
    const normalization = normalizeApiKeyHeader(request.headers);

    if ('response' in normalization) {
      return normalization.response;
    }

    headers = normalization.headers;
  }

  const result = await openAPIHandler.handle(request, {
    prefix: PUBLIC_API_PREFIX,
    context: {
      headers,
      requestUrl: request.url,
      apiKeyRequired: true,
    },
  });

  if (result.matched) {
    return result.response ?? new Response(null, { status: 204 });
  }

  return new Response('Not found', { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
