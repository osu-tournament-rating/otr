import { and, eq, sql } from 'drizzle-orm';
import type { API } from 'osu-api-v2-js';

import { withApiErrorHandling, withApiMetrics } from '../api-helpers';
import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import type { RateLimiter } from '../../rate-limiter';
import * as schema from '@otr/core/db/schema';
import { forumTopicIdSql } from '@otr/core/osu/forum';

interface ForumTopicFetchServiceOptions {
  db: DatabaseClient;
  api: API;
  rateLimiter: RateLimiter;
  logger: Logger;
}

const toIsoString = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

export class ForumTopicFetchService {
  private readonly db: DatabaseClient;
  private readonly api: API;
  private readonly rateLimiter: RateLimiter;
  private readonly logger: Logger;

  constructor(options: ForumTopicFetchServiceOptions) {
    this.db = options.db;
    this.api = options.api;
    this.rateLimiter = options.rateLimiter;
    this.logger = options.logger;
  }

  /**
   * Stores the topic's opening post and links every tournament whose forum URL
   * points at the topic. Returns false when osu! has no visible opening post.
   *
   * @param requestedAt When the fetch was requested. A post fetched at or after
   * this time is already fresh enough, so only the links are updated.
   */
  async fetchAndPersist(
    topicId: number,
    requestedAt?: string
  ): Promise<boolean> {
    const stored = await this.db.query.tournamentForumPosts.findFirst({
      columns: { id: true, fetched: true },
      where: eq(schema.tournamentForumPosts.topicId, topicId),
    });

    if (
      stored &&
      requestedAt &&
      Date.parse(stored.fetched) >= Date.parse(requestedAt)
    ) {
      await this.linkTournaments(topicId, stored.id);
      return true;
    }

    const result = await this.rateLimiter.schedule(() =>
      withApiMetrics('getForumTopic', () =>
        withApiErrorHandling(() =>
          this.api.getForumTopic(topicId, { limit: 1, sort: 'id_asc' })
        )
      )
    );

    if (result.status !== 'success') {
      // A deleted or hidden topic is skipped, not retried. A post stored
      // earlier stays, and tournaments on the topic link to it.
      this.logger.warn('osu! returned no forum topic', {
        topicId,
        status: result.status,
      });
      await this.linkStored(topicId, stored);
      return false;
    }

    const { topic, posts } = result.data;
    const post = posts.find(
      (candidate) => candidate.id === topic.first_post_id
    );

    if (!post) {
      this.logger.warn('forum topic has no visible opening post', {
        topicId,
        firstPostId: topic.first_post_id,
      });
      await this.linkStored(topicId, stored);
      return false;
    }

    const values = {
      postId: post.id,
      title: topic.title,
      bbcode: post.body.raw,
      editedAt: toIsoString(post.edited_at),
      fetched: new Date().toISOString(),
    };

    const [row] = await this.db
      .insert(schema.tournamentForumPosts)
      .values({ topicId, ...values })
      .onConflictDoUpdate({
        target: schema.tournamentForumPosts.topicId,
        set: values,
      })
      .returning({ id: schema.tournamentForumPosts.id });

    if (!row) {
      throw new Error(`Failed to store forum topic ${topicId}`);
    }

    await this.linkTournaments(topicId, row.id);
    return true;
  }

  private async linkStored(
    topicId: number,
    stored: { id: number } | undefined
  ) {
    if (stored) {
      await this.linkTournaments(topicId, stored.id);
    }
  }

  private async linkTournaments(topicId: number, forumPostId: number) {
    await this.db
      .update(schema.tournaments)
      .set({ forumPostId })
      .where(
        and(
          sql`${forumTopicIdSql(schema.tournaments.forumUrl)} = ${topicId}`,
          sql`${schema.tournaments.forumPostId} IS DISTINCT FROM ${forumPostId}`
        )
      );
  }
}
