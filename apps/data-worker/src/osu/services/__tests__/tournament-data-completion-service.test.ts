import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue, JobStatus } from '@otr/core/jobs';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  createJobsTestDb,
  silentLogger,
  testDatabaseUrl,
} from '../../../jobs/__tests__/test-db';
import { TournamentDataCompletionService } from '../tournament-data-completion-service';

// Far above real osu! ids and other test files' ranges.
const OSU_ID = 97_000_100_000;
const ABBREVIATION = 'COMPLETE';

describe.skipIf(!testDatabaseUrl)(
  'automated checks queued when a tournament finishes fetching',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);
    const service = new TournamentDataCompletionService({
      db,
      logger: silentLogger,
    });

    let tournamentId: number;
    let matchIds: number[];
    let pooledBeatmapId: number;
    let playedBeatmapId: number;

    const queuedChecks = async () => {
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        SELECT dedup_key, payload, priority, status, tournament_id
        FROM jobs
        WHERE queue = ${JobQueue.TournamentChecks}
          AND tournament_id = ${tournamentId}
        ORDER BY id`);
      return rows;
    };

    const cleanUp = async () => {
      await db.execute(sql`
        DELETE FROM jobs
        WHERE queue = ${JobQueue.TournamentChecks}
          AND tournament_id IN (
            SELECT id FROM tournaments WHERE abbreviation = ${ABBREVIATION}
          )`);
      await db
        .delete(schema.tournaments)
        .where(eq(schema.tournaments.abbreviation, ABBREVIATION));
      await db
        .delete(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, [OSU_ID + 10, OSU_ID + 11]));
    };

    const beatmap = async (osuId: number) => {
      const [row] = await db
        .insert(schema.beatmaps)
        .values({
          osuId,
          ruleset: Ruleset.Osu,
          rankedStatus: 1,
          diffName: 'data completion test',
          totalLength: 60,
          drainLength: 60,
          bpm: 200,
          countCircle: 1,
          countSlider: 0,
          countSpinner: 0,
          cs: 4,
          hp: 5,
          od: 8,
          ar: 9,
          sr: 3,
          dataFetchStatus: DataFetchStatus.NotFetched,
        })
        .returning({ id: schema.beatmaps.id });
      return row!.id;
    };

    const matchStatus = async (matchId: number) =>
      (
        await db
          .select({ status: schema.matches.dataFetchStatus })
          .from(schema.matches)
          .where(eq(schema.matches.id, matchId))
      )[0]?.status;

    beforeEach(async () => {
      await cleanUp();

      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: 'Data completion test',
          abbreviation: ABBREVIATION,
          forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
          verificationStatus: VerificationStatus.None,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;

      const matches = await db
        .insert(schema.matches)
        .values([
          { osuId: OSU_ID + 1, tournamentId },
          { osuId: OSU_ID + 2, tournamentId },
        ])
        .returning({ id: schema.matches.id });
      matchIds = matches.map((match) => match.id);

      pooledBeatmapId = await beatmap(OSU_ID + 10);
      playedBeatmapId = await beatmap(OSU_ID + 11);
      await db.insert(schema.joinPooledBeatmaps).values({
        pooledBeatmapsId: pooledBeatmapId,
        tournamentsPooledInId: tournamentId,
      });
      await db.insert(schema.games).values({
        osuId: OSU_ID + 20,
        ruleset: Ruleset.Osu,
        scoringType: 3,
        teamType: 0,
        mods: 0,
        matchId: matchIds[0]!,
        beatmapId: playedBeatmapId,
      });
    });

    afterAll(async () => {
      await cleanUp();
      await pool.end();
    });

    /** Fetches everything except the second match. */
    const fetchAllButLastMatch = async () => {
      await service.updateMatchFetchStatus(
        matchIds[0]!,
        DataFetchStatus.Fetched
      );
      await service.updateBeatmapFetchStatus(
        pooledBeatmapId,
        DataFetchStatus.Fetched
      );
      await service.updateBeatmapFetchStatus(
        playedBeatmapId,
        DataFetchStatus.Fetched
      );
    };

    it('queues automation checks once matches and beatmaps are fetched', async () => {
      await service.updateMatchFetchStatus(
        matchIds[0]!,
        DataFetchStatus.Fetched
      );
      await service.updateMatchFetchStatus(matchIds[1]!, DataFetchStatus.Error);
      await service.updateBeatmapFetchStatus(
        pooledBeatmapId,
        DataFetchStatus.Fetched
      );
      expect(await queuedChecks()).toEqual([]);

      await service.updateBeatmapFetchStatus(
        playedBeatmapId,
        DataFetchStatus.NotFound
      );

      expect(await queuedChecks()).toEqual([
        {
          dedup_key: `tournament:${tournamentId}`,
          payload: { tournamentId, overrideVerifiedState: false },
          priority: MessagePriority.Normal,
          status: JobStatus.Pending,
          tournament_id: tournamentId,
        },
      ]);
    });

    it('queues nothing when the status change rolls back', async () => {
      await fetchAllButLastMatch();

      await expect(
        db.transaction(async (tx) => {
          await service.updateMatchFetchStatus(
            matchIds[1]!,
            DataFetchStatus.Fetched,
            tx
          );
          throw new Error('rolled back');
        })
      ).rejects.toThrow('rolled back');

      expect(await matchStatus(matchIds[1]!)).toBe(DataFetchStatus.NotFetched);
      expect(await queuedChecks()).toEqual([]);
    });

    it('merges a second completion into the check still waiting', async () => {
      await fetchAllButLastMatch();

      await service.updateMatchFetchStatus(
        matchIds[1]!,
        DataFetchStatus.Fetched
      );
      // A refetched match finishing again before the check runs.
      await service.updateMatchFetchStatus(
        matchIds[1]!,
        DataFetchStatus.Fetched
      );

      expect(await queuedChecks()).toHaveLength(1);
    });
  }
);
