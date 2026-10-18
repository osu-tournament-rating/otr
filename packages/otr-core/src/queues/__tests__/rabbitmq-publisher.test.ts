import { describe, expect, it } from 'bun:test';
import type { ChannelModel, Options } from 'amqplib';

import type { MessageEnvelope } from '../../messages/types';
import { MessagePriority } from '../../messages/values';
import { QueuePriorityArguments } from '../constants';
import { RabbitMqPublisher } from '../rabbitmq-publisher';

type TestMessage = MessageEnvelope<{ beatmapId: number }>;

class FakeChannel {
  asserted: Array<{ queue: string; options?: Options.AssertQueue }> = [];
  checked: string[] = [];
  published: Array<{
    queue: string;
    content: Buffer;
    options?: Options.Publish;
  }> = [];
  readyMessages = 0;

  async assertQueue(queue: string, options?: Options.AssertQueue) {
    this.asserted.push({ queue, options });
    return { queue, messageCount: this.readyMessages, consumerCount: 0 };
  }

  async checkQueue(queue: string) {
    this.checked.push(queue);
    return { queue, messageCount: this.readyMessages, consumerCount: 1 };
  }

  sendToQueue(queue: string, content: Buffer, options?: Options.Publish) {
    this.published.push({ queue, content, options });
    return true;
  }

  async waitForConfirms() {}
  async close() {}
  on() {
    return this;
  }
  once() {
    return this;
  }
}

const createPublisher = (queue: string, confirmTimeoutMs?: number) => {
  const channel = new FakeChannel();
  let connections = 0;
  const publisher = new RabbitMqPublisher<TestMessage>({
    url: 'amqp://unused',
    queue,
    confirmTimeoutMs,
    connectionFactory: async () => {
      connections += 1;
      return {
        createConfirmChannel: async () => channel,
        close: async () => {},
        on: () => {},
        once: () => {},
      } as unknown as ChannelModel;
    },
  });

  return { channel, publisher, connections: () => connections };
};

describe('RabbitMqPublisher', () => {
  it('counts the ready messages of its queue', async () => {
    const { channel, publisher } = createPublisher('test.count');
    channel.readyMessages = 7;

    expect(await publisher.messageCount()).toBe(7);
    expect(channel.checked).toEqual(['test.count']);
  });

  it('declares the queue before counting', async () => {
    const { channel, publisher } = createPublisher('test.declare');

    await publisher.messageCount();

    expect(channel.asserted).toEqual([
      {
        queue: 'test.declare',
        options: { durable: true, arguments: { ...QueuePriorityArguments } },
      },
    ]);
  });

  it('shares one channel between publishing and counting', async () => {
    const { channel, publisher, connections } = createPublisher('test.shared');

    await publisher.publish({ beatmapId: 1 });
    await publisher.messageCount();
    await publisher.messageCount();

    expect(connections()).toBe(1);
    expect(channel.asserted).toHaveLength(1);
    expect(channel.checked).toHaveLength(2);
  });

  it('publishes with the priority from the message metadata', async () => {
    const { channel, publisher } = createPublisher('test.priority');

    const message = await publisher.publish(
      { beatmapId: 42 },
      { metadata: { priority: MessagePriority.Low } }
    );

    expect(message).toMatchObject({
      beatmapId: 42,
      priority: MessagePriority.Low,
    });
    expect(channel.published).toHaveLength(1);
    expect(channel.published[0]?.queue).toBe('test.priority');
    expect(channel.published[0]?.options).toMatchObject({
      persistent: true,
      priority: MessagePriority.Low,
    });
    expect(JSON.parse(channel.published[0]!.content.toString())).toEqual(
      message
    );
  });

  it("gives up on a message the broker doesn't confirm in time", async () => {
    const { channel, publisher } = createPublisher('test.blocked', 50);
    // A broker under a resource alarm holds the confirm far past the timeout.
    channel.waitForConfirms = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 1_000));

    await expect(publisher.publish({ beatmapId: 1 })).rejects.toThrow(
      'RabbitMQ did not confirm a message on test.blocked within 50 ms'
    );
  });
});
