import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  createJobsTestDb,
  silentLogger,
  testDatabaseUrl,
} from '../../../jobs/__tests__/test-db';
import { TournamentDataCompletionService } from '../tournament-data-completion-service';

// Far above real osu! ids and other test files' ranges.
const OSU_ID = 97_000_000_000;

const waitFor = async (
  condition: () => Promise<boolean>,
  timeoutMs = 5_000
) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe.skipIf(!testDatabaseUrl)(
  "completion checks hold their tournament's locks",
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);
    const completion = new TournamentDataCompletionService({
      db,
      logger: silentLogger,
    });
    let tournamentId: number;
    let matchId: number;

    const cleanUp = () =>
      db
        .delete(schema.tournaments)
        .where(eq(schema.tournaments.abbreviation, 'LOCKS'));

    beforeEach(async () => {
      await cleanUp();
      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: 'Completion locks test',
          abbreviation: 'LOCKS',
          forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
          verificationStatus: VerificationStatus.None,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;
      const [match] = await db
        .insert(schema.matches)
        .values({
          osuId: OSU_ID + 1,
          tournamentId,
          dataFetchStatus: DataFetchStatus.Fetching,
        })
        .returning({ id: schema.matches.id });
      matchId = match!.id;
    });

    afterAll(async () => {
      await cleanUp();
      await pool.end();
    });

    // Holds a lock in a transaction of its own until the returned release runs.
    const hold = async (text: string, params: unknown[]) => {
      const client = await pool.connect();
      await client.query('BEGIN');
      await client.query(text, params);
      return async () => {
        await client.query('ROLLBACK');
        client.release();
      };
    };

    const waiting = async (locktype: string) => {
      const { rows } = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE NOT granted AND locktype = ${locktype}`);
      return rows[0]!.waiting > 0;
    };

    const matchStatus = async () =>
      (
        await db
          .select({ status: schema.matches.dataFetchStatus })
          .from(schema.matches)
          .where(eq(schema.matches.id, matchId))
      )[0]!.status;

    it("waits for another completion check of the same tournament before changing a match's status", async () => {
      const release = await hold('SELECT pg_advisory_xact_lock(1201, $1)', [
        tournamentId,
      ]);

      const update = completion.updateMatchFetchStatus(
        matchId,
        DataFetchStatus.Fetched
      );
      await waitFor(() => waiting('advisory'));
      expect(await matchStatus()).toBe(DataFetchStatus.Fetching);

      await release();
      await update;
      expect(await matchStatus()).toBe(DataFetchStatus.Fetched);
    });

    it('locks the tournament before its matches, as admin tournament edits do', async () => {
      const release = await hold(
        'SELECT 1 FROM tournaments WHERE id = $1 FOR UPDATE',
        [tournamentId]
      );

      const update = completion.updateMatchFetchStatus(
        matchId,
        DataFetchStatus.Fetched
      );
      await waitFor(() => waiting('transactionid'));
      // Waiting on the tournament means it hasn't touched the match yet, so an
      // admin edit holding the tournament can still lock the match.
      const { rows } = await db.execute<{ id: number }>(
        sql`SELECT id FROM matches WHERE id = ${matchId} FOR UPDATE NOWAIT`
      );
      expect(rows).toHaveLength(1);

      await release();
      await update;
      expect(await matchStatus()).toBe(DataFetchStatus.Fetched);
    });
  }
);
