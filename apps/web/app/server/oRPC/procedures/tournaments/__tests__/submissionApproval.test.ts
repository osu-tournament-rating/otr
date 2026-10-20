import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { ORPCError } from '@orpc/server';
import { eq, inArray, like } from 'drizzle-orm';

import {
  approveTournamentSubmissionHandler,
  denyTournamentSubmissionHandler,
  listMyTournamentSubmissions,
  listTournamentSubmissionsAdminHandler,
} from '../submissionApprovalProcedures';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { ApprovalStatus, Ruleset } from '@otr/core/osu';

import {
  adminSession,
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  seedUser,
  testDatabaseUrl,
  tournamentIdByName,
  transactionFaults,
  userSession,
} from '../../__tests__/test-utils';

const NAME_PREFIX = 'tournament-submission-approval-';
const SUBMITTER_OSU_ID = 991_202_100;
const ADMIN_OSU_ID = 991_202_101;
const MATCH_IDS = [991_202_111, 991_202_112];
const BEATMAP_ID = 991_202_151;
const TOPIC_ID = 991_202;
const SUBMITTED_AT = '2026-03-04 05:06:07+00';

const errors = {
  NAME_ABBREVIATION_CONFLICT: ({ message }: { message?: string } = {}) =>
    new ORPCError('CONFLICT', { message: message ?? 'name conflict' }),
  MATCH_ASSIGNMENT_CONFLICT: ({ message }: { message?: string } = {}) =>
    new ORPCError('CONFLICT', { message: message ?? 'match conflict' }),
  TOURNAMENT_CREATION_FAILED: () =>
    new ORPCError('INTERNAL_SERVER_ERROR', { message: 'create failed' }),
  DUPLICATE_TOURNAMENT_DETAILS: () =>
    new ORPCError('CONFLICT', { message: 'duplicate' }),
};

