import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MessagePriority } from '@otr/core';
import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { JobQueue } from '@otr/core/jobs';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { DatabaseClient } from '../../db';

// Set by the `checks` job in .github/workflows/ci.yml.
const testDatabaseUrl = process.env.SEARCH_TEST_DATABASE_URL;

const SEED_OSU_ID = 990_000_320;
const SEED_NAME = 'stats-rebuild-migration-';
const MIGRATION = join(
  import.meta.dir,
  '../../../../web/drizzle/0043_rebuild_tournament_stats.sql'
);

describe.skipIf(!testDatabaseUrl)(
  'the one-time tournament stats rebuild',
  () => {
    const pool = new Pool({ connectionString: testDatabaseUrl });
    const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;

    const removeSeed = async () => {
      await db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${SEED_NAME}%`));
      await db
        .delete(schema.players)
        .where(inArray(schema.players.osuId, [SEED_OSU_ID]));
    };

    beforeAll(removeSeed);
    afterAll(async () => {
      await removeSeed();
      await pool.end();
    });

    it('queues one delayed, low-priority stats job for each verified tournament with stats', async () => {
      const [player] = await db
        .insert(schema.players)
        .values({ osuId: SEED_OSU_ID, username: `rebuild-${SEED_OSU_ID}` })
        .returning({ id: schema.players.id });
      const seeds = [
        { key: 'verified', status: VerificationStatus.Verified, stats: true },
        { key: 'no-stats', status: VerificationStatus.Verified, stats: false },
        {
          key: 'pre-verified',
          status: VerificationStatus.PreVerified,
          stats: true,
        },
      ];
      const tournaments = await db
        .insert(schema.tournaments)
        .values(
          seeds.map((seed, index) => ({
            name: `${SEED_NAME}${seed.key}`,
            abbreviation: 'SRM',
            forumUrl: `https://osu.ppy.sh/community/forums/topics/${SEED_OSU_ID + index}`,
            rankRangeLowerBound: 1,
            ruleset: Ruleset.Osu,
            lobbySize: 1,
            verificationStatus: seed.status,
          }))
        )
        .returning({ id: schema.tournaments.id });
      await db.insert(schema.playerTournamentStats).values(
        tournaments
          .filter((_, index) => seeds[index]!.stats)
          .map((tournament) => ({
            playerId: player!.id,
            tournamentId: tournament.id,
            averageRatingDelta: 0,
            averageMatchCost: 1,
            averageScore: 500_000,
            averagePlacement: 1,
            averageAccuracy: 0.95,
            matchesPlayed: 1,
            matchesWon: 1,
            matchesLost: 0,
            gamesPlayed: 1,
            gamesWon: 1,
            gamesLost: 0,
            teammateIds: [],
          }))
      );
      const tournamentIds = tournaments.map((tournament) => tournament.id);

      // Rolled back, so the jobs it queues for other tests' tournaments go too.
      const client = await pool.connect();
      let jobs: Array<{
        queue: string;
        payload: unknown;
        priority: number;
        tournament_id: number;
        delay_seconds: number;
      }>;
      try {
        await client.query('BEGIN');
        await client.query(await readFile(MIGRATION, 'utf8'));
        ({ rows: jobs } = await client.query(
          `SELECT queue, payload, priority, tournament_id,
           EXTRACT(EPOCH FROM run_after - now())::float AS delay_seconds
         FROM jobs
         WHERE tournament_id = ANY($1)`,
          [tournamentIds]
        ));
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }

      const verifiedId = tournamentIds[0]!;
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        queue: JobQueue.TournamentStats,
        payload: { tournamentId: verifiedId },
        priority: MessagePriority.Low,
        tournament_id: verifiedId,
      });
      // A deploy waits up to 300 seconds for each of the two web containers to
      // pass its health check before it replaces the previous worker.
      expect(jobs[0]!.delay_seconds).toBeGreaterThan(2 * 300);
    });
  }
);
