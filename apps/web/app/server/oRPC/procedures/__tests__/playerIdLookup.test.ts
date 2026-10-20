import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import * as schema from '@otr/core/db/schema';
import {
  createOpenAPIHandler,
  generatePublicOpenAPISpec,
} from '@/app/server/openapi';
import { router } from '@/app/server/oRPC/router';

import { createTestDb, removePlayers, testDatabaseUrl } from './test-utils';

const PLAYER_OSU_ID = 999_238_001;

// The public API without its route's API key gate
const api = createOpenAPIHandler(router);

const get = async (path: string) => {
  const { response } = await api.handle(
    new Request(`http://localhost/api${path}`),
    { prefix: '/api', context: { headers: new Headers() } }
  );

  return { status: response?.status, body: await response?.json() };
};

// The public endpoints that look a player up by `{id}` and `keyType`
const PLAYER_PATHS = [
  '/players/{id}',
  '/players/{id}/stats',
  '/players/{id}/tournaments',
  '/players/{id}/beatmaps',
];

describe('a public API player ID that is not a number (#1238)', () => {
  it.each(PLAYER_PATHS)(
    '%s refuses a username without keyType=username',
    async (path) => {
      const { status, body } = await get(path.replace('{id}', 'Stage'));

      expect(status).toBe(400);
      expect(body.message).toContain('pass keyType=username');
    }
  );

  it('is refused with keyType=osu', async () => {
    const { status, body } = await get('/players/Stage/stats?keyType=osu');

    expect(status).toBe(400);
    expect(body.message).toContain('pass keyType=username');
  });

  it.each(PLAYER_PATHS)('%s documents the 400', async (path) => {
    const spec = await generatePublicOpenAPISpec();
    const responses = spec.paths?.[path]?.get?.responses ?? {};

    expect(JSON.stringify(responses['400'])).toContain('keyType=username');
  });
});

// Every ID reaches the API as text, so a number must still resolve. Needs
// the test database, which CI's `checks` job sets up.
describe.skipIf(!testDatabaseUrl)(
  'a public API player ID that is a number',
  () => {
    const { pool, db } = createTestDb(testDatabaseUrl!);
    let playerId = 0;

    beforeAll(async () => {
      await removePlayers(db, [PLAYER_OSU_ID]);

      const [player] = await db
        .insert(schema.players)
        .values({ osuId: PLAYER_OSU_ID, username: 'player-id-lookup' })
        .returning({ id: schema.players.id });
      playerId = player!.id;
    });

    afterAll(async () => {
      await removePlayers(db, [PLAYER_OSU_ID]);
      await pool.end();
    });

    it('finds the player by o!TR ID', async () => {
      const { status, body } = await get(`/players/${playerId}`);

      expect(status).toBe(200);
      expect(body.id).toBe(playerId);
    });

    it('finds the player by osu! ID', async () => {
      const { status, body } = await get(
        `/players/${PLAYER_OSU_ID}?keyType=osu`
      );

      expect(status).toBe(200);
      expect(body.id).toBe(playerId);
    });
  }
);