describe.skipIf(!testDatabaseUrl)('tournament submission approval', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let submitterId = 0;
  let adminId = 0;

  const removeSeed = async () => {
    for (const userId of [submitterId, adminId]) {
      if (userId) await deleteJobs(db, userId);
    }
    await db
      .delete(schema.tournamentSubmissions)
      .where(like(schema.tournamentSubmissions.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.matches)
      .where(inArray(schema.matches.osuId, MATCH_IDS));
    await db
      .delete(schema.beatmaps)
      .where(eq(schema.beatmaps.osuId, BEATMAP_ID));
  };

  const hold = async (name: string) => {
    const [row] = await db
      .insert(schema.tournamentSubmissions)
      .values({
        submittedByUserId: submitterId,
        name,
        abbreviation: 'TSA',
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${TOPIC_ID}`,
        rankRangeLowerBound: 1000,
        ruleset: Ruleset.Taiko,
        lobbySize: 2,
        isLazer: false,
        matchIds: MATCH_IDS,
        beatmapIds: [BEATMAP_ID],
        created: SUBMITTED_AT,
      })
      .returning({ id: schema.tournamentSubmissions.id });
    return row!.id;
  };

  const submissionRow = async (id: number) =>
    (
      await db
        .select()
        .from(schema.tournamentSubmissions)
        .where(eq(schema.tournamentSubmissions.id, id))
    )[0]!;

  const context = (client: DatabaseClient = db) => ({
    db: client,
    session: adminSession(adminId),
    logging: { correlationId: 'approval-test' },
  });

  beforeAll(async () => {
    submitterId = await seedUser(db, SUBMITTER_OSU_ID);
    adminId = await seedAdminUser(db, ADMIN_OSU_ID);
  });

  afterEach(removeSeed);

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [SUBMITTER_OSU_ID, ADMIN_OSU_ID]);
    await pool.end();
  });

  it('lists only waiting submissions for admins, oldest first, with the submitter', async () => {
    const first = await hold(`${NAME_PREFIX}first`);
    const second = await hold(`${NAME_PREFIX}second`);
    await db
      .update(schema.tournamentSubmissions)
      .set({ created: '2026-03-05 00:00:00+00' })
      .where(eq(schema.tournamentSubmissions.id, first));
    const decided = await hold(`${NAME_PREFIX}decided`);
    await denyTournamentSubmissionHandler({
      input: { id: decided },
      context: context(),
    });

    const { submissions } = await listTournamentSubmissionsAdminHandler({
      context: context(),
    });
    const ours = submissions.filter((row) => row.name.startsWith(NAME_PREFIX));

    expect(ours.map((row) => row.id)).toEqual([second, first]);
    expect(ours[0]).toMatchObject({
      submitter: { id: submitterId, player: { osuId: SUBMITTER_OSU_ID } },
      matchIds: MATCH_IDS,
      beatmapIds: [BEATMAP_ID],
      matchCount: 2,
    });
  });

  it('creates the tournament with its submitter and submission time, and queues its fetches', async () => {
    const id = await hold(`${NAME_PREFIX}approved`);

    const { tournamentId } = await approveTournamentSubmissionHandler({
      input: { id },
      context: context(),
      errors,
    });

    const [tournament] = await db
      .select()
      .from(schema.tournaments)
      .where(eq(schema.tournaments.id, tournamentId));
    expect(tournament).toMatchObject({
      name: `${NAME_PREFIX}approved`,
      ruleset: Ruleset.Taiko,
      lobbySize: 2,
      rankRangeLowerBound: 1000,
      submittedByUserId: submitterId,
    });
    expect(new Date(tournament!.created).toISOString()).toBe(
      '2026-03-04T05:06:07.000Z'
    );

    const matches = await db
      .select({ tournamentId: schema.matches.tournamentId })
      .from(schema.matches)
      .where(inArray(schema.matches.osuId, MATCH_IDS));
    expect(matches).toEqual([{ tournamentId }, { tournamentId }]);

    expect(
      (await queuedFetches(db, submitterId)).map((job) => [
        job.payload,
        job.tournamentId,
      ])
    ).toEqual([
      [{ type: 'beatmap', beatmapId: BEATMAP_ID }, tournamentId],
      [{ type: 'forumTopic', topicId: TOPIC_ID }, tournamentId],
      [
        { type: 'match', osuMatchId: MATCH_IDS[0], isLazer: false },
        tournamentId,
      ],
      [
        { type: 'match', osuMatchId: MATCH_IDS[1], isLazer: false },
        tournamentId,
      ],
    ]);

    expect(await submissionRow(id)).toMatchObject({
      status: ApprovalStatus.Approved,
      tournamentId,
      reviewedByUserId: adminId,
    });
  });

  it.each(transactionFaults)(
    'keeps the submission waiting, and creates and queues nothing, when %s',
    async (_label, fault, message) => {
      const id = await hold(`${NAME_PREFIX}rollback`);

      await expect(
        approveTournamentSubmissionHandler({
          input: { id },
          context: context(fault(db)),
          errors,
        })
      ).rejects.toThrow(message);

      expect(await tournamentIdByName(db, `${NAME_PREFIX}rollback`)).toBeNull();
      expect(await queuedFetches(db, submitterId)).toEqual([]);
      expect((await submissionRow(id)).status).toBe(ApprovalStatus.Pending);
    }
  );

  it('refuses a submission whose match another tournament claimed while it waited', async () => {
    const id = await hold(`${NAME_PREFIX}claimed`);
    const [other] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}other`,
        abbreviation: 'OTH',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    await db.insert(schema.matches).values({
      osuId: MATCH_IDS[0]!,
      tournamentId: other!.id,
    });

    await expect(
      approveTournamentSubmissionHandler({
        input: { id },
        context: context(),
        errors,
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: `The following matches are already assigned to another tournament: ${MATCH_IDS[0]}.`,
    });
    expect((await submissionRow(id)).status).toBe(ApprovalStatus.Pending);
  });

  it('denies a submission without creating or queueing anything', async () => {
    const id = await hold(`${NAME_PREFIX}denied`);

    await denyTournamentSubmissionHandler({
      input: { id },
      context: context(),
    });

    expect(await submissionRow(id)).toMatchObject({
      status: ApprovalStatus.Denied,
      reviewedByUserId: adminId,
      tournamentId: null,
    });
    expect(await tournamentIdByName(db, `${NAME_PREFIX}denied`)).toBeNull();
    expect(await queuedFetches(db, submitterId)).toEqual([]);
  });

  it('refuses to decide a submission twice', async () => {
    const id = await hold(`${NAME_PREFIX}twice`);
    await denyTournamentSubmissionHandler({
      input: { id },
      context: context(),
    });

    await expect(
      approveTournamentSubmissionHandler({
        input: { id },
        context: context(),
        errors,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await tournamentIdByName(db, `${NAME_PREFIX}twice`)).toBeNull();
  });

  it("shows submitters only their own submissions, with each one's state", async () => {
    const mine = await hold(`${NAME_PREFIX}mine`);
    await denyTournamentSubmissionHandler({
      input: { id: mine },
      context: context(),
    });

    const listFor = (userId: number) =>
      listMyTournamentSubmissions['~orpc'].handler({
        context: { db, session: userSession(userId) },
      } as never) as Promise<{
        submissions: Array<{ id: number; status: ApprovalStatus }>;
      }>;

    expect((await listFor(submitterId)).submissions).toEqual([
      expect.objectContaining({ id: mine, status: ApprovalStatus.Denied }),
    ]);
    expect((await listFor(adminId)).submissions).toEqual([]);
  });
});
