import { describe, expect, it, afterEach } from 'bun:test';
import { ORPCError } from '@orpc/server';

import {
  submitTournamentHandler,
  type SubmitTournamentHandlerArgs,
} from '../tournamentSubmissionProcedure';
import {
  setQueuePublishersForTesting,
  resetQueuePublishersForTesting,
  type QueuePublisherRegistry,
} from '@/lib/queue/publishers';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { MessagePriority } from '@otr/core';

interface BeatmapRecord {
  id: number;
  osuId: number;
  dataFetchStatus: number;
}

class SubmitTournamentTestDb {
  private nextTournamentId = 500;
  private nextBeatmapId = 1_000;
  public readonly beatmapRecords: BeatmapRecord[] = [];

  query = {
    tournaments: {
      findFirst: async () => null,
    },
  } as const;

  async transaction<T>(
    callback: (
      tx: ReturnType<SubmitTournamentTestDb['createTransaction']>
    ) => Promise<T>
  ): Promise<T> {
    const tx = this.createTransaction();
    return callback(tx);
  }

  private createTransaction() {
    return {
      execute: async () => undefined,
      query: this.query,
      insert: (table: unknown) => {
        if (table === schema.tournaments) {
          return {
            values: () => ({
              returning: () => [
                {
                  id: this.nextTournamentId,
                },
              ],
            }),
          };
        }

        if (table === schema.matches) {
          return {
            values: (values: Array<{ osuId: number }>) => {
              values.forEach((value) => {
                this.recordMatch(value.osuId);
              });
              return undefined;
            },
          };
        }

        if (table === schema.beatmaps) {
          return {
            values: (values: Array<{ osuId: number }>) => {
              const inserted = values.map((value) => {
                const record: BeatmapRecord = {
                  id: this.nextBeatmapId++,
                  osuId: value.osuId,
                  dataFetchStatus: 0,
                };
                this.beatmapRecords.push(record);
                return record;
              });

              return {
                onConflictDoNothing: () => ({
                  returning: () =>
                    inserted.map((record) => ({
                      id: record.id,
                      osuId: record.osuId,
                      dataFetchStatus: record.dataFetchStatus,
                    })),
                }),
              };
            },
          };
        }

        if (table === schema.joinPooledBeatmaps) {
          return {
            values: () => ({
              onConflictDoNothing: () => undefined,
            }),
          };
        }

        throw new Error('Unsupported insert target in test transaction');
      },
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === schema.matches) {
              return [];
            }

            if (table === schema.beatmaps) {
              return this.beatmapRecords.map((record) => ({
                id: record.id,
                osuId: record.osuId,
                dataFetchStatus: record.dataFetchStatus,
              }));
            }

            return [];
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => undefined,
        }),
      }),
    };
  }

  private recordMatch(osuId: number) {
    // Matches are recorded implicitly through the queue assertions in the tests.
    void osuId;
  }
}

type TestSession = SubmitTournamentHandlerArgs['context']['session'];

const createSession = (): TestSession => ({
  dbUser: { id: 42 },
});

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
    new ORPCError('INTERNAL_SERVER_ERROR', { message: 'failed' }),
});

const noopPublishers: QueuePublisherRegistry = {
  fetchBeatmap: async ({ beatmapId }) => ({
    type: 'beatmap' as const,
    beatmapId,
    requestedAt: new Date().toISOString(),
    correlationId: 'noop',
    priority: MessagePriority.Normal,
  }),
  fetchMatch: async ({ osuMatchId, isLazer }) => ({
    type: 'match' as const,
    osuMatchId,
    isLazer,
    requestedAt: new Date().toISOString(),
    correlationId: 'noop',
    priority: MessagePriority.Normal,
  }),
  fetchPlayer: async ({ osuPlayerId }) => ({
    type: 'player' as const,
    osuPlayerId,
    requestedAt: new Date().toISOString(),
    correlationId: 'noop',
    priority: MessagePriority.Normal,
  }),
  fetchForumTopic: async ({ topicId }) => ({
    type: 'forumTopic' as const,
    topicId,
    requestedAt: new Date().toISOString(),
    correlationId: 'noop',
    priority: MessagePriority.Normal,
  }),
  processAutomationCheck: async ({ tournamentId, overrideVerifiedState }) => ({
    tournamentId,
    overrideVerifiedState,
    requestedAt: new Date().toISOString(),
    correlationId: 'noop',
    priority: MessagePriority.Normal,
  }),
};

