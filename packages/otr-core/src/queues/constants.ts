import { MessagePriority } from '../messages/values';

type QueueMap = {
  attributes: {
    beatmaps: 'processing.attributes.beatmaps';
  };
  automatedChecks: {
    tournaments: 'processing.checks.tournaments';
  };
  osu: 'data.osu';
  osuTrack: 'data.osutrack';
  stats: {
    tournaments: 'processing.stats.tournaments';
  };
};

export const QueueConstants: QueueMap = {
  attributes: {
    beatmaps: 'processing.attributes.beatmaps',
  },
  automatedChecks: {
    tournaments: 'processing.checks.tournaments',
  },
  osu: 'data.osu',
  osuTrack: 'data.osutrack',
  stats: {
    tournaments: 'processing.stats.tournaments',
  },
};

export type QueueGroup = keyof QueueMap;
export type QueueName =
  | QueueMap['attributes']['beatmaps']
  | QueueMap['automatedChecks']['tournaments']
  | QueueMap['osu']
  | QueueMap['osuTrack']
  | QueueMap['stats']['tournaments'];

export const QueuePriorityArguments = {
  'x-max-priority': MessagePriority.High,
} as const;

/**
 * Handler-failure policy of the data worker. Only the data worker declares and
 * consumes the derived queues; a message without the attempt header counts as
 * attempt 0, so publishers are unaffected.
 */
export const QueueRetryPolicy = {
  maxAttempts: 5,
  retryDelayMs: 30_000,
  attemptHeader: 'x-otr-attempt',
} as const;

export const retryQueueName = <TQueue extends string>(queue: TQueue) =>
  `${queue}.retry` as const;

export const failedQueueName = <TQueue extends string>(queue: TQueue) =>
  `${queue}.failed` as const;
