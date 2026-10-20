import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, like } from 'drizzle-orm';

import {
  updateTournamentAdminHandler,
  type UpdateTournamentAdminArgs,
} from '../adminProcedures';
import * as schema from '@otr/core/db/schema';
import {
  GameWarningFlags,
  MatchWarningFlags,
  Ruleset,
  VerificationStatus,
} from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';

import {
  adminSession as createAdminSession,
  createTestDb,
  deleteJobs,
  queuedFetches,
  removePlayers,
  seedAdminUser,
  testDatabaseUrl,
  transactionFaults,
} from '../../__tests__/test-utils';

type RequireKeys<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>;

type TestTournamentRow = RequireKeys<
  typeof schema.tournaments.$inferSelect,
  'id' | 'verificationStatus' | 'verifiedByUserId' | 'ruleset'
>;

type TestMatchRow = RequireKeys<typeof schema.matches.$inferSelect, 'id'>;

type TestGameRow = RequireKeys<
  typeof schema.games.$inferSelect,
  'id' | 'matchId'
>;

type TestGameScoreRow = RequireKeys<
  typeof schema.gameScores.$inferSelect,
  'id' | 'gameId'
>;

const STORED_FORUM_URL = 'https://osu.ppy.sh/community/forums/topics/1';

class UpdateTournamentTestDb {
  public readonly matches: TestMatchRow[];
  public readonly games: TestGameRow[];
  public readonly gameScores: TestGameScoreRow[];
  public readonly tournamentUpdates: Array<Record<string, unknown>> = [];
  public readonly matchUpdates: Array<Record<string, unknown>> = [];
  public readonly gameUpdates: Array<Record<string, unknown>> = [];
  public readonly gameScoreUpdates: Array<Record<string, unknown>> = [];
  public auditCallCount = 0;

  constructor(
    private readonly existingTournament: TestTournamentRow,
    options: {
      matches?: TestMatchRow[];
      games?: TestGameRow[];
      gameScores?: TestGameScoreRow[];
    } = {}
  ) {
    this.matches = options.matches ?? [];
    this.games = options.games ?? [];
    this.gameScores = options.gameScores ?? [];
  }

  query = {
    tournaments: {
      // Unchanged from baseInput unless a test sets its own.
      findFirst: async () => ({
        forumUrl: STORED_FORUM_URL,
        ...this.existingTournament,
      }),
    },
  } as const;

  async transaction<T>(
    callback: (tx: UpdateTournamentTestTransaction) => Promise<T>
  ): Promise<T> {
    const tx = new UpdateTournamentTestTransaction(this);
    return callback(tx);
  }
}

class UpdateTournamentTestTransaction {
  constructor(private readonly parent: UpdateTournamentTestDb) {}

  async execute(): Promise<void> {
    this.parent.auditCallCount += 1;
  }

  private recordUpdate(table: unknown, values: Record<string, unknown>) {
    if (table === schema.tournaments) {
      this.parent.tournamentUpdates.push(values);
      return;
    }

    if (table === schema.matches) {
      this.parent.matchUpdates.push(values);
      return;
    }

    if (table === schema.games) {
      this.parent.gameUpdates.push(values);
      return;
    }

    if (table === schema.gameScores) {
      this.parent.gameScoreUpdates.push(values);
      return;
    }

    throw new Error('Unsupported update target');
  }

  private rowsFor(table: unknown) {
    if (table === schema.matches) {
      return this.parent.matches;
    }

    if (table === schema.games) {
      return this.parent.games;
    }

    if (table === schema.gameScores) {
      return this.parent.gameScores;
    }

    return [];
  }

  select() {
    return {
      from: (table: unknown) => ({
        where: async () => {
          if (table === schema.matches) {
            return this.parent.matches;
          }

          if (table === schema.games) {
            return this.parent.games;
          }

          if (table === schema.gameScores) {
            return this.parent.gameScores;
          }

          return [];
        },
      }),
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => {
          this.recordUpdate(table, values);

          const rows = this.rowsFor(table);

          return {
            returning: async () => rows.map((row) => ({ ...row })),
          };
        },
      }),
    };
  }
}

