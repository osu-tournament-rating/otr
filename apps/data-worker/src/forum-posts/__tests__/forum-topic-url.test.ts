import { afterAll, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { forumTopicIdSql, parseForumTopicId } from '@otr/core/osu/forum';

// Set by the `checks` job in .github/workflows/ci.yml.
const url = process.env.SEARCH_TEST_DATABASE_URL;

// The worker links tournaments in SQL and the site queues fetches in
// JavaScript, so both must read every URL the same way.
const cases: Array<[string, number | null]> = [
  ['https://osu.ppy.sh/community/forums/topics/2212242', 2212242],
  ['https://osu.ppy.sh/community/forums/topics/2212242?n=1', 2212242],
  ['https://osu.ppy.sh/community/forums/topics/999999999', 999999999],
  // Ten digits overflow PostgreSQL's integer.
  ['https://osu.ppy.sh/community/forums/topics/1234567890', null],
  ['https://osu.ppy.sh/community/forums/topics/0', null],
  ['https://osu.ppy.sh/wiki/en/Tournaments/MWC/2024_4K', null],
  ['https://osu.ppy.sh/community/forums/posts/2212242', null],
  ['https://example.com/community/forums/topics/2212242', null],
];

describe('parseForumTopicId', () => {
  it.each(cases)('reads %s as %p', (forumUrl, expected) => {
    expect(parseForumTopicId(forumUrl)).toBe(expected);
  });
});

describe.skipIf(!url)('forumTopicIdSql', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  afterAll(() => pool.end());

  it.each(cases)('reads %s as %p', async (forumUrl, expected) => {
    const result = await db.execute<{ topic_id: number | null }>(
      sql`SELECT ${forumTopicIdSql(sql`${forumUrl}::text`)} AS topic_id`
    );
    expect(result.rows[0]!.topic_id).toBe(expected);
  });
});
