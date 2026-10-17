import { ResponseHeadersPlugin } from '@orpc/server/plugins';
import { RPCHandler } from '@orpc/server/fetch';
import { router } from '@/app/server/oRPC/router';
import { rpcAccessInterceptor } from '@/lib/rpc/access';

const handler = new RPCHandler(router, {
  plugins: [new ResponseHeadersPlugin()],
  interceptors: [rpcAccessInterceptor],
});

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/rpc',
    context: {
      headers: request.headers,
      requestUrl: request.url,
    },
  });

  return response ?? new Response('Not found', { status: 404 });
}

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
