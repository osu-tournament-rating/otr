import { afterEach, describe, expect, it } from 'bun:test';

import {
  AUTOMATION_QUEUE_WARNING,
  resetTournamentAutomatedChecksHandler,
  type ResetAutomatedChecksArgs,
} from '../adminProcedures';
import {
  resetQueuePublishersForTesting,
  setQueuePublishersForTesting,
} from '@/lib/queue/publishers';
import type { DatabaseClient } from '@/lib/db';
import { MessagePriority } from '@otr/core';

const createAdminSession = (): NonNullable<
  ResetAutomatedChecksArgs['context']['session']
> => ({
  dbUser: {
    id: 1,
    scopes: ['admin'],
  },
});

afterEach(() => {
  resetQueuePublishersForTesting();
});

describe('resetTournamentAutomatedChecksHandler', () => {
  it('enqueues the automated checks message', async () => {
    const published: Array<{
      tournamentId: number;
      overrideVerifiedState: boolean;
    }> = [];

    setQueuePublishersForTesting({
      fetchBeatmap: async ({ beatmapId }) => ({
        type: 'beatmap' as const,
        beatmapId,
        requestedAt: new Date().toISOString(),
        correlationId: 'noop',
        priority: MessagePriority.Normal,
      }),
      fetchMatch: async ({ osuMatchId }) => ({
        type: 'match' as const,
        osuMatchId,
        isLazer: false,
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
      processAutomationCheck: async ({
        tournamentId,
        overrideVerifiedState,
      }) => {
        published.push({ tournamentId, overrideVerifiedState });
        return {
          tournamentId,
          overrideVerifiedState,
          requestedAt: new Date().toISOString(),
          correlationId: 'test',
          priority: MessagePriority.Normal,
        };
      },
    });

    const result = await resetTournamentAutomatedChecksHandler({
      input: { id: 42, overrideVerifiedState: true },
      context: {
        db: null as unknown as DatabaseClient,
        session: createAdminSession(),
      },
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
    expect(published).toEqual([
      { tournamentId: 42, overrideVerifiedState: true },
    ]);
  });

  it('returns warnings when publishing fails', async () => {
    setQueuePublishersForTesting({
      fetchBeatmap: async ({ beatmapId }) => ({
        type: 'beatmap' as const,
        beatmapId,
        requestedAt: new Date().toISOString(),
        correlationId: 'noop',
        priority: MessagePriority.Normal,
      }),
      fetchMatch: async ({ osuMatchId }) => ({
        type: 'match' as const,
        osuMatchId,
        isLazer: false,
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
      processAutomationCheck: async () => {
        throw new Error('automation queue offline');
      },
    });

    const result = await resetTournamentAutomatedChecksHandler({
      input: { id: 42, overrideVerifiedState: false },
      context: {
        db: null as unknown as DatabaseClient,
        session: createAdminSession(),
      },
    });

    expect(result.warnings).toEqual([AUTOMATION_QUEUE_WARNING]);
  });
});
