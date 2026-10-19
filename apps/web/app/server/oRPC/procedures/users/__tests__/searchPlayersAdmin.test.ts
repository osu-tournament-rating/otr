import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import * as schema from '@otr/core/db/schema';

import {
  createTestDb,
  removePlayers,
  testDatabaseUrl,
} from '../../__tests__/test-utils';
import { searchPlayersAdminHandler } from '../adminProcedures';

// Runs in the `checks` job of .github/workflows/ci.yml, which sets
// SEARCH_TEST_DATABASE_URL.
const PREFIXED_OSU_ID = 998_100_001;
const EXACT_OSU_ID = 998_100_002;
const RENAMED_OSU_ID = 998_100_003;
const NO_ACCOUNT_OSU_ID = 998_100_004;
const osuIds = [
  PREFIXED_OSU_ID,
  EXACT_OSU_ID,
  RENAMED_OSU_ID,
  NO_ACCOUNT_OSU_ID,
];

describe.skipIf(!testDatabaseUrl)('admin user lookup search', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  const session = { dbUser: { id: 1, scopes: ['admin'] } };

  const search = (query: string) =>
    searchPlayersAdminHandler({ input: { query }, context: { db, session } });

  beforeAll(async () => {
    await removePlayers(db, osuIds);
    const players = await db
      .insert(schema.players)
      .values([
        // Sorts before the exact match, as the old lookup ordered them.
        {
          osuId: PREFIXED_OSU_ID,
          username: 'aaqvorlix',
          previousUsernames: [],
        },
        { osuId: EXACT_OSU_ID, username: 'qvorlix', previousUsernames: [] },
        {
          osuId: RENAMED_OSU_ID,
          username: 'brintel',
          previousUsernames: ['zephquall'],
        },
        {
          osuId: NO_ACCOUNT_OSU_ID,
          username: 'qvorlixx',
          previousUsernames: [],
        },
      ])
      .returning({ id: schema.players.id, osuId: schema.players.osuId });

    await db.insert(schema.auth_users).values(
      players
        .filter((player) => player.osuId !== NO_ACCOUNT_OSU_ID)
        .map((player) => ({
          id: `admin-search-test-${player.osuId}`,
          name: String(player.osuId),
          email: `${player.osuId}@admin-search.test`,
          playerId: player.id,
        }))
    );
  });

  afterAll(async () => {
    await removePlayers(db, osuIds);
    await pool.end();
  });

  it('ranks the exact username first, like the header search', async () => {
    const results = await search('qvorlix');
    expect(results[0]?.osuId).toBe(EXACT_OSU_ID);
  });

  it('suggests players while their name is still being typed', async () => {
    const results = await search('qvorl');
    expect(results.map((player) => player.osuId)).toContain(EXACT_OSU_ID);
  });

  it('finds a player by a former username and names it', async () => {
    const results = await search('zephquall');
    expect(results).toHaveLength(1);
    expect(results[0]?.osuId).toBe(RENAMED_OSU_ID);
    expect(results[0]?.matchedPreviousUsername).toBe('zephquall');
  });

  it('finds a player by exact osu! ID', async () => {
    const results = await search(String(RENAMED_OSU_ID));
    expect(results[0]?.osuId).toBe(RENAMED_OSU_ID);
  });

  it('leaves out players who never signed in', async () => {
    const results = await search('qvorlixx');
    expect(results.map((player) => player.osuId)).not.toContain(
      NO_ACCOUNT_OSU_ID
    );
  });
});
