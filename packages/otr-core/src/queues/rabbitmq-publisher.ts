import { connect, type Options } from 'amqplib';
import type { MessageEnvelope } from '@otr/core';
import { QueuePriorityArguments, createMessageMetadata } from '@otr/core';
import { injectTraceHeaders, tracePublish } from '../tracing';

import type {
  QueueMessagePayload,
  QueuePublishOptions,
  QueuePublisher,
} from './types';

type AmqpConnection = Awaited<ReturnType<typeof connect>>;
type ConfirmChannel = Awaited<
  ReturnType<AmqpConnection['createConfirmChannel']>
>;

export interface RabbitMqPublisherOptions {
  url: string;
  queue: string;
  assertQueueOptions?: Options.AssertQueue;
  publishOptions?: Options.Publish;
  connectionFactory?: () => Promise<AmqpConnection>;
}

export class RabbitMqPublisher<
  TMessage extends MessageEnvelope<unknown>,
> implements QueuePublisher<TMessage> {
  private readonly queue: string;
  private readonly createConnection: () => Promise<AmqpConnection>;
  private readonly assertQueueOptions: Options.AssertQueue | undefined;
  private readonly basePublishOptions: Options.Publish | undefined;

  private connection: AmqpConnection | null = null;
  private channelPromise: Promise<ConfirmChannel> | null = null;

  constructor(options: RabbitMqPublisherOptions) {
    this.queue = options.queue;
    this.createConnection =
      options.connectionFactory ?? (() => connect(options.url));
    this.assertQueueOptions = options.assertQueueOptions;
    this.basePublishOptions = options.publishOptions;
  }

  async publish(
    payload: QueueMessagePayload<TMessage>,
    options: QueuePublishOptions = {}
  ): Promise<TMessage> {
    return tracePublish(this.queue, async () => {
      const channel = await this.ensureChannel();
      const metadata = createMessageMetadata(options.metadata);
      const message = { ...metadata, ...(payload ?? {}) } as TMessage;

      const publishOptions: Options.Publish = {
        persistent: true,
        ...this.basePublishOptions,
        headers: injectTraceHeaders({ ...this.basePublishOptions?.headers }),
      };

      if (publishOptions.priority === undefined) {
        publishOptions.priority = metadata.priority;
      }

      channel.sendToQueue(
        this.queue,
        Buffer.from(JSON.stringify(message), 'utf-8'),
        publishOptions
      );

      await channel.waitForConfirms();
      return message;
    });
  }

  /** Messages ready for delivery; unacknowledged deliveries are not counted. */
  async messageCount(): Promise<number> {
    const channel = await this.ensureChannel();
    const { messageCount } = await channel.checkQueue(this.queue);
    return messageCount;
  }

  async close(): Promise<void> {
    const channel = await this.channelPromise?.catch(() => null);
    const connection = this.connection;

    await Promise.allSettled([channel?.close(), connection?.close()]);

    this.channelPromise = null;
    this.connection = null;
  }

  private async ensureChannel(): Promise<ConfirmChannel> {
    if (!this.channelPromise) {
      this.channelPromise = (async () => {
        const connection = await this.createConnection();
        const channel = await connection.createConfirmChannel();
        const queueOptions: Options.AssertQueue = {
          durable: true,
          ...this.assertQueueOptions,
        };

        queueOptions.arguments = {
          ...QueuePriorityArguments,
          ...this.assertQueueOptions?.arguments,
        };

        await channel.assertQueue(this.queue, queueOptions);

        const reset = () => {
          this.channelPromise = null;
          this.connection = null;
        };

        connection.once('close', reset);
        connection.once('error', reset);
        channel.once('close', reset);
        channel.once('error', reset);

        this.connection = connection;
        return channel;
      })();

      this.channelPromise.catch(() => {
        this.channelPromise = null;
        this.connection = null;
      });
    }

    return this.channelPromise;
  }
}
