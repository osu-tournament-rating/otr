import { describe, expect, test } from 'bun:test';

import { PublicUserSchema } from '../user';

describe('PublicUserSchema', () => {
  test('keeps only public profile fields', () => {
    const parsed = PublicUserSchema.parse({
      id: 1,
      lastLogin: '2026-08-01 00:00:00+00',
      scopes: ['admin'],
      playerId: 2,
      created: '2026-08-01 00:00:00+00',
      updated: null,
      lastViewedReportsAt: '2026-08-02 00:00:00+00',
      userSettings: {
        id: 3,
        profileRuleset: 1,
        browsingRuleset: 4,
        userId: 1,
        created: '2026-08-01 00:00:00+00',
        updated: null,
      },
      player: {
        id: 2,
        osuId: 4,
        username: 'peppy',
        searchVector: "'peppy':1A",
        previousUsernames: ['old name'],
        country: 'AU',
        osuLastFetch: '2026-08-01 00:00:00+00',
        osuTrackLastFetch: null,
        osuTrackDataFetchStatus: 0,
        dataFetchStatus: 0,
        created: '2026-08-01 00:00:00+00',
        updated: null,
      },
    });

    expect(parsed).toEqual({
      id: 1,
      player: { id: 2, osuId: 4, username: 'peppy', country: 'AU' },
    });
  });
});
