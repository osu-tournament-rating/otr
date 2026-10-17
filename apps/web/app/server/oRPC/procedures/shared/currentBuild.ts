import { ORPCError } from '@orpc/server';

import { BUILD_ID } from '@/lib/build-id';

export const STALE_BUILD_MESSAGE =
  'Nothing was saved: o!TR has been updated since this page loaded. Reload the page to try again.';

/**
 * Throws 412 when a write through the site's own /rpc endpoint comes from a
 * page built from another release, or from one too old to send its build. That
 * page sends input shaped by its own code, which this release's procedures may
 * read differently. `clientBuild` is undefined for calls that do not come
 * through /rpc, such as the REST API, which have no build to compare.
 */
export function assertCurrentBuild(
  clientBuild: string | null | undefined,
  serverBuild: string = BUILD_ID
): void {
  if (clientBuild === undefined || clientBuild === serverBuild) {
    return;
  }

  throw new ORPCError('PRECONDITION_FAILED', {
    status: 412,
    message: STALE_BUILD_MESSAGE,
    data: { code: 'STALE_BUILD' },
  });
}
