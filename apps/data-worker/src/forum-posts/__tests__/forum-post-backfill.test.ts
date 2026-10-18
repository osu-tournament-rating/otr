import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { FetchOsuMessage } from '@otr/core';
import { MessagePriority } from '@otr/core';
import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';
import type { QueuePublishOptions } from '@otr/core/queues';

import type { DatabaseClient } from '../../db';
import type { Logger } from '../../logging/logger';
import { ForumPostBackfill } from '../forum-post-backfill';

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const STORED_TOPIC = 990_000_201;
const UNSTORED_TOPIC = 990_000_202;
const LINKED_TOPIC = 990_000_203;
const NAME_PREFIX = 'forum-post-backfill-';

const topicUrl = (topicId: number, query = '') =>
  `https://osu.ppy.sh/community/forums/topics/${topicId}${query}`;

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

describe.skipIf(!url)('ForumPostBackfill', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  const topics = [STORED_TOPIC, UNSTORED_TOPIC, LINKED_TOPIC];

  const published: Array<{ topicId: number; priority?: MessagePriority }> = [];
  const ids: Record<string, number> = {};
  const postIds: Record<number, number> = {};

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.tournamentForumPosts)
      .where(inArray(schema.tournamentForumPosts.topicId, topics));
  };

  const seedPost = async (topicId: number) => {
    const [row] = await db
      .insert(schema.tournamentForumPosts)
      .values({
        topicId,
        postId: topicId,
        title: 'Seeded',
        bbcode: 'seeded',
        fetched: new Date().toISOString(),
      })
      .returning({ id: schema.tournamentForumPosts.id });
    postIds[topicId] = row!.id;
  };

  const seedTournament = async (
    key: string,
    forumUrl: string,
    forumPostId: number | null = null
  ) => {
    const [row] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}${key}`,
        abbreviation: key,
        forumUrl,
        forumPostId,
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    ids[key] = row!.id;
  };

  const forumPostIdOf = async (key: string) => {
    const row = await db.query.tournaments.findFirst({
      columns: { forumPostId: true },
      where: eq(schema.tournaments.id, ids[key]!),
    });
    return row?.forumPostId ?? null;
  };

  beforeAll(async () => {
    await removeSeed();

    await seedPost(STORED_TOPIC);
    await seedPost(LINKED_TOPIC);

    await seedTournament('STORED', topicUrl(STORED_TOPIC, '?n=1'));
    await seedTournament('UNSTORED1', topicUrl(UNSTORED_TOPIC));
    await seedTournament('UNSTORED2', topicUrl(UNSTORED_TOPIC, '?n=1'));
    await seedTournament(
      'LINKED',
      topicUrl(LINKED_TOPIC),
      postIds[LINKED_TOPIC]
    );
    await seedTournament(
      'WIKI',
      'https://osu.ppy.sh/wiki/en/Tournaments/FPB/2026'
    );

    await new ForumPostBackfill({
      db,
      logger: silentLogger,
      osuPublisher: {
        publish: async (payload, options?: QueuePublishOptions) => {
          if (payload.type === 'forumTopic') {
            published.push({
              topicId: payload.topicId,
              priority: options?.metadata?.priority,
            });
          }
          return payload as FetchOsuMessage;
        },
      },
    }).run();
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it('links a tournament to a stored topic without queueing a fetch', async () => {
    expect(await forumPostIdOf('STORED')).toBe(postIds[STORED_TOPIC]!);
    expect(published.some((m) => m.topicId === STORED_TOPIC)).toBe(false);
  });

  it('queues one low-priority fetch per unstored topic', () => {
    const forUnstored = published.filter((m) => m.topicId === UNSTORED_TOPIC);
    expect(forUnstored).toEqual([
      { topicId: UNSTORED_TOPIC, priority: MessagePriority.Low },
    ]);
  });

  it('leaves linked tournaments and wiki pages alone', async () => {
    expect(published.some((m) => m.topicId === LINKED_TOPIC)).toBe(false);
    expect(await forumPostIdOf('LINKED')).toBe(postIds[LINKED_TOPIC]!);
    expect(await forumPostIdOf('WIKI')).toBeNull();
  });
});
