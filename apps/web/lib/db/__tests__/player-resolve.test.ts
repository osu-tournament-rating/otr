import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { db } from '@/lib/db';

import { resolvePlayerIdFromKey } from '../player-resolve';

// Player pages look players up through DATABASE_URL, so this runs only when
// that is the disposable test database. CI points both at the same one.
const url = process.env.SEARCH_TEST_DATABASE_URL;
const enabled = !!url && process.env.DATABASE_URL === url;

// A name LIKE would match with `_` as a wildcard, as `M_nami` matches `Menami`
const OSU_ID = 999_114_902;
const USERNAME = `Menami${OSU_ID}`;

describe.skipIf(!enabled)('resolvePlayerIdFromKey by username', () => {
  let playerId: number;

  beforeAll(async () => {
    await db.delete(schema.players).where(eq(schema.players.osuId, OSU_ID));
    const [player] = await db
      .insert(schema.players)
      .values({ osuId: OSU_ID, username: USERNAME })
      .returning({ id: schema.players.id });
    playerId = player!.id;
  });

  afterAll(async () => {
    await db.delete(schema.players).where(eq(schema.players.osuId, OSU_ID));
  });

  it('finds the player by their name in any case', async () => {
    expect(await resolvePlayerIdFromKey(USERNAME.toLowerCase())).toBe(playerId);
  });

  it.each([
    ['an underscore', USERNAME.replace('e', '_')],
    ['a percent sign', '%'],
  ])('does not treat %s as a wildcard', async (_, key) => {
    expect(await resolvePlayerIdFromKey(key)).toBeNull();
  });
});
