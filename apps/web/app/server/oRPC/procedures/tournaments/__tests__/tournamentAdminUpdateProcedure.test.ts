import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, inArray, like, sql } from 'drizzle-orm';

import {
  updateTournamentAdminHandler,
  type UpdateTournamentAdminArgs,
} from '../adminProcedures';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { JobQueue } from '@otr/core/jobs';
import {
  GameWarningFlags,
  MatchRejectionReason,
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

  describe.skipIf(!testDatabaseUrl)('ruleset corrections', () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    const NAME = 'tournament-admin-update-ruleset';
    const USER_OSU_ID = 991_152_001;
    const PLAYER_OSU_ID = 991_152_002;
    const MATCH_OSU_ID = 991_152_101;
    const GAME_OSU_IDS = [991_152_201, 991_152_202];
    const FORUM_URL = 'https://osu.ppy.sh/community/forums/topics/991152';
    let userId = 0;
    let tournamentId = 0;

    const removeSeed = async () => {
      await db
        .delete(schema.tournaments)
        .where(like(schema.tournaments.name, `${NAME}%`));
    };

    /** An osu!mania game and an osu! game, with a score each, as a fetch stores them. */
    const seed = async (tournamentRuleset: Ruleset, storedMania: Ruleset) => {
      const [player] = await db
        .insert(schema.players)
        .values({ osuId: PLAYER_OSU_ID })
        .returning({ id: schema.players.id });
      const [tournament] = await db
        .insert(schema.tournaments)
        .values({
          name: NAME,
          abbreviation: baseInput.abbreviation,
          forumUrl: FORUM_URL,
          rankRangeLowerBound: baseInput.rankRangeLowerBound,
          ruleset: tournamentRuleset,
          lobbySize: baseInput.lobbySize,
        })
        .returning({ id: schema.tournaments.id });
      tournamentId = tournament!.id;
      const [match] = await db
        .insert(schema.matches)
        .values({ osuId: MATCH_OSU_ID, tournamentId })
        .returning({ id: schema.matches.id });

      for (const [index, ruleset] of [storedMania, Ruleset.Osu].entries()) {
        const [game] = await db
          .insert(schema.games)
          .values({
            osuId: GAME_OSU_IDS[index]!,
            ruleset,
            scoringType: 3,
            teamType: 2,
            mods: 0,
            matchId: match!.id,
          })
          .returning({ id: schema.games.id });
        await db.insert(schema.gameScores).values({
          rawScore: 100_000,
          placement: 1,
          accuracy: 0.95,
          maxCombo: 100,
          pass: true,
          isPerfectCombo: false,
          legacyPerfect: false,
          grade: 1,
          mods: 0,
          legacyTotalScore: 0,
          team: 1,
          ruleset,
          verificationStatus: VerificationStatus.None,
          rejectionReason: 0,
          gameId: game!.id,
          playerId: player!.id,
        });
      }
    };

    const correctRuleset = (ruleset: Ruleset) =>
      updateTournamentAdminHandler({
        input: {
          ...baseInput,
          id: tournamentId,
          name: NAME,
          forumUrl: FORUM_URL,
          ruleset,
        },
        context: { db, session: createAdminSession(userId) },
      });

    /** Each game's ruleset and its score's, the osu!mania game first. */
    const rulesets = async () => {
      const rows = await db
        .select({
          game: schema.games.ruleset,
          score: schema.gameScores.ruleset,
        })
        .from(schema.games)
        .innerJoin(
          schema.gameScores,
          eq(schema.gameScores.gameId, schema.games.id)
        )
        .where(inArray(schema.games.osuId, GAME_OSU_IDS))
        .orderBy(schema.games.osuId);
      return rows.map((row) => [row.game, row.score]);
    };

    /** The automated checks queued by the admin's edits. */
    const queuedChecks = async () => {
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        SELECT payload, tournament_id
        FROM jobs
        WHERE queue = ${JobQueue.TournamentChecks}
          AND requested_by_user_id = ${userId}`);
      return rows.map((row) => ({
        payload: row.payload,
        tournamentId: Number(row.tournament_id),
      }));
    };

    beforeEach(async () => {
      await removeSeed();
      await removePlayers(db, [PLAYER_OSU_ID]);
      userId ||= await seedAdminUser(db, USER_OSU_ID);
      await deleteJobs(db, userId);
    });

    afterAll(async () => {
      await removeSeed();
      await deleteJobs(db, userId);
      await removePlayers(db, [USER_OSU_ID, PLAYER_OSU_ID]);
      await pool.end();
    });

    it.each([
      [
        'osu!mania (other)',
        Ruleset.ManiaOther,
        Ruleset.ManiaOther,
        Ruleset.Mania4k,
      ],
      ['osu!', Ruleset.Osu, Ruleset.ManiaOther, Ruleset.Mania4k],
      ['catch', Ruleset.Catch, Ruleset.ManiaOther, Ruleset.Mania7k],
      ['4K', Ruleset.Mania4k, Ruleset.Mania4k, Ruleset.Mania7k],
      ['7K', Ruleset.Mania7k, Ruleset.Mania7k, Ruleset.Mania4k],
    ])(
      'moves osu!mania games from %s to the corrected variant',
      async (_label, from, storedMania, to) => {
        await seed(from, storedMania);

        await correctRuleset(to);

        expect(await rulesets()).toEqual([
          [to, to],
          [Ruleset.Osu, Ruleset.Osu],
        ]);
      }
    );

    it('moves osu!mania games to osu!mania (other) when leaving 4K', async () => {
      await seed(Ruleset.Mania4k, Ruleset.Mania4k);

      await correctRuleset(Ruleset.Taiko);

      expect(await rulesets()).toEqual([
        [Ruleset.ManiaOther, Ruleset.ManiaOther],
        [Ruleset.Osu, Ruleset.Osu],
      ]);
    });

    it('queues the automated checks again after a correction', async () => {
      await seed(Ruleset.Osu, Ruleset.ManiaOther);

      await correctRuleset(Ruleset.Mania4k);

      expect(await queuedChecks()).toEqual([
        {
          payload: { tournamentId, overrideVerifiedState: false },
          tournamentId,
        },
      ]);
    });

    it('queues no checks when the ruleset stays the same', async () => {
      await seed(Ruleset.Mania4k, Ruleset.Mania4k);

      await correctRuleset(Ruleset.Mania4k);

      expect(await queuedChecks()).toEqual([]);
    });
  });

  describe.skipIf(!testDatabaseUrl)(
    'verifying with a match with no data',
    () => {
      const { pool, db } = createTestDb(testDatabaseUrl!);
      const NAME = 'tournament-admin-update-no-data';
      const USER_OSU_ID = 991_167_001;
      const MATCH_OSU_IDS = [991_167_101, 991_167_102];
      let userId = 0;
      let tournamentId = 0;
      let fetchedMatchId = 0;
      let noDataMatchId = 0;

      const removeSeed = async () => {
        await db
          .delete(schema.tournaments)
          .where(like(schema.tournaments.name, `${NAME}%`));
      };

      /** A match osu! returned, and one it returned no data for. */
      const seed = async (noData: {
        verificationStatus: VerificationStatus;
        rejectionReason: number;
      }) => {
        const [tournament] = await db
          .insert(schema.tournaments)
          .values({
            name: NAME,
            abbreviation: baseInput.abbreviation,
            forumUrl: 'https://osu.ppy.sh/community/forums/topics/991167',
            rankRangeLowerBound: baseInput.rankRangeLowerBound,
            ruleset: baseInput.ruleset,
            lobbySize: baseInput.lobbySize,
            verificationStatus: VerificationStatus.PreVerified,
          })
          .returning({ id: schema.tournaments.id });
        tournamentId = tournament!.id;

        const [fetched, noDataMatch] = await db
          .insert(schema.matches)
          .values([
            {
              osuId: MATCH_OSU_IDS[0]!,
              tournamentId,
              name: 'TT: (Red) vs (Blue)',
              startTime: '2024-01-01T00:00:00Z',
              endTime: '2024-01-01T02:00:00Z',
              dataFetchStatus: DataFetchStatus.Fetched,
              verificationStatus: VerificationStatus.PreVerified,
            },
            {
              osuId: MATCH_OSU_IDS[1]!,
              tournamentId,
              dataFetchStatus: DataFetchStatus.NotFound,
              ...noData,
            },
          ])
          .returning({ id: schema.matches.id });
        fetchedMatchId = fetched!.id;
        noDataMatchId = noDataMatch!.id;
      };

      const verify = (children: 'set' | 'accept') =>
        updateTournamentAdminHandler({
          input: {
            ...baseInput,
            id: tournamentId,
            name: NAME,
            forumUrl: 'https://osu.ppy.sh/community/forums/topics/991167',
            verificationStatus: VerificationStatus.Verified,
            children,
          },
          context: { db, session: createAdminSession(userId) },
        });

      const matchStatus = async (id: number) => {
        const [row] = await db
          .select({
            verificationStatus: schema.matches.verificationStatus,
            rejectionReason: schema.matches.rejectionReason,
          })
          .from(schema.matches)
          .where(eq(schema.matches.id, id));
        return row;
      };

      beforeEach(async () => {
        await removeSeed();
        userId ||= await seedAdminUser(db, USER_OSU_ID);
      });

      afterAll(async () => {
        await removeSeed();
        await deleteJobs(db, userId);
        await removePlayers(db, [USER_OSU_ID]);
        await pool.end();
      });

      it('verifying every child leaves it rejected, with its reason', async () => {
        await seed({
          verificationStatus: VerificationStatus.Rejected,
          rejectionReason: MatchRejectionReason.NoData,
        });

        await verify('set');

        expect(await matchStatus(fetchedMatchId)).toEqual({
          verificationStatus: VerificationStatus.Verified,
          rejectionReason: 0,
        });
        expect(await matchStatus(noDataMatchId)).toEqual({
          verificationStatus: VerificationStatus.Rejected,
          rejectionReason: MatchRejectionReason.NoData,
        });
      });

      it('accepting pre-statuses leaves it unverified', async () => {
        await seed({
          verificationStatus: VerificationStatus.PreVerified,
          rejectionReason: 0,
        });

        await verify('accept');

        expect(await matchStatus(fetchedMatchId)).toMatchObject({
          verificationStatus: VerificationStatus.Verified,
        });
        expect(await matchStatus(noDataMatchId)).toMatchObject({
          verificationStatus: VerificationStatus.PreVerified,
        });
      });
    }
  );

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

    it('cascade verification with children set does not set submittedByUserId or verifiedByUserId on matches', async () => {
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
        expect('verifiedByUserId' in update).toBe(false);
      }
    });

    it('cascade rejection does not set submittedByUserId or verifiedByUserId on matches', async () => {
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
        expect('verifiedByUserId' in update).toBe(false);
      }
    });
  });
});
