import { createHmac } from 'node:crypto';

import { resolveInternalRpcSecret } from './internal-token';

const SOURCE_LABEL = 'otr-source:v1';

/**
 * A stand-in for a visitor's IP in logs and metrics. One IP gets the same ID
 * all UTC day and a new one the next, so a day's logs show which calls came
 * from one place without recording where. Cloudflare holds the real address
 * when a source needs blocking.
 */
export function sourceId(
  ip: string,
  now: Date = new Date(),
  secret: string = resolveInternalRpcSecret()
): string {
  const day = now.toISOString().slice(0, 10);

  return createHmac('sha256', `${SOURCE_LABEL}:${secret}`)
    .update(`${day}|${ip}`)
    .digest('hex')
    .slice(0, 12);
}
