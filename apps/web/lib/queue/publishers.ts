import {
  type QueuePublishOptions,
  type QueuePublisher,
  RabbitMqPublisher,
  QueueConstants,
} from '@otr/core/queues';
import {
  type FetchBeatmapPayload,
  type FetchForumTopicPayload,
  type FetchMatchPayload,
  type FetchOsuMessage,
  type FetchPlayerPayload,
  type ProcessTournamentAutomationCheckMessage,
} from '@otr/core';

// `type` is added by the publisher.
type FetchBeatmapInput = Omit<FetchBeatmapPayload, 'type'>;
type FetchMatchInput = Omit<FetchMatchPayload, 'type'>;
type FetchPlayerInput = Omit<FetchPlayerPayload, 'type'>;
type FetchForumTopicInput = Omit<FetchForumTopicPayload, 'type'>;

export interface QueuePublisherRegistry {
  fetchBeatmap: (
    payload: FetchBeatmapInput,
    options?: QueuePublishOptions
  ) => Promise<FetchOsuMessage>;
  fetchMatch: (
    payload: FetchMatchInput,
    options?: QueuePublishOptions
  ) => Promise<FetchOsuMessage>;
  fetchPlayer: (
    payload: FetchPlayerInput,
    options?: QueuePublishOptions
  ) => Promise<FetchOsuMessage>;
  fetchForumTopic: (
    payload: FetchForumTopicInput,
    options?: QueuePublishOptions
  ) => Promise<FetchOsuMessage>;
  processAutomationCheck: QueuePublisher<ProcessTournamentAutomationCheckMessage>['publish'];
}

let overridePublishers: QueuePublisherRegistry | null = null;
let defaultPublishers: QueuePublisherRegistry | null = null;

const createDefaultPublishers = (): QueuePublisherRegistry => {
  const amqpUrl = process.env.RABBITMQ_AMQP_URL;

  if (!amqpUrl) {
    throw new Error('RABBITMQ_AMQP_URL is not configured');
  }

  const osuPublisher = new RabbitMqPublisher<FetchOsuMessage>({
    url: amqpUrl,
    queue: QueueConstants.osu,
  });

  const automationPublisher =
    new RabbitMqPublisher<ProcessTournamentAutomationCheckMessage>({
      url: amqpUrl,
      queue: QueueConstants.automatedChecks.tournaments,
    });

  return {
    fetchBeatmap: (payload, options) =>
      osuPublisher.publish({ type: 'beatmap', ...payload }, options),
    fetchMatch: (payload, options) =>
      osuPublisher.publish({ type: 'match', ...payload }, options),
    fetchPlayer: (payload, options) =>
      osuPublisher.publish({ type: 'player', ...payload }, options),
    fetchForumTopic: (payload, options) =>
      osuPublisher.publish({ type: 'forumTopic', ...payload }, options),
    processAutomationCheck: (payload, options) =>
      automationPublisher.publish(payload, options),
  };
};

const getQueuePublishers = (): QueuePublisherRegistry => {
  if (overridePublishers) {
    return overridePublishers;
  }

  if (!defaultPublishers) {
    defaultPublishers = createDefaultPublishers();
  }

  return defaultPublishers;
};

export const publishFetchBeatmapMessage = (
  payload: FetchBeatmapInput,
  options?: QueuePublishOptions
) => getQueuePublishers().fetchBeatmap(payload, options);

export const publishFetchMatchMessage = (
  payload: FetchMatchInput,
  options?: QueuePublishOptions
) => getQueuePublishers().fetchMatch(payload, options);

export const publishFetchPlayerMessage = (
  payload: FetchPlayerInput,
  options?: QueuePublishOptions
) => getQueuePublishers().fetchPlayer(payload, options);

export const publishFetchForumTopicMessage = (
  payload: FetchForumTopicInput,
  options?: QueuePublishOptions
) => getQueuePublishers().fetchForumTopic(payload, options);

export const publishProcessTournamentAutomationCheckMessage = (
  payload: { tournamentId: number; overrideVerifiedState: boolean },
  options?: QueuePublishOptions
) => getQueuePublishers().processAutomationCheck(payload, options);

export const setQueuePublishersForTesting = (
  publishers: QueuePublisherRegistry | null
) => {
  overridePublishers = publishers;
};

export const resetQueuePublishersForTesting = () => {
  overridePublishers = null;
};
