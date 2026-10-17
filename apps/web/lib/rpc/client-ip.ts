import { getIPFromHeader, isValidIP } from '@better-auth/core/utils/ip';

/**
 * Where a visitor's IP is read from, in order. Cloudflare's header comes
 * first: behind Cloudflare and Caddy, `x-forwarded-for` holds the Cloudflare
 * edge address, which many unrelated visitors share.
 */
export const CLIENT_IP_HEADERS = [
  'cf-connecting-ip',
  'x-forwarded-for',
] as const;

/**
 * The visitor's IP from the forwarding headers, or null when none holds a
 * single valid address. IPv6 addresses are grouped by their /64, so one
 * household counts once, and IPv4-mapped addresses become IPv4. Safe for the
 * browser bundle: the server-side oRPC link imports it.
 */
export function resolveClientIp(headers: Headers): string | null {
  for (const name of CLIENT_IP_HEADERS) {
    const value = headers.get(name);
    const ip = value ? getIPFromHeader(value, { ipv6Subnet: 64 }) : null;

    if (ip) {
      return ip;
    }
  }

  return null;
}

export { isValidIP };
