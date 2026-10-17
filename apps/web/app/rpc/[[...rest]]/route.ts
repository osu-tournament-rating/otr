import { RPCHandler } from '@orpc/server/fetch';
import { router } from '@/app/server/oRPC/router';
import { BUILD_ID, BUILD_ID_HEADER } from '@/lib/build-id';

const handler = new RPCHandler(router);

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {
      headers: request.headers,
      requestUrl: request.url,
    },
  });

  const result = response ?? new Response('Not found', { status: 404 });
  // The browser compares this with its own build to notice a new release, and
  // takes a failed response without it as one from in front of the site.
  result.headers.set(BUILD_ID_HEADER, BUILD_ID);
  return result;
}

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
