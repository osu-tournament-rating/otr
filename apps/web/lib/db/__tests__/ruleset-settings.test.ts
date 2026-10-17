import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { dbSchema } from '@otr/core/db';
import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  getBrowsingRuleset,
  getRulesetSettings,
  resolveBrowsingRuleset,
} from '../ruleset-settings';

describe('resolveBrowsingRuleset', () => {
  it('prefers the browsing setting to the ruleset played most', () => {
    expect(
      resolveBrowsingRuleset({
        browsingRuleset: Ruleset.Catch,
        mostPlayedRuleset: Ruleset.Osu,
      })
    ).toBe(Ruleset.Catch);
  });

  it('falls back to the ruleset played most', () => {
    expect(
      resolveBrowsingRuleset({
        browsingRuleset: null,
        mostPlayedRuleset: Ruleset.Mania4k,
      })
    ).toBe(Ruleset.Mania4k);
  });

  it('leaves a player with no verified tournaments to the page’s own default', () => {
    expect(
      resolveBrowsingRuleset({ browsingRuleset: null, mostPlayedRuleset: null })
    ).toBeNull();
    expect(
      resolveBrowsingRuleset({
        browsingRuleset: Ruleset.Taiko,
        mostPlayedRuleset: null,
      })
    ).toBe(Ruleset.Taiko);
  });

  it('leaves an unrated ruleset played most to the page’s own default', () => {
    expect(
      resolveBrowsingRuleset({
        browsingRuleset: null,
        mostPlayedRuleset: Ruleset.ManiaOther,
      })
    ).toBeNull();
  });
});

// Seeds and deletes rows; point it at a disposable database
const url = process.env.SEARCH_TEST_DATABASE_URL;

const TOURNAMENT_PREFIX = 'Ruleset settings 1080';

const players = [
  {
    osuId: 999_108_001,
    tournaments: [Ruleset.Taiko],
    settings: undefined,
    expected: {
      profileRuleset: null,
      browsingRuleset: null,
      mostPlayedRuleset: Ruleset.Taiko,
    },
    browsing: Ruleset.Taiko,
  },
  {
    osuId: 999_108_002,
    tournaments: [Ruleset.Osu],
    settings: {
      profileRuleset: Ruleset.Catch,
      browsingRuleset: Ruleset.Mania4k,
    },
    expected: {
      profileRuleset: Ruleset.Catch,
      browsingRuleset: Ruleset.Mania4k,
      mostPlayedRuleset: Ruleset.Osu,
    },
    browsing: Ruleset.Mania4k,
  },
  // The two settings are separate: a profile setting never moves the lists.
  {
    osuId: 999_108_003,
    tournaments: [Ruleset.Osu, Ruleset.Osu],
    settings: { profileRuleset: Ruleset.Mania7k, browsingRuleset: null },
    expected: {
      profileRuleset: Ruleset.Mania7k,
      browsingRuleset: null,
      mostPlayedRuleset: Ruleset.Osu,
    },
    browsing: Ruleset.Osu,
  },
  // No verified tournaments is not osu!: the lists keep their own defaults.
  {
    osuId: 999_108_004,
    tournaments: [],
    settings: undefined,
    expected: {
      profileRuleset: null,
      browsingRuleset: null,
      mostPlayedRuleset: null,
    },
    browsing: null,
  },
  {
    osuId: 999_108_005,
    tournaments: [],
    settings: { profileRuleset: null, browsingRuleset: Ruleset.Catch },
    expected: {
      profileRuleset: null,
      browsingRuleset: Ruleset.Catch,
      mostPlayedRuleset: null,
    },
    browsing: Ruleset.Catch,
  },
];

const osuIds = players.map((player) => player.osuId);

describe.skipIf(!url)('getRulesetSettings', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema: dbSchema });
  const playerIdByOsuId = new Map<number, number>();

  // users.player_id is NOT NULL but its foreign key sets null on delete, so
  // a player's users row has to go first. Its settings row cascades with it.
  const remove = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${TOURNAMENT_PREFIX}%`));
    await db
      .delete(schema.users)
      .where(
        inArray(
          schema.users.playerId,
          db
            .select({ id: schema.players.id })
            .from(schema.players)
            .where(inArray(schema.players.osuId, osuIds))
        )
      );
    await db
      .delete(schema.players)
      .where(inArray(schema.players.osuId, osuIds));
  };

  beforeAll(async () => {
    await remove();

    const inserted = await db
      .insert(schema.players)
      .values(
        players.map((player) => ({
          osuId: player.osuId,
          username: `rulesetsettings${player.osuId}`,
        }))
      )
      .returning({ id: schema.players.id, osuId: schema.players.osuId });
    for (const row of inserted) playerIdByOsuId.set(row.osuId, row.id);

    for (const player of players) {
      const playerId = playerIdByOsuId.get(player.osuId)!;

      if (player.settings) {
        const [user] = await db
          .insert(schema.users)
          .values({ playerId })
          .returning({ id: schema.users.id });
        await db
          .insert(schema.userSettings)
          .values({ userId: user.id, ...player.settings });
      }

      for (const [index, ruleset] of player.tournaments.entries()) {
        const name = `${TOURNAMENT_PREFIX} ${player.osuId} ${index}`;
        const [tournament] = await db
          .insert(schema.tournaments)
          .values({
            name,
            abbreviation: `RS1080-${player.osuId}-${index}`,
            forumUrl: `https://osu.ppy.sh/community/forums/topics/1080${player.osuId}${index}`,
            rankRangeLowerBound: 1,
            ruleset,
            lobbySize: 4,
            verificationStatus: VerificationStatus.Verified,
          })
          .returning({ id: schema.tournaments.id });
        await db.insert(schema.playerTournamentStats).values({
          playerId,
          tournamentId: tournament.id,
          averageRatingDelta: 0,
          averageMatchCost: 1,
          averageScore: 0,
          averagePlacement: 1,
          averageAccuracy: 1,
          matchesPlayed: 1,
          matchesWon: 0,
          matchesLost: 1,
          gamesPlayed: 1,
          gamesWon: 0,
          gamesLost: 1,
          teammateIds: [],
        });
      }
    }
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  for (const player of players) {
    it(`reads player ${player.osuId}'s settings and browsing ruleset`, async () => {
      const playerId = playerIdByOsuId.get(player.osuId)!;

      expect(await getRulesetSettings(db, playerId)).toEqual(player.expected);
      expect(await getBrowsingRuleset(db, playerId)).toBe(player.browsing);
    });
  }

  it('returns nothing for an unknown player or a visitor', async () => {
    expect(await getRulesetSettings(db, 2_000_000_000)).toBeNull();
    expect(await getBrowsingRuleset(db, null)).toBeNull();
  });
});
