import { connect } from 'amqplib';
import { sql } from 'drizzle-orm';
import {
  enqueueJob,
  jobDedupKeys,
  JobQueue,
  JobStatus,
  type EnqueueJob,
} from '@otr/core/jobs';
import { failedQueueName } from '@otr/core/queues';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';
import { rabbitMqBridged } from '../metrics';
import { RabbitMqConsumer } from '../queue/rabbitmq-consumer';

export interface BridgedQueue<Q extends JobQueue> {
  queue: Q;
  /** The job for a message's envelope, or null to drop a message that has none. */
  toJob: (envelope: Record<string, unknown>) => EnqueueJob<Q> | null;
}

interface RabbitMqBridgeOptions {
  url: string;
  db: Pick<DatabaseClient, 'execute'>;
  logger: Logger;
  queues: ReadonlyArray<BridgedQueue<JobQueue>>;
}

// Every message carried `{ requestedAt, correlationId, priority }` beside its payload.
const messageMetadata = (envelope: Record<string, unknown>) => ({
  priority:
    typeof envelope.priority === 'number' ? envelope.priority : undefined,
  correlationId:
    typeof envelope.correlationId === 'string'
      ? envelope.correlationId
      : undefined,
});

const positiveId = (value: unknown) =>
  Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

/**
 * The job for a tournament stats message the processor used to publish:
 * `{ requestedAt, correlationId, priority, tournamentId }`.
 */
export const tournamentStatsJobFromMessage = (
  envelope: Record<string, unknown>
): EnqueueJob<JobQueue.TournamentStats> | null => {
  const tournamentId = Number(envelope.tournamentId);
  if (!Number.isInteger(tournamentId)) {
    return null;
  }

  return {
    payload: { tournamentId },
    ...messageMetadata(envelope),
    tournamentId,
  };
};

/** The job for an osu! fetch message the site or worker used to publish. */
export const osuFetchJobFromMessage = (
  envelope: Record<string, unknown>
): EnqueueJob<JobQueue.OsuFetch> | null => {
  const metadata = messageMetadata(envelope);

  switch (envelope.type) {
    case 'match': {
      const osuMatchId = positiveId(envelope.osuMatchId);
      return osuMatchId === null
        ? null
        : {
            payload: {
              type: 'match',
              osuMatchId,
              isLazer: envelope.isLazer === true,
            },
            ...metadata,
          };
    }
    case 'beatmap': {
      const beatmapId = positiveId(envelope.beatmapId);
      return beatmapId === null
        ? null
        : {
            payload: {
              type: 'beatmap',
              beatmapId,
              ...(envelope.skipAutomationChecks === true
                ? { skipAutomationChecks: true }
                : {}),
            },
            ...metadata,
          };
    }
    case 'player': {
      const osuPlayerId = positiveId(envelope.osuPlayerId);
      return osuPlayerId === null
        ? null
        : { payload: { type: 'player', osuPlayerId }, ...metadata };
    }
    case 'forumTopic': {
      const topicId = positiveId(envelope.topicId);
      return topicId === null
        ? null
        : { payload: { type: 'forumTopic', topicId }, ...metadata };
    }
    default:
      return null;
  }
};

/**
 * The job for an osu!track fetch message the worker's refetch scheduler used
 * to publish: `{ requestedAt, correlationId, priority, osuPlayerId }`.
 */
export const osuTrackJobFromMessage = (
  envelope: Record<string, unknown>
): EnqueueJob<JobQueue.OsuTrackFetch> | null => {
  const osuPlayerId = positiveId(envelope.osuPlayerId);
  return osuPlayerId === null
    ? null
    : { payload: { osuPlayerId }, ...messageMetadata(envelope) };
};

const FAILED_IN_RABBITMQ =
  'Failed in RabbitMQ before the move to the jobs table';

/** Adds a message RabbitMQ had parked as a failed job, so it shows with the rest. */
export const insertFailedJob = async <Q extends JobQueue>(
  db: Pick<DatabaseClient, 'execute'>,
  queue: Q,
  job: EnqueueJob<Q>
) => {
  await db.execute(sql`
    INSERT INTO jobs (
      queue, dedup_key, payload, priority, status, attempts,
      correlation_id, tournament_id, last_error, finished
    )
    VALUES (
      ${queue},
      ${jobDedupKeys[queue](job.payload)},
      ${JSON.stringify(job.payload)}::jsonb,
      ${job.priority ?? 5},
      ${JobStatus.Failed},
      5,
      COALESCE(${job.correlationId ?? null}::varchar, gen_random_uuid()::text),
      ${job.tournamentId ?? null}::integer,
      ${FAILED_IN_RABBITMQ},
      now()
    )`);
};

/**
 * Moves messages still sent to, or left in, RabbitMQ for queues that now run
 * from the jobs table: an old container's last messages, a backlog at deploy,
 * and messages in the retry and failed queues. Nothing runs a job from
 * RabbitMQ directly. Removed with RabbitMQ.
 */
export class RabbitMqBridge {
  private readonly options: RabbitMqBridgeOptions;
  private readonly consumers: RabbitMqConsumer<Record<string, unknown>>[] = [];

  constructor(options: RabbitMqBridgeOptions) {
    this.options = options;
  }

  get isConsuming() {
    return this.consumers.every((consumer) => consumer.isConsuming);
  }

  async start() {
    for (const bridged of this.options.queues) {
      await this.drainFailed(bridged);

      const consumer = new RabbitMqConsumer<Record<string, unknown>>({
        url: this.options.url,
        queue: bridged.queue,
        prefetch: 1,
        logger: this.options.logger,
        metricsQueue: `${bridged.queue}.bridge`,
      });

      await consumer.start(async (message) => {
        const job = bridged.toJob(message.payload);
        if (job) {
          await enqueueJob(this.options.db, bridged.queue, job);
          rabbitMqBridged.labels({ queue: bridged.queue }).inc();
        } else {
          this.options.logger.warn('Dropped a RabbitMQ message with no job', {
            queue: bridged.queue,
          });
        }
        await message.ack();
      });
      this.consumers.push(consumer);
    }
  }

  async stop() {
    await Promise.allSettled(this.consumers.map((consumer) => consumer.stop()));
  }

  /** Brings parked messages in as failed jobs, so they show with the rest. */
  private async drainFailed(bridged: BridgedQueue<JobQueue>) {
    const failedQueue = failedQueueName(bridged.queue);
    const connection = await connect(this.options.url);
    let moved = 0;

    try {
      const channel = await connection.createChannel();
      await channel.assertQueue(failedQueue, { durable: true });

      for (;;) {
        const message = await channel.get(failedQueue, { noAck: false });
        if (!message) break;

        let envelope: Record<string, unknown> | null = null;
        try {
          envelope = JSON.parse(message.content.toString('utf-8'));
        } catch {
          envelope = null;
        }

        const job = envelope ? bridged.toJob(envelope) : null;
        if (job) {
          await insertFailedJob(this.options.db, bridged.queue, job);
          moved += 1;
        } else {
          this.options.logger.warn(
            'Dropped a failed RabbitMQ message with no job',
            {
              queue: bridged.queue,
              content: message.content.toString('utf-8').slice(0, 500),
            }
          );
        }
        channel.ack(message);
      }

      await channel.close();
    } finally {
      await connection.close().catch(() => {});
    }

    if (moved > 0) {
      this.options.logger.warn(
        'Moved failed RabbitMQ messages into the jobs table',
        {
          queue: bridged.queue,
          moved,
        }
      );
    }
  }
}
