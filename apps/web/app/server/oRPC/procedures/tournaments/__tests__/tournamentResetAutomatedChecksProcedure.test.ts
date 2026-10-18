import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';

import { resetTournamentAutomatedChecksHandler } from '../adminProcedures';
import type { DatabaseClient } from '@/lib/db';
import { enqueueJob, JobQueue } from '@otr/core/jobs';

import {
  adminSession,
  backOffJobs,
  createTestDb,
  deleteJobs,
  failingJobInserts,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
} from '../../__tests__/test-utils';

const USER_OSU_ID = 991_202_000;
// The handler queues checks for any id; the worker skips one with no tournament.
const TOURNAMENT_ID = 42;

describe.skipIf(!testDatabaseUrl)(
  'resetTournamentAutomatedChecksHandler',
  () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    let userId = 0;

    /** The automated checks jobs the admin asked for. */
    const queuedChecks = async () => {
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        SELECT dedup_key, payload, attempts, run_after, correlation_id, tournament_id
        FROM jobs
        WHERE queue = ${JobQueue.TournamentChecks}
          AND requested_by_user_id = ${userId}
        ORDER BY id`);
      return rows.map((row) => ({
        dedupKey: String(row.dedup_key),
        payload: row.payload as Record<string, unknown>,
        attempts: Number(row.attempts),
        runAfter: new Date(row.run_after as string),
        correlationId: String(row.correlation_id),
        tournamentId: Number(row.tournament_id),
      }));
    };

    beforeEach(async () => {
      userId ||= await seedAdminUser(db, USER_OSU_ID);
      await deleteJobs(db, userId);
    });

    afterAll(async () => {
      await deleteJobs(db, userId);
      await removePlayers(db, [USER_OSU_ID]);
      await pool.end();
    });

    const reset = (
      overrideVerifiedState: boolean,
      client: DatabaseClient = db
    ) =>
      resetTournamentAutomatedChecksHandler({
        input: { id: TOURNAMENT_ID, overrideVerifiedState },
        context: {
          db: client,
          session: adminSession(userId),
          logging: { correlationId: 'reset-request' },
        } as Parameters<
          typeof resetTournamentAutomatedChecksHandler
        >[0]['context'],
      });

    it('queues the checks the admin asked for', async () => {
      const result = await reset(true);

      expect(result).toEqual({ success: true });
      expect(await queuedChecks()).toEqual([
        expect.objectContaining({
          dedupKey: `tournament:${TOURNAMENT_ID}:override`,
          payload: { tournamentId: TOURNAMENT_ID, overrideVerifiedState: true },
          correlationId: 'reset-request',
          tournamentId: TOURNAMENT_ID,
        }),
      ]);
    });

    it('runs a check waiting out a retry now', async () => {
      await enqueueJob(db, JobQueue.TournamentChecks, {
        payload: { tournamentId: TOURNAMENT_ID, overrideVerifiedState: false },
        tournamentId: TOURNAMENT_ID,
        requestedByUserId: userId,
      });
      await backOffJobs(db, userId);

      await reset(false);

      const checks = await queuedChecks();
      expect(checks).toHaveLength(1);
      expect(checks[0]!.attempts).toBe(0);
      // The backoff put it an hour out.
      expect(checks[0]!.runAfter.getTime()).toBeLessThan(Date.now() + 60_000);
    });

    it('fails the call when the checks cannot be queued', async () => {
      await expect(reset(false, failingJobInserts(db))).rejects.toThrow(
        'job insert failed'
      );

      expect(await queuedChecks()).toEqual([]);
    });
  }
);
