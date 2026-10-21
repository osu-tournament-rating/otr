import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { call } from '@orpc/server';

import * as schema from '@otr/core/db/schema';

import { getPlayer } from '../playerProcedures';
import { createTestDb, removePlayers, testDatabaseUrl } from './test-utils';

const OSU_ID = 990_000_401;

describe.skipIf(!testDatabaseUrl)('getPlayer', () => {
  const { pool, db } = createTestDb(testDatabaseUrl!);
  let playerId = 0;

  beforeAll(async () => {
    await removePlayers(db, [OSU_ID]);

    const [player] = await db
      .insert(schema.players)
      .values({
        osuId: OSU_ID,
        username: 'player-detail',
        country: 'AU',
        osuLastFetch: '2026-10-01 00:00:00+00',
        osuTrackLastFetch: '2026-10-02 00:00:00+00',
        osuTrackDataFetchStatus: 2,
        dataFetchStatus: 2,
      })
      .returning({ id: schema.players.id });
    playerId = player!.id;
  });

  afterAll(async () => {
    await removePlayers(db, [OSU_ID]);
    await pool.end();
  });

  // When and how the data worker last fetched a player is its own bookkeeping,
  // and stays out of the public API (#1089).
  it('serves a player without their fetch times and statuses', async () => {
    const player = await call(
      getPlayer,
      { id: playerId },
      { context: { db, headers: new Headers() } }
    );

    expect(player).toMatchObject({
      id: playerId,
      osuId: OSU_ID,
      username: 'player-detail',
    });
    expect(Object.keys(player)).not.toContain('osuLastFetch');
    expect(Object.keys(player)).not.toContain('osuTrackLastFetch');
    expect(Object.keys(player)).not.toContain('osuTrackDataFetchStatus');
    expect(Object.keys(player)).not.toContain('dataFetchStatus');
  });
});
