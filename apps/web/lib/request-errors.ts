import type { Instrumentation } from 'next';

import { logger } from '@/lib/logger';

type RequestErrorContext = Parameters<Instrumentation.onRequestError>[2];

/**
 * Logs an error Next.js caught while serving a page, route handler, or server
 * action. Next.js also prints the error as plain text, which Grafana's error
 * panels cannot count. The route pattern stands in for the address, which can
 * hold a visitor's search.
 */
export function logRequestError(
  error: unknown,
  method: string,
  context: RequestErrorContext
): void {
  const digest = (error as { digest?: unknown } | null)?.digest;

  logger.error('request failed', {
    method,
    route: context.routePath,
    routeType: context.routeType,
    // What the visitor's error page shows, to find this line from a report
    digest: typeof digest === 'string' ? digest : undefined,
    error,
  });
}
