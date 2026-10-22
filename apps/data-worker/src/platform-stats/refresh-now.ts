/**
 * Computes the platform stats on the database in DATABASE_URL now, without
 * the job queue: the ones that are due, or every one with `--all`. For a
 * stack or a copy no data worker runs against.
 *
 *   bun run --cwd apps/data-worker platform-stats:refresh [--all]
 */
import { refreshPlatformStats } from '@otr/core/platform-stats';

import { db } from '../db';
import { consoleLogger } from '../logging/logger';

const { refreshed, failed } = await refreshPlatformStats(db, {
  now: new Date(),
  all: process.argv.includes('--all'),
});

consoleLogger.info('Refreshed platform stats', { refreshed });
for (const { key, error } of failed) {
  consoleLogger.error('Failed to compute a platform stat', { key, error });
}

await db.$client.end();
process.exit(failed.length > 0 ? 1 : 0);
