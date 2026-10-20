import { createLogger } from '@otr/core/logging';

/**
 * The web server's structured logger. Grafana's error panels count only lines
 * that carry a level, and each line carries the trace ID of the request it
 * was written in, so server code logs here rather than with console.error.
 */
export const logger = createLogger('otr-web');
