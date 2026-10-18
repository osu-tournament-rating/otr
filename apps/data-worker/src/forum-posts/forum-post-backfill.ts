import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FetchOsuMessage, MessageEnvelope } from '@otr/core';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { forumTopicIdSql } from '@otr/core/osu/forum';
import type { QueuePublisher } from '@otr/core/queues';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';

type QueuePublisherContract<TMessage extends MessageEnvelope<unknown>> = Pick<
  QueuePublisher<TMessage>,
  'publish'
>;

interface ForumPostBackfillOptions {
  db: DatabaseClient;
  logger: Logger;
  osuPublisher: QueuePublisherContract<FetchOsuMessage>;
}

/**
 * Links tournaments whose forum topic has no stored post yet. Runs on every
 * start, so it backfills existing tournaments once and later catches any
 * submission or forum URL edit whose fetch was never queued.
 */
export class ForumPostBackfill {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly osuPublisher: QueuePublisherContract<FetchOsuMessage>;

  constructor(options: ForumPostBackfillOptions) {
    this.db = options.db;
    this.logger = options.logger;
    this.osuPublisher = options.osuPublisher;
  }

  /** Never throws: a failed sweep only delays the backfill to the next start. */
  async run(): Promise<void> {
    try {
      const { linked, enqueued } = await this.sweep();
      if (linked > 0 || enqueued > 0) {
        this.logger.info('Forum post backfill done', { linked, enqueued });
      }
    } catch (error) {
      this.logger.error('Failed to backfill forum posts', { error });
    }
  }

  private async sweep() {
    const { tournaments, tournamentForumPosts } = schema;
    const topicId = forumTopicIdSql(tournaments.forumUrl);

    // A topic another tournament already stored needs no osu! request.
    const linkedRows = await this.db
      .update(tournaments)
      .set({ forumPostId: tournamentForumPosts.id })
      .from(tournamentForumPosts)
      .where(
        and(
          isNull(tournaments.forumPostId),
          eq(tournamentForumPosts.topicId, topicId)
        )
      )
      .returning({ id: tournaments.id });

    const topics = await this.db
      .selectDistinct({ topicId })
      .from(tournaments)
      .where(and(isNull(tournaments.forumPostId), isNotNull(topicId)));

    let enqueued = 0;
    for (const row of topics) {
      if (row.topicId === null) {
        continue;
      }

      // Low priority, so the backfill waits behind submitted data.
      await this.osuPublisher.publish(
        { type: 'forumTopic', topicId: row.topicId },
        { metadata: { priority: MessagePriority.Low } }
      );
      enqueued += 1;
    }

    return { linked: linkedRows.length, enqueued };
  }
}