afterEach(() => {
  resetQueuePublishersForTesting();
});

describe('submitTournamentHandler', () => {
  it('queues new matches and beatmaps after a successful submission', async () => {
    const db = new SubmitTournamentTestDb();
    const queuedMatches: Array<{ osuMatchId: number; isLazer: boolean }> = [];
    const queuedBeatmaps: number[] = [];

    setQueuePublishersForTesting({
      ...noopPublishers,
      fetchBeatmap: async ({ beatmapId }) => {
        queuedBeatmaps.push(beatmapId);
        return noopPublishers.fetchBeatmap({ beatmapId });
      },
      fetchMatch: async ({ osuMatchId, isLazer }) => {
        queuedMatches.push({ osuMatchId, isLazer });
        return noopPublishers.fetchMatch({ osuMatchId, isLazer });
      },
    });

    const result = await submitTournamentHandler({
      input: {
        name: 'Test Tournament',
        abbreviation: 'TT',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/123',
        ruleset: 0,
        rankRangeLowerBound: 1,
        lobbySize: 4,
        rejectionReason: 0,
        isLazer: false,
        ids: [101, 202],
        beatmapIds: [303],
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: createSession(),
      },
      errors: createErrors(),
    });

    expect(result.id).toBe(500);
    expect(result.warnings).toBeUndefined();
    expect(queuedMatches).toEqual([
      { osuMatchId: 101, isLazer: false },
      { osuMatchId: 202, isLazer: false },
    ]);
    expect(queuedBeatmaps).toEqual([303]);
  });

  it.each([
    ['https://osu.ppy.sh/community/forums/topics/123?n=1', [123]],
    ['https://osu.ppy.sh/wiki/en/Tournaments/TT/2026', []],
  ])('queues the forum topic fetch for %s', async (forumUrl, expected) => {
    const queuedTopics: number[] = [];

    setQueuePublishersForTesting({
      ...noopPublishers,
      fetchForumTopic: async ({ topicId }) => {
        queuedTopics.push(topicId);
        return noopPublishers.fetchForumTopic({ topicId });
      },
    });

    await submitTournamentHandler({
      input: {
        name: 'Test Tournament',
        abbreviation: 'TT',
        forumUrl,
        ruleset: 0,
        rankRangeLowerBound: 1,
        lobbySize: 4,
        rejectionReason: 0,
        isLazer: false,
        ids: [101],
        beatmapIds: [],
      },
      context: {
        db: new SubmitTournamentTestDb() as unknown as DatabaseClient,
        session: createSession(),
      },
      errors: createErrors(),
    });

    expect(queuedTopics).toEqual(expected);
  });

  it('returns a warning when queue publishing fails', async () => {
    const db = new SubmitTournamentTestDb();
    const error = new Error('queue offline');

    setQueuePublishersForTesting({
      ...noopPublishers,
      fetchBeatmap: async () => {
        throw error;
      },
      fetchMatch: async () => {
        throw error;
      },
    });

    const result = await submitTournamentHandler({
      input: {
        name: 'Test Tournament',
        abbreviation: 'TT',
        forumUrl: 'https://osu.ppy.sh/community/forums/topics/123',
        ruleset: 0,
        rankRangeLowerBound: 1,
        lobbySize: 4,
        rejectionReason: 0,
        isLazer: false,
        ids: [101],
        beatmapIds: [303],
      },
      context: {
        db: db as unknown as DatabaseClient,
        session: createSession(),
      },
      errors: createErrors(),
    });

    expect(result.warnings).toBeDefined();
    expect(result.warnings?.[0]).toContain('contact the o!TR developers');
  });
});
