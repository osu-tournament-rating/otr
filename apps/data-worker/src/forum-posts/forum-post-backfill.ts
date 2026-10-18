import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { MessagePriority } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import { forumTopicIdSql } from '@otr/core/osu/forum';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';

interface ForumPostBackfillOptions {
  db: DatabaseClient;
  logger: Logger;
}

/**
 * Links tournaments whose forum topic has no stored post yet. Runs on every
 * start, so it backfills existing tournaments once and later catches any
 * submission or forum URL edit whose fetch was never queued.
 */
export class ForumPostBackfill {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;

  constructor(options: ForumPostBackfillOptions) {
    this.db = options.db;
    this.logger = options.logger;
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

    const topicIds = topics
      .map((row) => row.topicId)
      .filter((id): id is number => id !== null);

    // Low priority, so the backfill waits behind submitted data. A topic
    // already queued merges into its job.
    await enqueueJobs(
      this.db,
      JobQueue.OsuFetch,
      topicIds.map((topicId) => ({
        payload: { type: 'forumTopic' as const, topicId },
        priority: MessagePriority.Low,
      }))
    );

    return { linked: linkedRows.length, enqueued: topicIds.length };
  }
}
