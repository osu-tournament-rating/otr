import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { API } from 'osu-api-v2-js';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';

import type { DatabaseClient } from '../../../db';
import type { Logger } from '../../../logging/logger';
import type { RateLimiter } from '../../../rate-limiter';

// The client module reads worker env at import time.
class FakeAPIError extends Error {
  constructor(readonly response: { status_code: number }) {
    super(`HTTP ${response.status_code}`);
  }
}
mock.module('../../client', () => ({ APIError: FakeAPIError }));

const { ForumTopicFetchService } = await import('../forum-topic-fetch-service');

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const TOPIC = 990_000_101;
const OTHER_TOPIC = 990_000_102;
const NAME_PREFIX = 'forum-topic-fetch-';

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
} as unknown as Logger;

const rateLimiter: RateLimiter = { schedule: (task) => task() };

const topicResponse = (bbcode: string, editedAt: string | null) => ({
  topic: { id: TOPIC, title: 'Test Cup 2026', first_post_id: 5001 },
  posts: [
    {
      id: 5001,
      edited_at: editedAt ? new Date(editedAt) : null,
      body: { raw: bbcode, html: '<p>ignored</p>' },
    },
  ],
  cursor_string: null,
});

describe.skipIf(!url)('ForumTopicFetchService', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.tournamentForumPosts)
      .where(
        inArray(schema.tournamentForumPosts.topicId, [TOPIC, OTHER_TOPIC])
      );
  };

  const seedTournament = async (abbreviation: string, forumUrl: string) => {
    const [row] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}${abbreviation}`,
        abbreviation,
        forumUrl,
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    return row!.id;
  };

  const forumPostIdOf = async (tournamentId: number) => {
    const row = await db.query.tournaments.findFirst({
      columns: { forumPostId: true },
      where: eq(schema.tournaments.id, tournamentId),
    });
    return row?.forumPostId ?? null;
  };

  const storedPost = () =>
    db.query.tournamentForumPosts.findFirst({
      where: eq(schema.tournamentForumPosts.topicId, TOPIC),
    });

  const createService = (getForumTopic: (...args: unknown[]) => unknown) =>
    new ForumTopicFetchService({
      db,
      api: { getForumTopic } as unknown as API,
      rateLimiter,
      logger: silentLogger,
    });

  beforeEach(removeSeed);

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it('stores the opening post and links every tournament on the topic', async () => {
    const plain = await seedTournament(
      'FTF1',
      `https://osu.ppy.sh/community/forums/topics/${TOPIC}`
    );
    const withQuery = await seedTournament(
      'FTF2',
      `https://osu.ppy.sh/community/forums/topics/${TOPIC}?n=1`
    );
    const otherTopic = await seedTournament(
      'FTF3',
      `https://osu.ppy.sh/community/forums/topics/${OTHER_TOPIC}`
    );
    const wiki = await seedTournament(
      'FTF4',
      'https://osu.ppy.sh/wiki/en/Tournaments/FTF/2026'
    );

    const getForumTopic = mock(async () =>
      topicResponse('[b]Welcome[/b]', '2026-07-17T17:11:34.000Z')
    );
    const stored = await createService(getForumTopic).fetchAndPersist(TOPIC);

    expect(stored).toBe(true);
    expect(getForumTopic).toHaveBeenCalledWith(TOPIC, {
      limit: 1,
      sort: 'id_asc',
    });

    const post = await storedPost();
    expect(post).toMatchObject({
      topicId: TOPIC,
      postId: 5001,
      title: 'Test Cup 2026',
      bbcode: '[b]Welcome[/b]',
    });
    expect(Date.parse(post!.editedAt!)).toBe(
      Date.parse('2026-07-17T17:11:34.000Z')
    );

    expect(await forumPostIdOf(plain)).toBe(post!.id);
    expect(await forumPostIdOf(withQuery)).toBe(post!.id);
    expect(await forumPostIdOf(otherTopic)).toBeNull();
    expect(await forumPostIdOf(wiki)).toBeNull();
  });

  it('skips the osu! request when a fetch since the request stored the post', async () => {
    await createService(async () =>
      topicResponse('first', null)
    ).fetchAndPersist(TOPIC);
    const before = await storedPost();

    // Submitted after the fetch, sharing the stored topic.
    const tournamentId = await seedTournament(
      'FTF1',
      `https://osu.ppy.sh/community/forums/topics/${TOPIC}`
    );

    const stale = mock(async () => topicResponse('second', null));
    const requestedBeforeFetch = new Date(
      Date.parse(before!.fetched) - 1000
    ).toISOString();
    await createService(stale).fetchAndPersist(TOPIC, requestedBeforeFetch);

    expect(stale).not.toHaveBeenCalled();
    expect((await storedPost())!.bbcode).toBe('first');
    expect(await forumPostIdOf(tournamentId)).toBe(before!.id);

    const fresh = mock(async () => topicResponse('second', null));
    const requestedAfterFetch = new Date(
      Date.parse(before!.fetched) + 1000
    ).toISOString();
    await createService(fresh).fetchAndPersist(TOPIC, requestedAfterFetch);

    expect(fresh).toHaveBeenCalledTimes(1);
    const after = await storedPost();
    expect(after!.bbcode).toBe('second');
    expect(after!.id).toBe(before!.id);
  });

  it('skips a topic osu! no longer serves and links tournaments to the stored post', async () => {
    const tournamentId = await seedTournament(
      'FTF1',
      `https://osu.ppy.sh/community/forums/topics/${TOPIC}`
    );
    await createService(async () =>
      topicResponse('kept', null)
    ).fetchAndPersist(TOPIC);
    const post = await storedPost();

    // Submitted after the topic disappeared from osu!.
    const lateTournamentId = await seedTournament(
      'FTF2',
      `https://osu.ppy.sh/community/forums/topics/${TOPIC}`
    );

    const stored = await createService(async () => {
      throw new FakeAPIError({ status_code: 404 });
    }).fetchAndPersist(TOPIC);

    expect(stored).toBe(false);
    expect((await storedPost())!.bbcode).toBe('kept');
    expect(await forumPostIdOf(tournamentId)).toBe(post!.id);
    expect(await forumPostIdOf(lateTournamentId)).toBe(post!.id);
  });

  it('stores nothing when the opening post is not visible', async () => {
    const tournamentId = await seedTournament(
      'FTF1',
      `https://osu.ppy.sh/community/forums/topics/${TOPIC}`
    );
    const response = topicResponse('reply', null);
    response.posts[0]!.id = 5002;

    const stored = await createService(async () => response).fetchAndPersist(
      TOPIC
    );

    expect(stored).toBe(false);
    expect(await storedPost()).toBeUndefined();
    expect(await forumPostIdOf(tournamentId)).toBeNull();
  });
});
