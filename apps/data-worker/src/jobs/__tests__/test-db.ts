import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';

import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';

// CI's checks job sets this to its migrated test database.
export const testDatabaseUrl = process.env.SEARCH_TEST_DATABASE_URL;

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

export const createJobsTestDb = (url: string) => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  return { pool, db };
};

export const resetJobTables = async (db: DatabaseClient) => {
  await db.execute(sql`DELETE FROM jobs`);
  await db.execute(sql`DELETE FROM job_stats_daily`);
  await db.execute(sql`DELETE FROM api_request_stats_daily`);
};

export interface JobRow {
  id: number;
  queue: string;
  dedup_key: string | null;
  payload: Record<string, unknown>;
  priority: number;
  status: number;
  attempts: number;
  max_attempts: number;
  rerun_requested: boolean;
  run_after: Date;
  locked_by: string | null;
  locked_until: Date | null;
  last_error: string | null;
  correlation_id: string;
  tournament_id: number | null;
  finished: Date | null;
}

export const jobRows = async (db: DatabaseClient): Promise<JobRow[]> => {
  const { rows } = await db.execute<Record<string, unknown>>(
    sql`SELECT * FROM jobs ORDER BY id`
  );
  const date = (value: unknown) =>
    value === null ? null : new Date(value as string);
  return rows.map(
    (row) =>
      ({
        ...row,
        id: Number(row.id),
        run_after: date(row.run_after),
        locked_until: date(row.locked_until),
        finished: date(row.finished),
      }) as JobRow
  );
};

export const dailyTotals = async (db: DatabaseClient, queue: string) => {
  const { rows } = await db.execute<Record<string, unknown>>(
    sql`SELECT * FROM job_stats_daily WHERE queue = ${queue}`
  );
  const row = rows[0];
  return row
    ? Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          key === 'day' || key === 'queue' ? value : Number(value),
        ])
      )
    : null;
};
