import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import type { OsuApiPayload } from '@otr/core';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue } from '@otr/core/jobs';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  createJobsTestDb,
  silentLogger,
  testDatabaseUrl,
} from '../../../jobs/__tests__/test-db';
import type { ClaimedJob, JobTransaction } from '../../../jobs/types';
import { TournamentDataCompletionService } from '../../services/tournament-data-completion-service';
import { OsuApiFetchWorker } from '../osu-api-fetch-worker';

// Far above real osu! ids and other test files' ranges.
const OSU_ID = 95_000_000_000;

describe.skipIf(!testDatabaseUrl)(
  'osu! fetches that run out of attempts',
  () => {
    const { pool, db } = createJobsTestDb(testDatabaseUrl!);
    let tournamentId: number;

    const completion = new TournamentDataCompletionService({
      db,
      logger: silentLogger,
    });

    /** The tournaments whose automated checks are queued. */
    const checksQueued = async () => {
      const { rows } = await db.execute<{ tournament_id: number }>(sql`
        SELECT tournament_id FROM jobs
        WHERE queue = ${JobQueue.TournamentChecks}
          AND tournament_id = ${tournamentId}`);
      return rows.map((row) => row.tournament_id);
    };

    const worker = new OsuApiFetchWorker({
      beatmapService: { fetchAndPersist: async () => true },
      matchService: { fetchAndPersist: async () => true },
      playerService: { fetchAndPersist: async () => true },
      forumTopicService: { fetchAndPersist: async () => true },
      dataCompletion: completion,
      logger: silentLogger,
      maintenanceWindowEnabled: false,
    });

    const giveUp = (payload: OsuApiPayload) =>
      db.transaction((tx) =>
        worker.registration().onGiveUp!(
          {
            id: 1,
            queue: JobQueue.OsuFetch,
            payload,
            priority: MessagePriority.Normal,
            attempts: 5,
            maxAttempts: 5,
            correlationId: 'give-up-test',
            tournamentId: null,
            requestedByUserId: null,
            traceContext: null,
            created: new Date().toISOString(),
          } satisfies ClaimedJob<JobQueue.OsuFetch>,
          tx as JobTransaction
        )
      );

    const cleanUp = async () => {
      await db.execute(sql`
        DELETE FROM jobs
        WHERE queue = ${JobQueue.TournamentChecks}
          AND tournament_id IN (
            SELECT id FROM tournaments WHERE abbreviation = 'GIVEUP'
          )`);
      await db
        .delete(schema.tournaments)
        .where(eq(schema.tournaments.abbreviation, 'GIVEUP'));
      await db
        .delete(schema.beatmaps)
        .where(inArray(schema.beatmaps.osuId, [OSU_ID + 10, OSU_ID + 11]));
      await db
        .delete(schema.players)
        .where(eq(schema.players.osuId, OSU_ID + 20));
    };

    const matchStatus = async (osuId: number) =>
      (
        await db
          .select({ status: schema.matches.dataFetchStatus })
          .from(schema.matches)
          .where(eq(schema.matches.osuId, osuId))
      )[0]?.status;

    const beatmapStatus = async (osuId: number) =>
      (
        await db
          .select({ status: schema.beatmaps.dataFetchStatus })
          .from(schema.beatmaps)
          .where(eq(schema.beatmaps.osuId, osuId))
      )[0]?.status;

    const beatmap = async (osuId: number, dataFetchStatus: DataFetchStatus) => {
      const [row] = await db
        .insert(schema.beatmaps)
        .values({
          osuId,
          ruleset: Ruleset.Osu,
          rankedStatus: 1,
          diffName: 'give-up test',
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
          dataFetchStatus,
        })
        .returning({ id: schema.beatmaps.id });
      await db.insert(schema.joinPooledBeatmaps).values({
        pooledBeatmapsId: row!.id,
        tournamentsPooledInId: tournamentId,
      });
    };

    beforeEach(async () => {
      await cleanUp();
      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: 'Give-up test',
          abbreviation: 'GIVEUP',
          forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
          rankRangeLowerBound: 1,
          ruleset: Ruleset.Osu,
          lobbySize: 4,
          verificationStatus: VerificationStatus.None,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;
    });

    afterAll(async () => {
      await cleanUp();
      await pool.end();
    });

    it("marks the match errored and queues its tournament's checks once nothing else is left", async () => {
      await db.insert(schema.matches).values([
        {
          osuId: OSU_ID + 1,
          tournamentId,
          dataFetchStatus: DataFetchStatus.Fetched,
        },
        {
          osuId: OSU_ID + 2,
          tournamentId,
          dataFetchStatus: DataFetchStatus.Fetching,
        },
      ]);

      await giveUp({ type: 'match', osuMatchId: OSU_ID + 2, isLazer: false });

      expect(await matchStatus(OSU_ID + 2)).toBe(DataFetchStatus.Error);
      expect(await checksQueued()).toEqual([tournamentId]);
    });

    it('marks the beatmap errored and counts it as done for automated checks', async () => {
      await db.insert(schema.matches).values({
        osuId: OSU_ID + 1,
        tournamentId,
        dataFetchStatus: DataFetchStatus.Fetched,
      });
      await beatmap(OSU_ID + 10, DataFetchStatus.Fetched);
      await beatmap(OSU_ID + 11, DataFetchStatus.Fetching);

      await giveUp({ type: 'beatmap', beatmapId: OSU_ID + 11 });

      expect(await beatmapStatus(OSU_ID + 11)).toBe(DataFetchStatus.Error);
      expect(await checksQueued()).toEqual([tournamentId]);
    });

    it("leaves a match whose data was saved alone, but still queues its tournament's checks", async () => {
      // The data committed; only the check after it failed on the last attempt.
      await db.insert(schema.matches).values({
        osuId: OSU_ID + 1,
        tournamentId,
        dataFetchStatus: DataFetchStatus.Fetched,
      });

      await giveUp({ type: 'match', osuMatchId: OSU_ID + 1, isLazer: false });

      expect(await matchStatus(OSU_ID + 1)).toBe(DataFetchStatus.Fetched);
      expect(await checksQueued()).toEqual([tournamentId]);
    });

    it('still queues checks for the tournaments of a beatmap whose data was saved', async () => {
      await db.insert(schema.matches).values({
        osuId: OSU_ID + 1,
        tournamentId,
        dataFetchStatus: DataFetchStatus.Fetched,
      });
      await beatmap(OSU_ID + 10, DataFetchStatus.Fetched);

      await giveUp({ type: 'beatmap', beatmapId: OSU_ID + 10 });

      expect(await beatmapStatus(OSU_ID + 10)).toBe(DataFetchStatus.Fetched);
      expect(await checksQueued()).toEqual([tournamentId]);
    });

    it('queues no checks while another match of the tournament is still fetching', async () => {
      await db.insert(schema.matches).values([
        {
          osuId: OSU_ID + 1,
          tournamentId,
          dataFetchStatus: DataFetchStatus.Fetched,
        },
        {
          osuId: OSU_ID + 2,
          tournamentId,
          dataFetchStatus: DataFetchStatus.Fetching,
        },
      ]);

      await giveUp({ type: 'match', osuMatchId: OSU_ID + 1, isLazer: false });

      expect(await checksQueued()).toEqual([]);
    });

    it("frees a player's fetch lease so the scheduler tries again", async () => {
      await db.insert(schema.players).values({
        osuId: OSU_ID + 20,
        username: 'give-up-test',
        dataFetchStatus: DataFetchStatus.Fetching,
      });

      await giveUp({ type: 'player', osuPlayerId: OSU_ID + 20 });

      const [player] = await db
        .select({ status: schema.players.dataFetchStatus })
        .from(schema.players)
        .where(eq(schema.players.osuId, OSU_ID + 20));
      expect(player!.status).toBe(DataFetchStatus.Error);
    });
  }
);
