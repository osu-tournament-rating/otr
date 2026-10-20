import { eq, inArray, is, sql, SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { JobQueue } from '@otr/core/jobs';
import type { DatabaseClient } from '@/lib/db';

// Set by the `checks` job in .github/workflows/ci.yml. Tests seed and delete
// rows, so point it at a disposable database.
export const testDatabaseUrl = process.env.SEARCH_TEST_DATABASE_URL;

export const createTestDb = (url: string) => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  return { pool, db };
};

/** Deletes the user linked to each player, then the players. */
export const removePlayers = async (db: DatabaseClient, osuIds: number[]) => {
  if (osuIds.length === 0) {
    return;
  }

  const players = await db
    .select({ id: schema.players.id })
    .from(schema.players)
    .where(inArray(schema.players.osuId, osuIds));

  if (players.length === 0) {
    return;
  }

  const playerIds = players.map((player) => player.id);
  await db
    .delete(schema.users)
    .where(inArray(schema.users.playerId, playerIds));
  await db.delete(schema.players).where(inArray(schema.players.id, playerIds));
};

/**
 * An admin account. Every job a test's procedure queues names it as the
 * requester, which keeps each file's jobs apart from other tests' rows.
 */
export const seedAdminUser = async (db: DatabaseClient, osuId: number) => {
  await removePlayers(db, [osuId]);

  const [player] = await db
    .insert(schema.players)
    .values({ osuId })
    .returning({ id: schema.players.id });
  const [user] = await db
    .insert(schema.users)
    .values({ playerId: player!.id, scopes: ['admin'] })
    .returning({ id: schema.users.id });

  return user!.id;
};

/** A signed-in account without admin scopes. */
export const seedUser = async (db: DatabaseClient, osuId: number) => {
  await removePlayers(db, [osuId]);

  const [player] = await db
    .insert(schema.players)
    .values({ osuId })
    .returning({ id: schema.players.id });
  const [user] = await db
    .insert(schema.users)
    .values({ playerId: player!.id, scopes: [] })
    .returning({ id: schema.users.id });

  return user!.id;
};

export const userSession = (userId: number) => ({
  dbUser: { id: userId, scopes: [] as string[] },
});

export const adminSession = (userId: number) => ({
  dbUser: { id: userId, scopes: ['admin'] },
});

export interface QueuedFetch {
  dedupKey: string;
  payload: Record<string, unknown>;
  priority: number;
  attempts: number;
  runAfter: Date;
  correlationId: string;
  tournamentId: number | null;
}

/** The osu! fetch jobs `userId` asked for, ordered by dedup key. */
export const queuedFetches = async (
  db: DatabaseClient,
  userId: number
): Promise<QueuedFetch[]> => {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT dedup_key, payload, priority, attempts, run_after, correlation_id, tournament_id
    FROM jobs
    WHERE queue = ${JobQueue.OsuFetch} AND requested_by_user_id = ${userId}
    ORDER BY dedup_key`);

  return rows.map((row) => ({
    dedupKey: String(row.dedup_key),
    payload: row.payload as Record<string, unknown>,
    priority: Number(row.priority),
    attempts: Number(row.attempts),
    runAfter: new Date(row.run_after as string),
    correlationId: String(row.correlation_id),
    tournamentId: row.tournament_id === null ? null : Number(row.tournament_id),
  }));
};

/**
 * Deletes the user's jobs, and jobs left by test users an interrupted run
 * never cleaned up, which would otherwise absorb later runs' requests.
 */
export const deleteJobs = async (db: DatabaseClient, userId: number) => {
  await db.execute(sql`
    DELETE FROM jobs
    WHERE requested_by_user_id = ${userId}
      OR (
        requested_by_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM users WHERE users.id = jobs.requested_by_user_id)
      )`);
};

/** Puts the user's waiting jobs in a retry's backoff, as after two failed attempts. */
export const backOffJobs = async (db: DatabaseClient, userId: number) => {
  await db.execute(sql`
    UPDATE jobs SET attempts = 2, run_after = now() + interval '1 hour'
    WHERE requested_by_user_id = ${userId}`);
};

export const tournamentIdByName = async (db: DatabaseClient, name: string) => {
  const [row] = await db
    .select({ id: schema.tournaments.id })
    .from(schema.tournaments)
    .where(eq(schema.tournaments.name, name));
  return row?.id ?? null;
};

const dialect = new PgDialect();

const isJobInsert = (query: unknown) =>
  is(query, SQL) &&
  dialect.sqlToQuery(query).sql.trimStart().startsWith('INSERT INTO jobs');

type Execute = (query: unknown) => Promise<unknown>;
type Transaction = (
  callback: (tx: object) => Promise<unknown>,
  config?: unknown
) => Promise<unknown>;

interface Fault {
  /** Runs instead of each `execute`, on the client and in its transactions. */
  execute?: (query: unknown, execute: Execute) => Promise<unknown>;
  /** Fails every transaction after its callback has run. */
  rollBack?: boolean;
}

const withFault = (db: DatabaseClient, fault: Fault): DatabaseClient => {
  const wrap = <T extends object>(client: T): T =>
    new Proxy(client, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;

        if (property === 'execute' && fault.execute) {
          const execute = (value as Execute).bind(target);
          return (query: unknown) => fault.execute!(query, execute);
        }

        if (property === 'transaction') {
          return (
            callback: (tx: object) => Promise<unknown>,
            config?: unknown
          ) =>
            (value as Transaction).call(
              target,
              async (tx: object) => {
                const result = await callback(wrap(tx));
                if (fault.rollBack) {
                  throw new Error('transaction rolled back');
                }
                return result;
              },
              config
            );
        }

        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  return wrap(db);
};

/** `db` with every INSERT into jobs failing. Everything else runs against the database. */
export const failingJobInserts = (db: DatabaseClient) =>
  withFault(db, {
    execute: (query, execute) =>
      isJobInsert(query)
        ? Promise.reject(new Error('job insert failed'))
        : execute(query),
  });

/** `db` with every transaction rolled back after all its statements have run. */
export const rolledBackTransactions = (db: DatabaseClient) =>
  withFault(db, { rollBack: true });

/**
 * The ways a procedure's transaction can fail. Saved rows and queued jobs must
 * share its fate: the first fails if jobs are queued after the transaction,
 * the second if they are queued outside it.
 */
export const transactionFaults = [
  ['queueing fails', failingJobInserts, 'job insert failed'],
  [
    'the transaction rolls back',
    rolledBackTransactions,
    'transaction rolled back',
  ],
] as const;
