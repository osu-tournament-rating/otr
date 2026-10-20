import { afterAll, describe, expect, it } from 'bun:test';
import { sql, TransactionRollbackError } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { PLATFORM_STATS, PlatformStatKey } from '@otr/core/platform-stats';
import type { DatabaseClient } from '@/lib/db';

import { createTestDb, testDatabaseUrl } from '../../__tests__/test-utils';
import { runStatsPage } from '../statsPageProcedures';

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

describe.skipIf(!testDatabaseUrl)('stats page statistics', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Runs `test` on empty tables inside a transaction that is rolled back, so
   * other tests' rows neither count nor change.
   */
  const onEmptyTables = async (test: (tx: Transaction) => Promise<void>) => {
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`delete from ${schema.platformStats}`);
        await tx.execute(sql`delete from ${schema.tournaments}`);
        await tx.execute(sql`delete from ${schema.tournamentAudits}`);
        await tx.execute(sql`delete from ${schema.players}`);
        await test(tx);
        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  };

  it('serves a stored statistic only in the shape this release expects', async () => {
    const version = PLATFORM_STATS.find(
      (definition) => definition.key === PlatformStatKey.HeadlineTotals
    )!.version;
    const store = (tx: Transaction, payload: unknown) =>
      tx.execute(sql`
        insert into ${schema.platformStats} (name, ruleset, payload, version, computed_at)
        values (${PlatformStatKey.HeadlineTotals}, null, ${JSON.stringify(payload)}::jsonb, ${version}, now())`);
    const totals = {
      tournaments: 3,
      matches: 20,
      games: 100,
      scores: 800,
      ratedPlayers: 40,
    };

    await onEmptyTables(async (tx) => {
      await store(tx, totals);
      const page = await runStatsPage({
        context: { db: tx as unknown as DatabaseClient },
      });
      expect(page.allRulesets.totals).toEqual(totals);
    });

    await onEmptyTables(async (tx) => {
      await store(tx, { tournaments: 3 });
      const page = await runStatsPage({
        context: { db: tx as unknown as DatabaseClient },
      });
      expect(page.allRulesets.totals).toBeNull();
    });
  });
});