describe('updateTournamentAdminHandler', () => {
  const baseInput: UpdateTournamentAdminArgs['input'] = {
    id: 1,
    name: 'Test Tournament',
    abbreviation: 'TT',
    forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
    rankRangeLowerBound: 1,
    ruleset: Ruleset.Mania4k,
    lobbySize: 2,
    verificationStatus: VerificationStatus.None,
    rejectionReason: 0,
    startTime: null,
    endTime: null,
  };

  const adminSession: NonNullable<
    UpdateTournamentAdminArgs['context']['session']
  > = {
    dbUser: {
      id: 99,
      scopes: ['admin'],
    },
  };

  const createContext = (
    existingRuleset: Ruleset,
    nextRuleset: Ruleset
  ): UpdateTournamentAdminArgs => {
    const db = new UpdateTournamentTestDb(
      {
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: existingRuleset,
      },
      {
        matches: [{ id: 10 }],
        games: [{ id: 20, matchId: 10 }],
      }
    );

    return {
      input: { ...baseInput, ruleset: nextRuleset },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    };
  };

  it('propagates mania variants to games and scores when switching from mania other', async () => {
    const args = createContext(Ruleset.ManiaOther, Ruleset.Mania7k);
    const db = args.context.db as unknown as UpdateTournamentTestDb;

    const result = await updateTournamentAdminHandler(args);

    expect(result.success).toBe(true);
    expect(db.gameUpdates).toHaveLength(1);
    expect(db.gameUpdates[0]).toEqual(
      expect.objectContaining({
        ruleset: Ruleset.Mania7k,
      })
    );
    expect(db.gameScoreUpdates).toHaveLength(1);
    expect(db.gameScoreUpdates[0]).toEqual(
      expect.objectContaining({ ruleset: Ruleset.Mania7k })
    );
  });

  it('does not propagate when the original ruleset is not mania other', async () => {
    const args = createContext(Ruleset.Mania4k, Ruleset.Mania7k);
    const db = args.context.db as unknown as UpdateTournamentTestDb;

    const result = await updateTournamentAdminHandler(args);

    expect(result.success).toBe(true);
    expect(db.gameUpdates).toHaveLength(0);
    expect(db.gameScoreUpdates).toHaveLength(0);
  });

  it('clears warnings when the tournament is verified and children are set', async () => {
    const db = new UpdateTournamentTestDb(
      {
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: Ruleset.Mania4k,
      },
      {
        matches: [
          { id: 10, warningFlags: MatchWarningFlags.UnexpectedBeatmapsFound },
        ],
        games: [
          {
            id: 20,
            matchId: 10,
            warningFlags: GameWarningFlags.BeatmapUsedOnce,
          },
        ],
      }
    );

    const args: UpdateTournamentAdminArgs = {
      input: {
        ...baseInput,
        verificationStatus: VerificationStatus.Verified,
        children: 'set',
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    };

    const result = await updateTournamentAdminHandler(args);

    expect(result.success).toBe(true);
    expect(db.matchUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          warningFlags: MatchWarningFlags.None,
        }),
      ])
    );
    expect(db.gameUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          warningFlags: GameWarningFlags.None,
        }),
      ])
    );
  });

  it('clears warnings when the tournament is rejected', async () => {
    const db = new UpdateTournamentTestDb(
      {
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: Ruleset.Mania4k,
      },
      {
        matches: [
          {
            id: 10,
            warningFlags: MatchWarningFlags.LowGameCount,
            verificationStatus: VerificationStatus.Verified,
          },
        ],
        games: [
          {
            id: 20,
            matchId: 10,
            warningFlags: GameWarningFlags.BeatmapUsedOnce,
            verificationStatus: VerificationStatus.Verified,
          },
        ],
        gameScores: [{ id: 30, gameId: 20 }],
      }
    );

    const args: UpdateTournamentAdminArgs = {
      input: {
        ...baseInput,
        verificationStatus: VerificationStatus.Rejected,
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    };

    const result = await updateTournamentAdminHandler(args);

    expect(result.success).toBe(true);
    expect(db.matchUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          warningFlags: MatchWarningFlags.None,
          verificationStatus: VerificationStatus.Rejected,
        }),
      ])
    );
    expect(db.gameUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          warningFlags: GameWarningFlags.None,
          verificationStatus: VerificationStatus.Rejected,
        }),
      ])
    );
  });

  it('leaves children alone when verified without a choice', async () => {
    const db = new UpdateTournamentTestDb(
      {
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: Ruleset.Mania4k,
      },
      {
        matches: [{ id: 10 }],
        games: [{ id: 20, matchId: 10 }],
        gameScores: [{ id: 30, gameId: 20 }],
      }
    );

    await updateTournamentAdminHandler({
      input: { ...baseInput, verificationStatus: VerificationStatus.Verified },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    expect(db.matchUpdates).toHaveLength(0);
    expect(db.gameUpdates).toHaveLength(0);
    expect(db.gameScoreUpdates).toHaveLength(0);
  });

  it('resolves pre-statuses when verified with the accept choice', async () => {
    const db = new UpdateTournamentTestDb(
      {
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: Ruleset.Mania4k,
      },
      {
        matches: [{ id: 10, verificationStatus: VerificationStatus.None }],
        games: [
          { id: 20, matchId: 10, verificationStatus: VerificationStatus.None },
        ],
        gameScores: [{ id: 30, gameId: 20 }],
      }
    );

    await updateTournamentAdminHandler({
      input: {
        ...baseInput,
        verificationStatus: VerificationStatus.Verified,
        children: 'accept',
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: adminSession,
      },
    });

    expect(db.matchUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          verificationStatus: VerificationStatus.Verified,
          verifiedByUserId: 99,
        }),
        expect.objectContaining({
          verificationStatus: VerificationStatus.Rejected,
        }),
      ])
    );
    expect(db.gameScoreUpdates.length).toBeGreaterThan(0);
  });

  describe.skipIf(!testDatabaseUrl)('forum URL edits', () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    const NAME = 'tournament-admin-update-forum-jobs';
    const USER_OSU_ID = 991_201_600;
    const STORED_TOPIC_ID = 991_201_601;
    const NEW_TOPIC_ID = 991_201_602;
    const storedUrl = `https://osu.ppy.sh/community/forums/topics/${STORED_TOPIC_ID}`;
    let userId = 0;
    let tournamentId = 0;
    let forumPostId = 0;

    const removeSeed = async () => {
      if (userId) {
        await deleteJobs(db, userId);
      }
      await db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${NAME}%`));
      await db
        .delete(schema.tournamentForumPosts)
        .where(eq(schema.tournamentForumPosts.topicId, STORED_TOPIC_ID));
    };

    beforeEach(async () => {
      await removeSeed();
      userId ||= await seedAdminUser(db, USER_OSU_ID);

      const [post] = await db
        .insert(schema.tournamentForumPosts)
        .values({
          topicId: STORED_TOPIC_ID,
          postId: STORED_TOPIC_ID,
          title: NAME,
          bbcode: '',
          fetched: new Date().toISOString(),
        })
        .returning({ id: schema.tournamentForumPosts.id });
      forumPostId = post!.id;

      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: NAME,
          abbreviation: baseInput.abbreviation,
          forumUrl: storedUrl,
          forumPostId,
          rankRangeLowerBound: baseInput.rankRangeLowerBound,
          ruleset: baseInput.ruleset,
          lobbySize: baseInput.lobbySize,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;
    });

    afterAll(async () => {
      await removeSeed();
      await removePlayers(db, [USER_OSU_ID]);
      await pool.end();
    });

    const update = (forumUrl: string, client: DatabaseClient = db) =>
      updateTournamentAdminHandler({
        input: { ...baseInput, id: tournamentId, name: NAME, forumUrl },
        context: { db: client, session: createAdminSession(userId) },
      });

    const storedForumPostId = async () => {
      const [row] = await db
        .select({ forumPostId: schema.tournaments.forumPostId })
        .from(schema.tournaments)
        .where(eq(schema.tournaments.id, tournamentId));
      return row!.forumPostId;
    };

    it.each([
      [
        'another topic',
        `https://osu.ppy.sh/community/forums/topics/${NEW_TOPIC_ID}`,
        true,
        [NEW_TOPIC_ID],
      ],
      [
        'a wiki page',
        'https://osu.ppy.sh/wiki/en/Tournaments/TT/2026',
        true,
        [],
      ],
      ['the same URL', storedUrl, false, []],
    ])(
      'moving to %s unlinks the post: %p, queues topics: %p',
      async (_label, forumUrl, unlinks, expectedTopics) => {
        await update(forumUrl);

        expect(await storedForumPostId()).toBe(unlinks ? null : forumPostId);
        expect(await queuedFetches(db, userId)).toEqual(
          expectedTopics.map((topicId) =>
            expect.objectContaining({
              payload: { type: 'forumTopic', topicId },
              tournamentId,
            })
          )
        );
      }
    );

    it.each(transactionFaults)(
      'keeps the old URL and queues nothing when %s',
      async (_label, fault, message) => {
        await expect(
          update(
            `https://osu.ppy.sh/community/forums/topics/${NEW_TOPIC_ID}`,
            fault(db)
          )
        ).rejects.toThrow(message);

        const [row] = await db
          .select({
            forumUrl: schema.tournaments.forumUrl,
            forumPostId: schema.tournaments.forumPostId,
          })
          .from(schema.tournaments)
          .where(eq(schema.tournaments.id, tournamentId));
        expect(row).toEqual({ forumUrl: storedUrl, forumPostId });
        expect(await queuedFetches(db, userId)).toEqual([]);
      }
    );
  });

  describe('submittedByUserId and verifiedByUserId', () => {
    it('preserves verifiedByUserId when status unchanged', async () => {
      const db = new UpdateTournamentTestDb({
        id: 1,
        verificationStatus: VerificationStatus.Verified,
        verifiedByUserId: 55,
        ruleset: Ruleset.Mania4k,
      });

      await updateTournamentAdminHandler({
        input: {
          ...baseInput,
          verificationStatus: VerificationStatus.Verified,
        },
        context: {
          db: db as unknown as DatabaseClient,
          session: adminSession,
        },
      });

      expect(db.tournamentUpdates[0].verifiedByUserId).toBe(55);
    });

    it('sets verifiedByUserId to admin on Verified', async () => {
      const db = new UpdateTournamentTestDb({
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: Ruleset.Mania4k,
      });

      await updateTournamentAdminHandler({
        input: {
          ...baseInput,
          verificationStatus: VerificationStatus.Verified,
        },
        context: {
          db: db as unknown as DatabaseClient,
          session: adminSession,
        },
      });

      expect(db.tournamentUpdates[0].verifiedByUserId).toBe(99);
    });

    it('sets verifiedByUserId to admin on Rejected', async () => {
      const db = new UpdateTournamentTestDb({
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: Ruleset.Mania4k,
      });

      await updateTournamentAdminHandler({
        input: {
          ...baseInput,
          verificationStatus: VerificationStatus.Rejected,
        },
        context: {
          db: db as unknown as DatabaseClient,
          session: adminSession,
        },
      });

      expect(db.tournamentUpdates[0].verifiedByUserId).toBe(99);
    });

    it('clears verifiedByUserId when status reverts to None', async () => {
      const db = new UpdateTournamentTestDb({
        id: 1,
        verificationStatus: VerificationStatus.Verified,
        verifiedByUserId: 55,
        ruleset: Ruleset.Mania4k,
      });

      await updateTournamentAdminHandler({
        input: {
          ...baseInput,
          verificationStatus: VerificationStatus.None,
        },
        context: {
          db: db as unknown as DatabaseClient,
          session: adminSession,
        },
      });

      expect(db.tournamentUpdates[0].verifiedByUserId).toBeNull();
    });

    it('only includes expected keys in .set()', async () => {
      const db = new UpdateTournamentTestDb({
        id: 1,
        verificationStatus: VerificationStatus.None,
        verifiedByUserId: null,
        ruleset: Ruleset.Mania4k,
      });

      await updateTournamentAdminHandler({
        input: baseInput,
        context: {
          db: db as unknown as DatabaseClient,
          session: adminSession,
        },
      });

      const expectedKeys = new Set([
        'name',
        'abbreviation',
        'forumUrl',
        'rankRangeLowerBound',
        'ruleset',
        'lobbySize',
        'verificationStatus',
        'rejectionReason',
        'startTime',
        'endTime',
        'verifiedByUserId',
        'updated',
      ]);

      expect(new Set(Object.keys(db.tournamentUpdates[0]))).toEqual(
        expectedKeys
      );
    });

    it('cascade verification with children set credits a reviewer on matches but no submitter', async () => {
      const db = new UpdateTournamentTestDb(
        {
          id: 1,
          verificationStatus: VerificationStatus.None,
          verifiedByUserId: null,
          ruleset: Ruleset.Mania4k,
        },
        {
          matches: [{ id: 10 }],
          games: [{ id: 20, matchId: 10 }],
        }
      );

      await updateTournamentAdminHandler({
        input: {
          ...baseInput,
          verificationStatus: VerificationStatus.Verified,
          children: 'set',
        },
        context: {
          db: db as unknown as DatabaseClient,
          session: adminSession,
        },
      });

      expect(db.matchUpdates.length).toBeGreaterThan(0);
      for (const update of db.matchUpdates) {
        expect('submittedByUserId' in update).toBe(false);
        expect('verifiedByUserId' in update).toBe(true);
      }
    });

    it('cascade rejection credits a reviewer on matches but no submitter', async () => {
      const db = new UpdateTournamentTestDb(
        {
          id: 1,
          verificationStatus: VerificationStatus.None,
          verifiedByUserId: null,
          ruleset: Ruleset.Mania4k,
        },
        {
          matches: [{ id: 10 }],
          games: [{ id: 20, matchId: 10 }],
        }
      );

      await updateTournamentAdminHandler({
        input: {
          ...baseInput,
          verificationStatus: VerificationStatus.Rejected,
        },
        context: {
          db: db as unknown as DatabaseClient,
          session: adminSession,
        },
      });

      expect(db.matchUpdates.length).toBeGreaterThan(0);
      for (const update of db.matchUpdates) {
        expect('submittedByUserId' in update).toBe(false);
        expect('verifiedByUserId' in update).toBe(true);
      }
    });
  });
});
