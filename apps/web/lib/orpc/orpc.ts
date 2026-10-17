import { router } from '@/app/server/oRPC/router';
import { BUILD_ID, BUILD_ID_HEADER } from '@/lib/build-id';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from '@orpc/client/plugins';
import { RouterClient } from '@orpc/server';
import { serverRpcBaseUrl } from './base-url';
import {
  createSiteFetch,
  RETRY_WHILE_UNREACHABLE,
  SITE_UPDATED_EVENT,
} from './site-fetch';

const isBrowser = typeof window !== 'undefined';

const link = new RPCLink<ClientRetryPluginContext>({
  url: `${isBrowser ? window.location.origin : serverRpcBaseUrl()}/rpc`,
  // The build lets the server refuse writes from a page of another release.
  headers: async () => {
    if (isBrowser) {
      return { [BUILD_ID_HEADER]: BUILD_ID };
    }

    const { headers } = await import('next/headers');
    const forwarded = new Headers(await headers());
    forwarded.set(BUILD_ID_HEADER, BUILD_ID);
    return forwarded;
  },
  // Only the browser can be left behind by a release or cut off while it
  // restarts; the server calls itself.
  ...(isBrowser && {
    fetch: createSiteFetch({
      fetch: (request, init) => fetch(request, init),
      buildId: BUILD_ID,
      onOtherBuild: () => window.dispatchEvent(new Event(SITE_UPDATED_EVENT)),
    }),
    plugins: [new ClientRetryPlugin({ default: RETRY_WHILE_UNREACHABLE })],
  }),
});

export const orpc: RouterClient<typeof router> = createORPCClient(link);
