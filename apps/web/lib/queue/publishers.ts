import {
  type QueuePublishOptions,
  type QueuePublisher,
  RabbitMqPublisher,
  QueueConstants,
} from '@otr/core/queues';
import { type ProcessTournamentAutomationCheckMessage } from '@otr/core';

export interface QueuePublisherRegistry {
  processAutomationCheck: QueuePublisher<ProcessTournamentAutomationCheckMessage>['publish'];
}

let overridePublishers: QueuePublisherRegistry | null = null;
let defaultPublishers: QueuePublisherRegistry | null = null;

const createDefaultPublishers = (): QueuePublisherRegistry => {
  const amqpUrl = process.env.RABBITMQ_AMQP_URL;

  if (!amqpUrl) {
    throw new Error('RABBITMQ_AMQP_URL is not configured');
  }

  const automationPublisher =
    new RabbitMqPublisher<ProcessTournamentAutomationCheckMessage>({
      url: amqpUrl,
      queue: QueueConstants.automatedChecks.tournaments,
    });

  return {
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
