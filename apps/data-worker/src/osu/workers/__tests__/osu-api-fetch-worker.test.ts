import { describe, expect, it, mock } from 'bun:test';
import type { FetchOsuMessage, OsuApiPayload } from '@otr/core';
import { MessagePriority } from '@otr/core';
import { OsuApiFetchWorker } from '../osu-api-fetch-worker';
import type { Logger } from '../../../logging/logger';
import type { QueueConsumer, QueueMessage } from '@otr/core/queues';

const createMockLogger = (): Logger => ({
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  child: mock(() => createMockLogger()),
});

const createMockMessage = (
  payload: OsuApiPayload,
  correlationId = 'test-correlation-id'
): QueueMessage<FetchOsuMessage> => {
  const metadata = {
    requestedAt: new Date().toISOString(),
    correlationId,
    priority: MessagePriority.Normal,
  };
  return {
    metadata,
    payload: { ...metadata, ...payload },
    ack: mock(() => Promise.resolve()),
    nack: mock(() => Promise.resolve()),
  };
};

const createMockConsumer = (): QueueConsumer<FetchOsuMessage> & {
  emit: (message: QueueMessage<FetchOsuMessage>) => Promise<void>;
} => {
  let handler:
    ((message: QueueMessage<FetchOsuMessage>) => Promise<void>) | null = null;

  return {
    start: mock(async (h) => {
      handler = h;
    }),
    stop: mock(async () => {
      handler = null;
    }),
    emit: async (message) => {
      if (!handler) throw new Error('Consumer not started');
      await handler(message);
    },
  };
};

describe('OsuApiFetchWorker', () => {
  describe('beatmap messages', () => {
    it('routes beatmap fetch messages to beatmapService', async () => {
      const consumer = createMockConsumer();
      const logger = createMockLogger();
      const fetchAndPersistBeatmap = mock(() => Promise.resolve(true));
      const fetchAndPersistMatch = mock(() => Promise.resolve(true));
      const fetchAndPersistPlayer = mock(() => Promise.resolve(true));

      const worker = new OsuApiFetchWorker({
        queue: consumer,
        beatmapService: { fetchAndPersist: fetchAndPersistBeatmap },
        matchService: { fetchAndPersist: fetchAndPersistMatch },
        playerService: { fetchAndPersist: fetchAndPersistPlayer },
        forumTopicService: {
          fetchAndPersist: mock(() => Promise.resolve(true)),
        },
        logger,
        maintenanceWindowEnabled: false,
      });

      await worker.start();

      const message = createMockMessage({ type: 'beatmap', beatmapId: 123 });
      await consumer.emit(message);

      expect(fetchAndPersistBeatmap).toHaveBeenCalledWith(123, {
        skipAutomationChecks: undefined,
      });
      expect(message.ack).toHaveBeenCalled();
      expect(message.nack).not.toHaveBeenCalled();
    });

    it('passes skipAutomationChecks option', async () => {
      const consumer = createMockConsumer();
      const logger = createMockLogger();
      const fetchAndPersistBeatmap = mock(() => Promise.resolve(true));

      const worker = new OsuApiFetchWorker({
        queue: consumer,
        beatmapService: { fetchAndPersist: fetchAndPersistBeatmap },
        matchService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        playerService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        forumTopicService: {
          fetchAndPersist: mock(() => Promise.resolve(true)),
        },
        logger,
        maintenanceWindowEnabled: false,
      });

      await worker.start();

      const message = createMockMessage({
        type: 'beatmap',
        beatmapId: 456,
        skipAutomationChecks: true,
      });
      await consumer.emit(message);

      expect(fetchAndPersistBeatmap).toHaveBeenCalledWith(456, {
        skipAutomationChecks: true,
      });
    });
  });

  describe('match messages', () => {
    it('routes match fetch messages to matchService', async () => {
      const consumer = createMockConsumer();
      const logger = createMockLogger();
      const fetchAndPersistMatch = mock(() => Promise.resolve(true));

      const worker = new OsuApiFetchWorker({
        queue: consumer,
        beatmapService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        matchService: { fetchAndPersist: fetchAndPersistMatch },
        playerService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        forumTopicService: {
          fetchAndPersist: mock(() => Promise.resolve(true)),
        },
        logger,
        maintenanceWindowEnabled: false,
      });

      await worker.start();

      const message = createMockMessage({
        type: 'match',
        osuMatchId: 789,
        isLazer: true,
      });
      await consumer.emit(message);

      expect(fetchAndPersistMatch).toHaveBeenCalledWith(789, true);
      expect(message.ack).toHaveBeenCalled();
    });
  });

  describe('player messages', () => {
    it('routes player fetch messages to playerService', async () => {
      const consumer = createMockConsumer();
      const logger = createMockLogger();
      const fetchAndPersistPlayer = mock(() => Promise.resolve(true));

      const worker = new OsuApiFetchWorker({
        queue: consumer,
        beatmapService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        matchService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        playerService: { fetchAndPersist: fetchAndPersistPlayer },
        forumTopicService: {
          fetchAndPersist: mock(() => Promise.resolve(true)),
        },
        logger,
        maintenanceWindowEnabled: false,
      });

      await worker.start();

      const message = createMockMessage({ type: 'player', osuPlayerId: 12345 });
      await consumer.emit(message);

      expect(fetchAndPersistPlayer).toHaveBeenCalledWith(12345);
      expect(message.ack).toHaveBeenCalled();
    });
  });

  describe('forum topic messages', () => {
    it('routes forum topic fetches with the request time', async () => {
      const consumer = createMockConsumer();
      const logger = createMockLogger();
      const fetchAndPersistForumTopic = mock(() => Promise.resolve(true));

      const worker = new OsuApiFetchWorker({
        queue: consumer,
        beatmapService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        matchService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        playerService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        forumTopicService: { fetchAndPersist: fetchAndPersistForumTopic },
        logger,
        maintenanceWindowEnabled: false,
      });

      await worker.start();

      const message = createMockMessage({
        type: 'forumTopic',
        topicId: 2212242,
      });
      await consumer.emit(message);

      expect(fetchAndPersistForumTopic).toHaveBeenCalledWith(
        2212242,
        message.metadata.requestedAt
      );
      expect(message.ack).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('leaves a service error to the consumer retry policy', async () => {
      const consumer = createMockConsumer();
      const logger = createMockLogger();
      const fetchAndPersistBeatmap = mock(() =>
        Promise.reject(new Error('API error'))
      );

      const worker = new OsuApiFetchWorker({
        queue: consumer,
        beatmapService: { fetchAndPersist: fetchAndPersistBeatmap },
        matchService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        playerService: { fetchAndPersist: mock(() => Promise.resolve(true)) },
        forumTopicService: {
          fetchAndPersist: mock(() => Promise.resolve(true)),
        },
        logger,
        maintenanceWindowEnabled: false,
      });

      await worker.start();

      const message = createMockMessage({ type: 'beatmap', beatmapId: 999 });
      await expect(consumer.emit(message)).rejects.toThrow('API error');

      expect(message.nack).not.toHaveBeenCalled();
      expect(message.ack).not.toHaveBeenCalled();
    });
  });
});
