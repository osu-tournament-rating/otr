import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { dbSchema } from '@otr/core/db';
import { instrumentPgPool } from '@otr/core/tracing';

import { loadRootEnv } from '../../../../lib/env/load-root-env';

loadRootEnv();

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error('DATABASE_URL is not configured');
}

export const databaseUrl: string = url;

// Job loops, lease renewals, schedulers and metrics share this pool. A
// checkout that waits this long fails, and the job retries, instead of
// hanging.
export const db = drizzle(
  instrumentPgPool(
    new Pool({
      connectionString: databaseUrl,
      max: 20,
      connectionTimeoutMillis: 30_000,
    })
  ),
  { schema: dbSchema }
);

export type DatabaseClient = typeof db;
