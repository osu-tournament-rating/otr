import { router } from '@/app/server/oRPC/router';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { RouterClient } from '@orpc/server';
import { serverRpcBaseUrl } from './base-url';

const link = new RPCLink({
  url: `${
    typeof window !== 'undefined' ? window.location.origin : serverRpcBaseUrl()
  }/rpc`,
  headers: async () => {
    if (typeof window !== 'undefined') {
      return {};
    }

    const { headers } = await import('next/headers');
    // Read first: it opts the page into dynamic rendering
    const incoming = await headers();
    const { buildServerRpcHeaders } = await import('./server-headers');
    return buildServerRpcHeaders(incoming);
  },
});

export const orpc: RouterClient<typeof router> = createORPCClient(link);
