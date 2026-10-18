import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';
import { eq, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';
import type { DatabaseClient } from '@/lib/db';

import { getTournament } from '../tournamentsProcedures';

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const NAME_PREFIX = 'tournament-detail-';
const TOPIC = 990_000_301;

describe.skipIf(!url)('getTournament', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema }) as unknown as DatabaseClient;
  let tournamentId = 0;

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${NAME_PREFIX}%`));
    await db
      .delete(schema.tournamentForumPosts)
      .where(eq(schema.tournamentForumPosts.topicId, TOPIC));
  };

  beforeAll(async () => {
    await removeSeed();

    const [post] = await db
      .insert(schema.tournamentForumPosts)
      .values({
        topicId: TOPIC,
        postId: 1,
        title: 'Seeded',
        bbcode: 'seeded',
        fetched: new Date().toISOString(),
      })
      .returning({ id: schema.tournamentForumPosts.id });

    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${NAME_PREFIX}linked`,
        abbreviation: 'TDL',
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${TOPIC}`,
        forumPostId: post!.id,
        rankRangeLowerBound: 1,
        ruleset: Ruleset.Osu,
        lobbySize: 1,
      })
      .returning({ id: schema.tournaments.id });
    tournamentId = tournament!.id;
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  // The data worker's link stays out of the page and the public API.
  it('serves a tournament linked to a forum post without the link', async () => {
    const detail = await call(
      getTournament,
      { id: tournamentId },
      { context: { db, headers: new Headers() } }
    );

    expect(detail.id).toBe(tournamentId);
    expect(detail.name).toBe(`${NAME_PREFIX}linked`);
    expect(Object.keys(detail)).not.toContain('forumPostId');
  });
});
