import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { MessagePriority } from '@otr/core';
import { enqueueJob, JobQueue } from '@otr/core/jobs';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import { StrandedFetchSweep } from '../stranded-fetch-sweep';
import {
  createJobsTestDb,
  jobRows,
  resetJobTables,
  silentLogger,
  testDatabaseUrl,
} from './test-db';

// Far above real osu! ids and other test files' ranges.
const OSU_ID = 96_000_000_000;

// Tuesday 12:00 UTC, inside the maintenance window.
const MAINTENANCE = new Date('2026-10-13T12:00:00Z');

describe.skipIf(!testDatabaseUrl)('StrandedFetchSweep', () => {
  const { pool, db } = createJobsTestDb(testDatabaseUrl!);

  const sweep = (now?: Date) =>
    new StrandedFetchSweep({
      db,
      logger: silentLogger,
      maintenanceWindowEnabled: true,
      now: now ? () => now : undefined,
    });

  let tournamentId: number;

  // Deleting the tournament deletes its matches.
  const cleanUp = async () => {
    await db
      .delete(schema.tournaments)
      .where(eq(schema.tournaments.abbreviation, 'STRAND'));
    await db
      .delete(schema.beatmaps)
      .where(
        inArray(schema.beatmaps.osuId, [
          OSU_ID + 10,
          OSU_ID + 11,
          OSU_ID + 12,
          OSU_ID + 13,
        ])
      );
  };

  const beatmap = (
    osuId: number,
    dataFetchStatus: DataFetchStatus,
    manualOverride = false
  ) =>
    db.insert(schema.beatmaps).values({
      osuId,
      ruleset: Ruleset.Osu,
      rankedStatus: 1,
      diffName: 'stranded test',
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
      manualOverride,
    });

  beforeEach(async () => {
    await resetJobTables(db);
    await cleanUp();
    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: 'Stranded fetch test',
        abbreviation: 'STRAND',
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

  it('queues a fetch for every unfinished match and beatmap with no job, and nothing else', async () => {
    await db.insert(schema.matches).values([
      {
        osuId: OSU_ID + 1,
        tournamentId,
        dataFetchStatus: DataFetchStatus.NotFetched,
      },
      {
        osuId: OSU_ID + 2,
        tournamentId,
        dataFetchStatus: DataFetchStatus.Fetching,
        isLazer: true,
      },
      {
        osuId: OSU_ID + 3,
        tournamentId,
        dataFetchStatus: DataFetchStatus.Fetched,
      },
    ]);
    await beatmap(OSU_ID + 10, DataFetchStatus.Fetching);
    await beatmap(OSU_ID + 11, DataFetchStatus.NotFound);

    expect(await sweep().run()).toEqual({ matches: 2, beatmaps: 1 });

    const payloads = (await jobRows(db)).map((row) => row.payload);
    expect(payloads).toEqual(
      expect.arrayContaining([
        { type: 'match', osuMatchId: OSU_ID + 1, isLazer: false },
        { type: 'match', osuMatchId: OSU_ID + 2, isLazer: true },
        { type: 'beatmap', beatmapId: OSU_ID + 10 },
      ])
    );
    expect(payloads).toHaveLength(3);
  });

  it('leaves alone a match whose fetch is already queued', async () => {
    await db.insert(schema.matches).values({
      osuId: OSU_ID + 1,
      tournamentId,
      dataFetchStatus: DataFetchStatus.Fetching,
    });
    await enqueueJob(db, JobQueue.OsuFetch, {
      payload: { type: 'match', osuMatchId: OSU_ID + 1, isLazer: false },
    });

    expect(await sweep().run()).toEqual({ matches: 0, beatmaps: 0 });
    expect(await jobRows(db)).toHaveLength(1);
  });

  it('queues nothing during the maintenance window', async () => {
    await db.insert(schema.matches).values({
      osuId: OSU_ID + 1,
      tournamentId,
      dataFetchStatus: DataFetchStatus.NotFetched,
    });

    expect(await sweep(MAINTENANCE).run()).toEqual({ matches: 0, beatmaps: 0 });
    expect(
      await db
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.osuId, OSU_ID + 1))
    ).toHaveLength(1);
    expect(await jobRows(db)).toHaveLength(0);
  });

  it("queues behind new submissions, tagged with the match's tournament", async () => {
    await db.insert(schema.matches).values({
      osuId: OSU_ID + 1,
      tournamentId,
      dataFetchStatus: DataFetchStatus.NotFetched,
    });

    await sweep().run();

    const [row] = await jobRows(db);
    expect(row!.priority).toBe(MessagePriority.Low);
    expect(row!.tournament_id).toBe(tournamentId);
  });

  it('leaves alone a beatmap an admin set by hand, or whose skip-checks fetch is queued', async () => {
    await beatmap(OSU_ID + 12, DataFetchStatus.NotFetched, true);
    await beatmap(OSU_ID + 13, DataFetchStatus.Fetching);
    await enqueueJob(db, JobQueue.OsuFetch, {
      payload: {
        type: 'beatmap',
        beatmapId: OSU_ID + 13,
        skipAutomationChecks: true,
      },
    });

    expect(await sweep().run()).toEqual({ matches: 0, beatmaps: 0 });
  });
});
