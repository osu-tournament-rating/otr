import { afterEach, describe, expect, it } from 'bun:test';

import {
  REFETCH_QUEUE_WARNING,
  refetchTournamentMatchDataHandler,
  type RefetchMatchDataArgs,
} from '../adminProcedures';
import {
  resetQueuePublishersForTesting,
  setQueuePublishersForTesting,
  type QueuePublisherRegistry,
} from '@/lib/queue/publishers';
import type { DatabaseClient } from '@/lib/db';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { MessagePriority } from '@otr/core';

interface MatchRow {
  id: number;
  tournamentId: number;
  osuId: number;
  dataFetchStatus: number;
  isLazer: boolean;
}

const extractNumbers = (condition: unknown): number[] => {
  if (
    !condition ||
    typeof condition !== 'object' ||
    !('queryChunks' in condition) ||
    !Array.isArray((condition as { queryChunks: unknown[] }).queryChunks)
  ) {
    return [];
  }

  const numbers: number[] = [];

  for (const chunk of (condition as { queryChunks: unknown[] }).queryChunks) {
    const value = (chunk as { value?: unknown }).value;

    if (typeof value === 'number') {
      numbers.push(value);
      continue;
    }

    if (Array.isArray(chunk)) {
      for (const item of chunk) {
        if (typeof item === 'number') {
          numbers.push(item);
        } else if (
          item &&
          typeof (item as { value?: unknown }).value === 'number'
        ) {
          numbers.push((item as { value: number }).value);
        }
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'number') {
          numbers.push(entry);
        }
      }
    }

    if (chunk && typeof chunk === 'object') {
      for (const entry of Object.values(chunk as Record<string, unknown>)) {
        if (typeof entry === 'number') {
          numbers.push(entry);
        } else if (
          entry &&
          typeof (entry as { value?: unknown }).value === 'number'
        ) {
          numbers.push((entry as { value: number }).value);
        }
      }
    }
  }

  return numbers;
};

class RefetchMatchDataTestDb {
  public matches: MatchRow[];

  constructor(options: { matches: MatchRow[] }) {
    this.matches = options.matches.map((row) => ({ ...row }));
  }

  async transaction<T>(
    callback: (
      tx: ReturnType<RefetchMatchDataTestDb['createTransaction']>
    ) => Promise<T>
  ): Promise<T> {
    const tx = this.createTransaction();
    return callback(tx);
  }

  private createTransaction() {
    return {
      execute: async () => undefined,
      update: (table: unknown) => this.update(table),
    };
  }

  update(table: unknown) {
    if (table === schema.matches) {
      return {
        set: (values: Partial<MatchRow>) => ({
          where: (condition: unknown) => ({
            returning: () => {
              const [tournamentId] = extractNumbers(condition);
              return this.matches
                .filter((match) => match.tournamentId === tournamentId)
                .map((match) => {
                  if (typeof values.dataFetchStatus === 'number') {
                    match.dataFetchStatus = values.dataFetchStatus;
                  }
                  return {
                    id: match.id,
                    osuId: match.osuId,
                    isLazer: match.isLazer,
                  };
                });
            },
          }),
        }),
      };
    }

    throw new Error('Unsupported update table in test');
  }
}

type TestContext = RefetchMatchDataArgs['context'];

const createAdminSession = (): NonNullable<TestContext['session']> => ({
  dbUser: {
    id: 1,
    scopes: ['admin'],
  },
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

describe('refetchTournamentMatchDataHandler', () => {
  it('queues a fetch for every match in the tournament', async () => {
    const db = new RefetchMatchDataTestDb({
      matches: [
        {
          id: 1,
          tournamentId: 100,
          osuId: 123,
          dataFetchStatus: DataFetchStatus.Fetched,
          isLazer: false,
        },
        {
          id: 2,
          tournamentId: 100,
          osuId: 456,
          dataFetchStatus: DataFetchStatus.Fetched,
          isLazer: true,
        },
        {
          id: 3,
          tournamentId: 200,
          osuId: 789,
          dataFetchStatus: DataFetchStatus.Fetched,
          isLazer: false,
        },
      ],
    });

    const queuedMatches: Array<{ osuMatchId: number; isLazer: boolean }> = [];

    setQueuePublishersForTesting({
      fetchBeatmap: noopPublishers.fetchBeatmap,
      fetchMatch: async ({ osuMatchId, isLazer }) => {
        queuedMatches.push({ osuMatchId, isLazer });
        return noopPublishers.fetchMatch({ osuMatchId, isLazer });
      },
      fetchPlayer: noopPublishers.fetchPlayer,
      processAutomationCheck: noopPublishers.processAutomationCheck,
    });

    const result = await refetchTournamentMatchDataHandler({
      input: { id: 100 },
      context: {
        db: db as unknown as DatabaseClient,
        session: createAdminSession(),
      },
    });

    expect(result.matchesUpdated).toBe(2);
    expect(result.warnings).toBeUndefined();
    expect(queuedMatches).toEqual([
      { osuMatchId: 123, isLazer: false },
      { osuMatchId: 456, isLazer: true },
    ]);
  });

  it('returns warnings when publishing fails', async () => {
    const db = new RefetchMatchDataTestDb({
      matches: [
        {
          id: 1,
          tournamentId: 100,
          osuId: 123,
          dataFetchStatus: DataFetchStatus.Fetched,
          isLazer: false,
        },
      ],
    });

    setQueuePublishersForTesting({
      fetchBeatmap: noopPublishers.fetchBeatmap,
      fetchMatch: async () => {
        throw new Error('match queue offline');
      },
      fetchPlayer: noopPublishers.fetchPlayer,
      processAutomationCheck: noopPublishers.processAutomationCheck,
    });

    const result = await refetchTournamentMatchDataHandler({
      input: { id: 100 },
      context: {
        db: db as unknown as DatabaseClient,
        session: createAdminSession(),
      },
    });

    expect(result.warnings).toEqual([REFETCH_QUEUE_WARNING]);
  });
});
