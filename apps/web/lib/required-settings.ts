import { createLogger } from '@otr/core/logging';
import { optionalEnv } from '@otr/core/utils/env';

const logger = createLogger('otr-web');

/**
 * Stops the server at startup when a setting it cannot run without is blank
 * or missing, naming the setting, as the data worker and the processor do.
 * Without DATABASE_URL, the database pool would quietly connect to
 * PostgreSQL's defaults: localhost:5432, as the operating system user.
 * Throwing is not enough: Next.js logs the error and keeps serving, failing
 * every request.
 */
export function exitIfSettingsMissing(
  env: { DATABASE_URL?: string } = process.env
): void {
  if (!optionalEnv(env.DATABASE_URL)) {
    logger.error('DATABASE_URL is not configured');
    process.exit(1);
  }
}
