import { ORPCError } from '@orpc/server';
import { sql, type SQL } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import {
  allowanceRetryAfterSeconds,
  MS_PER_REQUEST,
} from '@/lib/api/api-allowance';
import type { DatabaseClient } from '@/lib/db';

type Executor = Pick<DatabaseClient, 'execute'>;

/** Milliseconds until the matching user's allowance is full, on the database clock. */
async function msUntilFull(db: Executor, where: SQL): Promise<number> {
  const { rows } = await db.execute<{ ms: string | number | null }>(sql`
    SELECT GREATEST(
      0,
      EXTRACT(EPOCH FROM (${schema.users.apiAllowanceFullAt} - CURRENT_TIMESTAMP)) * 1000
    ) AS ms
    FROM ${schema.users}
    WHERE ${where}`);

  return Number(rows[0]?.ms ?? 0);
}

/** Seconds until the user may spend their API allowance again; 0 when they can now. */
export async function apiAllowanceRetryAfter(
  db: Executor,
  userId: number
): Promise<number> {
  return allowanceRetryAfterSeconds(
    await msUntilFull(db, sql`${schema.users.id} = ${userId}`)
  );
}

/** {@link apiAllowanceRetryAfter} for the user linked to a player, as an API key names its owner. */
export async function apiAllowanceRetryAfterForPlayer(
  db: Executor,
  playerId: number
): Promise<number> {
  return allowanceRetryAfterSeconds(
    await msUntilFull(db, sql`${schema.users.playerId} = ${playerId}`)
  );
}

/**
 * Takes `requests` from the user's API allowance. It may go past what is
 * left: the user's API calls then wait until it refills.
 */
export async function chargeApiAllowance(
  db: Executor,
  userId: number,
  requests: number
): Promise<void> {
  if (requests <= 0) {
    return;
  }

  const seconds = (requests * MS_PER_REQUEST) / 1000;

  await db.execute(sql`
    UPDATE ${schema.users}
    SET api_allowance_full_at = GREATEST(
      COALESCE(${schema.users.apiAllowanceFullAt}, CURRENT_TIMESTAMP),
      CURRENT_TIMESTAMP
    ) + make_interval(secs => ${seconds})
    WHERE ${schema.users.id} = ${userId}`);
}

/** Refuses a call while lookups have used the user's allowance. */
export const allowanceUsedError = (retryAfterSeconds: number) =>
  new ORPCError('TOO_MANY_REQUESTS', {
    status: 429,
    message: `Your API allowance is in use by player lookups from registrant filtering. Try again in ${retryAfterSeconds} ${
      retryAfterSeconds === 1 ? 'second' : 'seconds'
    }.`,
    data: { code: 'LOOKUP_ALLOWANCE_USED', retryAfter: retryAfterSeconds },
  });
