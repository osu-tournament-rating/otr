import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { ORPCError } from '@orpc/server';
import { eq, inArray, like } from 'drizzle-orm';

import {
  submitTournamentHandler,
  type SubmitTournamentHandlerArgs,
} from '../tournamentSubmissionProcedure';
import type { DatabaseClient } from '@/lib/db';
import { isolateMaintenanceWindowEnv } from '@/lib/maintenance-window.test-utils';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { ApprovalStatus, Ruleset } from '@otr/core/osu';

import {
  adminSession,
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
  tournamentIdByName,
  transactionFaults,
  userSession,
} from '../../__tests__/test-utils';

const NAME_PREFIX = 'tournament-submission-jobs-';
const USER_OSU_ID = 991_201_100;
const MATCH_IDS = [991_201_101, 991_201_102];
const NEW_BEATMAP_ID = 991_201_151;
const KNOWN_BEATMAP_ID = 991_201_152;
const TOPIC_ID = 991_201;

const createErrors = () => ({
  ACCOUNT_RESOLUTION_FAILED: () =>
    new ORPCError('FORBIDDEN', { message: 'no session' }),
  NAME_ABBREVIATION_CONFLICT: ({ message }: { message?: string } = {}) =>
    new ORPCError('CONFLICT', { message: message ?? 'conflict' }),
  MATCH_ASSIGNMENT_CONFLICT: ({ message }: { message?: string } = {}) =>
    new ORPCError('CONFLICT', { message: message ?? 'match conflict' }),
  TOURNAMENT_CREATION_FAILED: () =>
    new ORPCError('INTERNAL_SERVER_ERROR', { message: 'create failed' }),
  DUPLICATE_TOURNAMENT_DETAILS: () =>
    new ORPCError('CONFLICT', { message: 'duplicate' }),
  SUBMISSION_FAILED: () =>
    new ORPCError('INTERNAL_SERVER_ERROR', { message: 'submission failed' }),
});

