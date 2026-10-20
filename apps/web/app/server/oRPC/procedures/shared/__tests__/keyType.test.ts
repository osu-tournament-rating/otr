import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { ORPCError } from '@orpc/server';
import { eq } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';

import { createTestDb, testDatabaseUrl } from '../../__tests__/test-utils';
import { resolvePlayerId } from '../keyType';

// A name LIKE would match with `_` as a wildcard, as `M_nami` matches `Menami`
const OSU_ID = 999_114_901;
const USERNAME = `Menami${OSU_ID}`;

describe.skipIf(!testDatabaseUrl)('resolvePlayerId by username', () => {
  const { pool, db } = createTestDb(testDatabaseUrl ?? '');
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
    await pool.end();
  });

  const lookUp = (username: string) =>
    resolvePlayerId(db, username, 'username').catch((error: unknown) => error);

  it('finds the player by their name in any case', async () => {
    expect(await lookUp(USERNAME.toUpperCase())).toBe(playerId);
  });

  it.each([
    ['an underscore', USERNAME.replace('e', '_')],
    ['a percent sign', '%'],
  ])('does not treat %s as a wildcard', async (_, username) => {
    const result = await lookUp(username);

    expect(result).toBeInstanceOf(ORPCError);
    expect(result).toMatchObject({ code: 'NOT_FOUND' });
  });
});
