import { resolveClientIp } from '@/lib/rpc/client-ip';
import {
  CLIENT_IP_HEADER,
  getInternalRpcToken,
  INTERNAL_RPC_HEADER,
} from '@/lib/rpc/internal-token';

/**
 * The headers a server-side oRPC call sends: the visitor's own, so their
 * session applies, plus the internal token and their IP, so `/rpc` accepts the
 * call and charges any search to them. Overwrites copies of both headers a
 * visitor put on the page request.
 */
export async function buildServerRpcHeaders(
  incoming: Headers
): Promise<Headers> {
  const headers = new Headers(incoming);
  headers.set(INTERNAL_RPC_HEADER, await getInternalRpcToken());

  const clientIp = resolveClientIp(incoming);
  if (clientIp) {
    headers.set(CLIENT_IP_HEADER, clientIp);
  } else {
    headers.delete(CLIENT_IP_HEADER);
  }

  return headers;
}