describe.skipIf(!testDatabaseUrl)('submitTournamentHandler', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const maintenanceWindowEnabled = process.env.MAINTENANCE_WINDOW_ENABLED;
  let userId = 0;

  const removeSeed = async () => {
    if (userId) {
      await deleteJobs(db, userId);
      await db
        .delete(schema.tournamentSubmissions)
        .where(eq(schema.tournamentSubmissions.submittedByUserId, userId));
    }
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.beatmaps)
      .where(
        inArray(schema.beatmaps.osuId, [NEW_BEATMAP_ID, KNOWN_BEATMAP_ID])
      );
  };

  const submit = (
    name: string,
    overrides: Partial<SubmitTournamentHandlerArgs['input']> = {},
    client: DatabaseClient = db,
    session: SubmitTournamentHandlerArgs['context']['session'] = adminSession(
      userId
    )
  ) =>
    submitTournamentHandler({
      input: {
        name,
        abbreviation: 'TSJ',
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${TOPIC_ID}`,
        ruleset: Ruleset.Osu,
        rankRangeLowerBound: 1,
        lobbySize: 4,
        rejectionReason: 0,
        isLazer: false,
        ids: MATCH_IDS,
        beatmapIds: [NEW_BEATMAP_ID, KNOWN_BEATMAP_ID],
        ...overrides,
      },
      context: {
        db: client,
        headers: new Headers(),
        session,
        logging: { correlationId: 'submission-test' },
      } as SubmitTournamentHandlerArgs['context'],
      errors: createErrors(),
    });

  const savedMatchIds = async () =>
    (
      await db
        .select({ osuId: schema.matches.osuId })
        .from(schema.matches)
        .where(inArray(schema.matches.osuId, MATCH_IDS))
    ).map((row) => row.osuId);

  beforeAll(async () => {
    userId = await seedAdminUser(db, USER_OSU_ID);
  });

  afterEach(removeSeed);

  afterAll(async () => {
    await removeSeed();
    await removePlayers(db, [USER_OSU_ID]);
    await pool.end();
  });

  describe("an admin's submission", () => {
    beforeAll(() => {
      // The window's clock would fail these on Tuesday mornings.
      process.env.MAINTENANCE_WINDOW_ENABLED = 'false';
    });

    afterAll(() => {
      if (maintenanceWindowEnabled === undefined) {
        Reflect.deleteProperty(process.env, 'MAINTENANCE_WINDOW_ENABLED');
      } else {
        process.env.MAINTENANCE_WINDOW_ENABLED = maintenanceWindowEnabled;
      }
    });

    it('queues new matches, placeholder beatmaps and the forum topic with the tournament', async () => {
      await db.insert(schema.beatmaps).values({
        osuId: KNOWN_BEATMAP_ID,
        ruleset: Ruleset.Osu,
        rankedStatus: 1,
        diffName: 'known',
        totalLength: 1,
        drainLength: 1,
        bpm: 1,
        countCircle: 1,
        countSlider: 1,
        countSpinner: 1,
        cs: 1,
        hp: 1,
        od: 1,
        ar: 1,
        sr: 1,
        dataFetchStatus: DataFetchStatus.Fetched,
      });

      const result = await submit(`${NAME_PREFIX}queues`);

      expect(result).toEqual({
        status: 'created',
        id: (await tournamentIdByName(db, `${NAME_PREFIX}queues`))!,
      });

      const shared = {
        correlationId: 'submission-test',
        tournamentId: result.status === 'created' ? result.id : null,
      };
      expect(await queuedFetches(db, userId)).toEqual([
        expect.objectContaining({
          ...shared,
          payload: { type: 'beatmap', beatmapId: NEW_BEATMAP_ID },
        }),
        expect.objectContaining({
          ...shared,
          payload: { type: 'forumTopic', topicId: TOPIC_ID },
        }),
        expect.objectContaining({
          ...shared,
          payload: { type: 'match', osuMatchId: MATCH_IDS[0], isLazer: false },
        }),
        expect.objectContaining({
          ...shared,
          payload: { type: 'match', osuMatchId: MATCH_IDS[1], isLazer: false },
        }),
      ]);
    });

    it.each([
      [
        'a topic',
        `https://osu.ppy.sh/community/forums/topics/${TOPIC_ID}?n=1`,
        [TOPIC_ID],
      ],
      ['a wiki page', 'https://osu.ppy.sh/wiki/en/Tournaments/TSJ/2026', []],
    ])(
      'queues the forum topic fetch for %s',
      async (_label, forumUrl, expected) => {
        await submit(`${NAME_PREFIX}forum`, {
          forumUrl,
          ids: [MATCH_IDS[0]!],
          beatmapIds: [],
        });

        const topics = (await queuedFetches(db, userId))
          .map((job) => job.payload)
          .filter((payload) => payload.type === 'forumTopic')
          .map((payload) => payload.topicId);
        expect(topics).toEqual(expected);
      }
    );

    it.each(transactionFaults)(
      'keeps neither the tournament nor its fetches when %s',
      async (_label, fault) => {
        const name = `${NAME_PREFIX}rollback`;

        await expect(submit(name, {}, fault(db))).rejects.toThrow(
          'submission failed'
        );

        expect(await tournamentIdByName(db, name)).toBeNull();
        expect(
          await db
            .select({ id: schema.matches.id })
            .from(schema.matches)
            .where(inArray(schema.matches.osuId, MATCH_IDS))
        ).toEqual([]);
        expect(
          await db
            .select({ id: schema.beatmaps.id })
            .from(schema.beatmaps)
            .where(inArray(schema.beatmaps.osuId, [NEW_BEATMAP_ID]))
        ).toEqual([]);
        expect(await queuedFetches(db, userId)).toEqual([]);
      }
    );
  });

  describe("a non-admin's submission", () => {
    const submitAsUser = (name: string) =>
      submit(name, {}, db, userSession(userId));

    it('is held for approval without a tournament, matches, beatmaps or fetches', async () => {
      const name = `${NAME_PREFIX}held`;

      const result = await submitAsUser(name);

      expect(result).toEqual({
        status: 'pending',
        submissionId: expect.any(Number),
      });
      const [held] = await db
        .select()
        .from(schema.tournamentSubmissions)
        .where(
          eq(
            schema.tournamentSubmissions.id,
            result.status === 'pending' ? result.submissionId : 0
          )
        );
      expect(held).toMatchObject({
        status: ApprovalStatus.Pending,
        submittedByUserId: userId,
        name,
        matchIds: MATCH_IDS,
        beatmapIds: [NEW_BEATMAP_ID, KNOWN_BEATMAP_ID],
        tournamentId: null,
      });

      expect(await tournamentIdByName(db, name)).toBeNull();
      expect(await savedMatchIds()).toEqual([]);
      expect(
        await db
          .select({ id: schema.beatmaps.id })
          .from(schema.beatmaps)
          .where(inArray(schema.beatmaps.osuId, [NEW_BEATMAP_ID]))
      ).toEqual([]);
      expect(await queuedFetches(db, userId)).toEqual([]);
    });

    it('is refused while the same submission is still waiting', async () => {
      await submitAsUser(`${NAME_PREFIX}twice`);

      await expect(submitAsUser(`${NAME_PREFIX}twice`)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('waiting for an admin'),
      });
    });

    it('is refused with a rejection reason, which only admins may set', async () => {
      await expect(
        submit(
          `${NAME_PREFIX}rejected`,
          { rejectionReason: 1 },
          db,
          userSession(userId)
        )
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      expect(
        await db
          .select({ id: schema.tournamentSubmissions.id })
          .from(schema.tournamentSubmissions)
          .where(eq(schema.tournamentSubmissions.submittedByUserId, userId))
      ).toEqual([]);
    });
  });

  describe('during the maintenance window', () => {
    isolateMaintenanceWindowEnv();

    afterEach(() => {
      setSystemTime();
    });

    it.each([
      ['accepted', 0],
      ['rejected', 1],
    ])(
      "refuses an admin's %s submission, which skips approval",
      async (_label, rejectionReason) => {
        setSystemTime(new Date('2026-06-02T12:00:00.000Z'));
        const name = `${NAME_PREFIX}window`;

        await expect(submit(name, { rejectionReason })).rejects.toMatchObject({
          status: 503,
          data: { code: 'MAINTENANCE_WINDOW' },
        });

        expect(await tournamentIdByName(db, name)).toBeNull();
        expect(await savedMatchIds()).toEqual([]);
      }
    );

    it("holds a non-admin's submission, which changes no tournament data", async () => {
      setSystemTime(new Date('2026-06-02T12:00:00.000Z'));

      await expect(
        submit(`${NAME_PREFIX}window-user`, {}, db, userSession(userId))
      ).resolves.toMatchObject({ status: 'pending' });
    });
  });
});
