import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { ORPCError } from '@orpc/server';
import { inArray, like, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue, JobStatus } from '@otr/core/jobs';
import { Ruleset } from '@otr/core/osu';

import { getTournamentProgressHandler } from '../progressProcedure';
import { createPlaceholderBeatmap } from '../beatmapPlaceholders';
import {
  adminSession,
  createTestDb,
  deleteJobs,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
} from '../../__tests__/test-utils';

const NAME_PREFIX = 'tournament-progress-';
const USER_OSU_ID = 991_206_100;
const MATCH_OSU_IDS = [991_206_201, 991_206_202, 991_206_203, 991_206_204];
const BEATMAP_OSU_IDS = [991_206_301, 991_206_302, 991_206_303];

describe.skipIf(!testDatabaseUrl)('getTournamentProgressHandler', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let userId = 0;
  let tournamentId = 0;

  const removeSeed = async () => {
    if (userId) {
      await deleteJobs(db, userId);
    }
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.beatmaps)
      .where(inArray(schema.beatmaps.osuId, BEATMAP_OSU_IDS));
  };

  const seedMatch = async (
    osuId: number,
    dataFetchStatus: number,
    isLazer = false
  ) => {
    const [row] = await db
      .insert(schema.matches)
      .values({ osuId, tournamentId, dataFetchStatus, isLazer })
      .returning({ id: schema.matches.id });
    return row!.id;
  };

  const seedBeatmap = async (osuId: number, dataFetchStatus: number) => {
    const [row] = await db
      .insert(schema.beatmaps)
      .values({
        ...createPlaceholderBeatmap(osuId, Ruleset.Osu),
        dataFetchStatus,
      })
      .returning({ id: schema.beatmaps.id });
    return row!.id;
  };

  const pool_ = (beatmapId: number) =>
    db.insert(schema.joinPooledBeatmaps).values({
      pooledBeatmapsId: beatmapId,
      tournamentsPooledInId: tournamentId,
    });

  const play = (matchId: number, beatmapId: number, osuId: number) =>
    db.insert(schema.games).values({
      osuId,
      ruleset: Ruleset.Osu,
      scoringType: 3,
      teamType: 0,
      mods: 0,
      matchId,
      beatmapId,
    });

  const seedJob = async (job: {
    queue: JobQueue;
    dedupKey?: string | null;
    status?: JobStatus;
    attempts?: number;
    lastError?: string | null;
    jobTournamentId?: number | null;
  }) => {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO jobs (
        queue, dedup_key, payload, status, attempts, run_after, last_error,
        tournament_id, requested_by_user_id
      )
      VALUES (
        ${job.queue}, ${job.dedupKey ?? null}, '{}'::jsonb,
        ${job.status ?? JobStatus.Pending}, ${job.attempts ?? 0},
        now() + interval '5 minutes', ${job.lastError ?? null},
        ${job.jobTournamentId === undefined ? tournamentId : job.jobTournamentId},
        ${userId}
      )
      RETURNING id`);
    return Number(rows[0]!.id);
  };

  const progress = (session: unknown = null) =>
    getTournamentProgressHandler({
      input: { id: tournamentId },
      context: { db, session: session as never },
    });

  beforeEach(async () => {
    await removeSeed();
    userId ||= await seedAdminUser(db, USER_OSU_ID);
    const [row] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}main`,
        abbreviation: 'TP',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = row!.id;
  });

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  it('counts matches and beatmaps by fetch status, pooled and played alike', async () => {
    const fetched = await seedMatch(MATCH_OSU_IDS[0]!, DataFetchStatus.Fetched);
    await seedMatch(MATCH_OSU_IDS[1]!, DataFetchStatus.Fetching);
    await seedMatch(MATCH_OSU_IDS[2]!, DataFetchStatus.NotFound);
    await seedMatch(MATCH_OSU_IDS[3]!, DataFetchStatus.Error);

    const pooledAndPlayed = await seedBeatmap(
      BEATMAP_OSU_IDS[0]!,
      DataFetchStatus.Fetched
    );
    const pooled = await seedBeatmap(
      BEATMAP_OSU_IDS[1]!,
      DataFetchStatus.NotFetched
    );
    const played = await seedBeatmap(
      BEATMAP_OSU_IDS[2]!,
      DataFetchStatus.Fetching
    );
    await pool_(pooledAndPlayed);
    await pool_(pooled);
    await play(fetched, pooledAndPlayed, 991_206_401);
    await play(fetched, played, 991_206_402);

    const result = await progress();

    expect(result.matches).toEqual({
      total: 4,
      inFlight: 1,
      fetched: 1,
      notFound: 1,
      failed: 1,
    });
    expect(result.beatmaps).toEqual({
      total: 3,
      inFlight: 2,
      fetched: 1,
      notFound: 0,
      failed: 0,
    });
    expect(result.inFlight).toBe(true);
  });

  it('has checks wait while anything is still being fetched', async () => {
    await seedMatch(MATCH_OSU_IDS[0]!, DataFetchStatus.NotFetched);

    const result = await progress();

    expect(result.checks).toBe('waiting');
    expect(result.stats).toBe('none');
  });

  it('follows the checks job from queued to done, and stops once nothing is left', async () => {
    await seedMatch(MATCH_OSU_IDS[0]!, DataFetchStatus.Fetched);
    const checks = await seedJob({ queue: JobQueue.TournamentChecks });

    expect(await progress()).toMatchObject({
      checks: 'queued',
      inFlight: true,
    });

    await db.execute(
      sql`UPDATE jobs SET status = ${JobStatus.Succeeded} WHERE id = ${checks}`
    );

    expect(await progress()).toMatchObject({ checks: 'done', inFlight: false });
  });

  it("prefers a stage's waiting job over a newer one that finished", async () => {
    // Stats jobs never merge, so a newer one can finish while an older one
    // waits out a retry.
    await seedJob({
      queue: JobQueue.TournamentStats,
      attempts: 1,
      lastError: 'stats failed',
    });
    await seedJob({
      queue: JobQueue.TournamentStats,
      status: JobStatus.Succeeded,
    });

    expect(await progress()).toMatchObject({
      stats: 'retrying',
      inFlight: true,
    });
  });

  it('lists what needs attention for admins only', async () => {
    // Stalled: waiting to be fetched with no job.
    const stalled = await seedMatch(
      MATCH_OSU_IDS[0]!,
      DataFetchStatus.NotFetched
    );
    // Retrying: its job failed once and waits out the backoff.
    const retrying = await seedMatch(
      MATCH_OSU_IDS[1]!,
      DataFetchStatus.Fetching,
      true
    );
    await seedJob({
      queue: JobQueue.OsuFetch,
      dedupKey: `match:${MATCH_OSU_IDS[1]}:lazer`,
      attempts: 1,
      lastError: 'osu! returned 502',
    });
    // Failed: gave up, and the job that gave up is still kept.
    const failed = await seedMatch(MATCH_OSU_IDS[2]!, DataFetchStatus.Error);
    await seedJob({
      queue: JobQueue.OsuFetch,
      dedupKey: `match:${MATCH_OSU_IDS[2]}:stable`,
      status: JobStatus.Failed,
      attempts: 5,
      lastError: 'osu! returned 500',
    });
    // Queued for the first time: nothing to report.
    await seedMatch(MATCH_OSU_IDS[3]!, DataFetchStatus.NotFetched);
    await seedJob({
      queue: JobQueue.OsuFetch,
      dedupKey: `match:${MATCH_OSU_IDS[3]}:stable`,
    });
    // A beatmap whose fetch without checks is the one waiting.
    const beatmap = await seedBeatmap(
      BEATMAP_OSU_IDS[0]!,
      DataFetchStatus.NotFetched
    );
    await pool_(beatmap);
    await seedJob({
      queue: JobQueue.OsuFetch,
      dedupKey: `beatmap:${BEATMAP_OSU_IDS[0]}:nochecks`,
      jobTournamentId: null,
    });

    const visitor = await progress();
    expect(visitor.issues).toBeUndefined();
    expect(visitor.issueCount).toBeUndefined();

    const admin = await progress(adminSession(userId));
    expect(admin.issueCount).toBe(3);
    expect(
      admin.issues!.map((issue) => [
        issue.kind,
        issue.entityId,
        issue.state,
        issue.error,
      ])
    ).toEqual([
      ['match', stalled, 'stalled', null],
      ['match', retrying, 'retrying', 'osu! returned 502'],
      ['match', failed, 'failed', 'osu! returned 500'],
    ]);
  });

  it('leaves out an item that failed and is queued to fetch again', async () => {
    await seedMatch(MATCH_OSU_IDS[0]!, DataFetchStatus.Error);
    await seedJob({
      queue: JobQueue.OsuFetch,
      dedupKey: `match:${MATCH_OSU_IDS[0]}:stable`,
    });

    const result = await progress(adminSession(userId));

    expect(result.issueCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it('shows a failed item whose new job is retrying as retrying', async () => {
    await seedMatch(MATCH_OSU_IDS[0]!, DataFetchStatus.Error);
    await seedJob({
      queue: JobQueue.OsuFetch,
      dedupKey: `match:${MATCH_OSU_IDS[0]}:stable`,
      status: JobStatus.Failed,
      attempts: 5,
      lastError: 'osu! returned 500',
    });
    await seedJob({
      queue: JobQueue.OsuFetch,
      dedupKey: `match:${MATCH_OSU_IDS[0]}:stable`,
      attempts: 1,
      lastError: 'osu! returned 503',
    });

    const result = await progress(adminSession(userId));

    expect(result.issues).toEqual([
      expect.objectContaining({
        kind: 'match',
        state: 'retrying',
        error: 'osu! returned 503',
      }),
    ]);
  });

  it('reports a failed checks job to admins', async () => {
    await seedMatch(MATCH_OSU_IDS[0]!, DataFetchStatus.Fetched);
    await seedJob({
      queue: JobQueue.TournamentChecks,
      status: JobStatus.Failed,
      attempts: 5,
      lastError: 'checks crashed',
    });

    const result = await progress(adminSession(userId));

    expect(result.checks).toBe('failed');
    expect(result.issues).toEqual([
      expect.objectContaining({
        kind: 'checks',
        state: 'failed',
        error: 'checks crashed',
      }),
    ]);
  });

  it('refuses an unknown tournament', async () => {
    const error = await getTournamentProgressHandler({
      input: { id: 2_147_483_000 },
      context: { db, session: null },
    }).then(
      () => null,
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe('NOT_FOUND');
  });
});
