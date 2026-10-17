import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { alias } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import { defaultRulesetSql, mostPlayedRulesetSql } from '../defaultRuleset';

// Seeds and deletes rows; point it at a disposable database
const url = process.env.SEARCH_TEST_DATABASE_URL;

const TOURNAMENT_PREFIX = 'Default ruleset 591';

type TournamentSeed = {
  ruleset: Ruleset;
  matchesPlayed: number;
  endTime?: string;
  startTime?: string;
  status?: VerificationStatus;
};

// `user` gives the player a users row, and `profileRuleset` a settings row
// on it. `expected` is the default ruleset; `mostPlayed` is the ruleset
// played most, when the two differ.
const cases: {
  label: string;
  osuId: number;
  tournaments: TournamentSeed[];
  user?: { profileRuleset?: Ruleset | null };
  expected: Ruleset;
  mostPlayed?: Ruleset;
}[] = [
  {
    label: 'more tournaments beat more matches',
    osuId: 999_591_001,
    tournaments: [
      { ruleset: Ruleset.Osu, matchesPlayed: 1 },
      { ruleset: Ruleset.Osu, matchesPlayed: 1 },
      { ruleset: Ruleset.Mania4k, matchesPlayed: 9 },
    ],
    expected: Ruleset.Osu,
  },
  {
    label: 'more matches break a tournament tie',
    osuId: 999_591_002,
    tournaments: [
      { ruleset: Ruleset.Taiko, matchesPlayed: 3 },
      { ruleset: Ruleset.Mania4k, matchesPlayed: 5 },
    ],
    expected: Ruleset.Mania4k,
  },
  {
    label: 'the most recent tournament breaks a match tie',
    osuId: 999_591_003,
    tournaments: [
      {
        ruleset: Ruleset.Mania4k,
        matchesPlayed: 2,
        endTime: '2020-01-01T00:00:00Z',
      },
      {
        ruleset: Ruleset.Mania7k,
        matchesPlayed: 2,
        endTime: '2021-01-01T00:00:00Z',
      },
    ],
    expected: Ruleset.Mania7k,
  },
  {
    label: 'the start time stands in for a missing end time',
    osuId: 999_591_004,
    tournaments: [
      {
        ruleset: Ruleset.Mania4k,
        matchesPlayed: 2,
        endTime: '2020-01-01T00:00:00Z',
      },
      {
        ruleset: Ruleset.Mania7k,
        matchesPlayed: 2,
        startTime: '2020-06-01T00:00:00Z',
      },
    ],
    expected: Ruleset.Mania7k,
  },
  {
    label: 'the lowest ruleset breaks a full tie',
    osuId: 999_591_005,
    tournaments: [
      {
        ruleset: Ruleset.Mania7k,
        matchesPlayed: 2,
        endTime: '2020-01-01T00:00:00Z',
      },
      {
        ruleset: Ruleset.Mania4k,
        matchesPlayed: 2,
        endTime: '2020-01-01T00:00:00Z',
      },
    ],
    expected: Ruleset.Mania4k,
  },
  {
    label: 'only verified tournaments count',
    osuId: 999_591_006,
    tournaments: [
      {
        ruleset: Ruleset.Mania7k,
        matchesPlayed: 10,
        status: VerificationStatus.Rejected,
      },
      {
        ruleset: Ruleset.Mania7k,
        matchesPlayed: 10,
        status: VerificationStatus.Rejected,
      },
      {
        ruleset: Ruleset.Mania7k,
        matchesPlayed: 10,
        status: VerificationStatus.PreVerified,
      },
      { ruleset: Ruleset.Taiko, matchesPlayed: 1 },
    ],
    expected: Ruleset.Taiko,
  },
  {
    label: 'a player with no verified tournaments gets osu!',
    osuId: 999_591_007,
    tournaments: [],
    expected: Ruleset.Osu,
  },
  {
    label: 'ManiaOther tournaments count',
    osuId: 999_591_008,
    tournaments: [
      { ruleset: Ruleset.ManiaOther, matchesPlayed: 1 },
      { ruleset: Ruleset.ManiaOther, matchesPlayed: 1 },
      { ruleset: Ruleset.Osu, matchesPlayed: 5 },
    ],
    expected: Ruleset.ManiaOther,
  },
  {
    label: 'a profile setting beats the ruleset played most',
    osuId: 999_591_009,
    tournaments: [
      { ruleset: Ruleset.Osu, matchesPlayed: 1 },
      { ruleset: Ruleset.Osu, matchesPlayed: 1 },
    ],
    user: { profileRuleset: Ruleset.Catch },
    expected: Ruleset.Catch,
    mostPlayed: Ruleset.Osu,
  },
  {
    label: 'a profile setting applies with no verified tournaments',
    osuId: 999_591_010,
    tournaments: [],
    user: { profileRuleset: Ruleset.Mania7k },
    expected: Ruleset.Mania7k,
    mostPlayed: Ruleset.Osu,
  },
  {
    label: 'a settings row without a profile setting falls back',
    osuId: 999_591_011,
    tournaments: [{ ruleset: Ruleset.Taiko, matchesPlayed: 1 }],
    user: { profileRuleset: null },
    expected: Ruleset.Taiko,
  },
  {
    label: 'a user with no settings row falls back',
    osuId: 999_591_012,
    tournaments: [{ ruleset: Ruleset.Mania4k, matchesPlayed: 1 }],
    user: {},
    expected: Ruleset.Mania4k,
  },
];

const osuIds = cases.map((testCase) => testCase.osuId);
const expectedByOsuId = new Map(
  cases.map((testCase) => [testCase.osuId, testCase.expected])
);
const mostPlayedByOsuId = new Map(
  cases.map((testCase) => [
    testCase.osuId,
    testCase.mostPlayed ?? testCase.expected,
  ])
);
const userOsuIds = cases
  .filter((testCase) => testCase.user)
  .map((testCase) => testCase.osuId);
const ALL_RULESETS = [
  Ruleset.Osu,
  Ruleset.Taiko,
  Ruleset.Catch,
  Ruleset.ManiaOther,
  Ruleset.Mania4k,
  Ruleset.Mania7k,
];

describe.skipIf(!url)('defaultRulesetSql', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  const osuIdByPlayerId = new Map<number, number>();
  let playerIds: number[] = [];

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

  const byOsuId = (rows: { id: number; defaultRuleset: Ruleset }[]) =>
    new Map(
      rows.map((row) => [osuIdByPlayerId.get(row.id), row.defaultRuleset])
    );

  beforeAll(async () => {
    await remove();

    const players = await db
      .insert(schema.players)
      .values(
        cases.map((testCase) => ({
          osuId: testCase.osuId,
          username: `defaultruleset${testCase.osuId}`,
        }))
      )
      .returning({ id: schema.players.id, osuId: schema.players.osuId });

    for (const player of players) {
      osuIdByPlayerId.set(player.id, player.osuId);
    }
    playerIds = players.map((player) => player.id);

    const playerIdByOsuId = new Map(
      players.map((player) => [player.osuId, player.id])
    );

    const users = await db
      .insert(schema.users)
      .values(
        userOsuIds.map((osuId) => ({ playerId: playerIdByOsuId.get(osuId)! }))
      )
      .returning({ id: schema.users.id, playerId: schema.users.playerId });

    const settings = cases.flatMap((testCase) => {
      if (!testCase.user || !('profileRuleset' in testCase.user)) {
        return [];
      }
      const playerId = playerIdByOsuId.get(testCase.osuId);
      const user = users.find((row) => row.playerId === playerId)!;
      return [
        { userId: user.id, profileRuleset: testCase.user.profileRuleset },
      ];
    });

    await db.insert(schema.userSettings).values(settings);

    const seeds = cases.flatMap((testCase) =>
      testCase.tournaments.map((tournament) => ({
        ...tournament,
        playerId: players.find((player) => player.osuId === testCase.osuId)!.id,
      }))
    );

    const tournaments = await db
      .insert(schema.tournaments)
      .values(
        seeds.map((seed, index) => ({
          name: `${TOURNAMENT_PREFIX} ${index}`,
          abbreviation: `DR591-${index}`,
          forumUrl: `https://osu.ppy.sh/community/forums/topics/591${index}`,
          rankRangeLowerBound: 1,
          ruleset: seed.ruleset,
          lobbySize: 4,
          verificationStatus: seed.status ?? VerificationStatus.Verified,
          startTime: seed.startTime ?? null,
          endTime: seed.endTime ?? null,
        }))
      )
      .returning({ id: schema.tournaments.id, name: schema.tournaments.name });

    await db.insert(schema.playerTournamentStats).values(
      seeds.map((seed, index) => ({
        playerId: seed.playerId,
        tournamentId: tournaments.find(
          (tournament) => tournament.name === `${TOURNAMENT_PREFIX} ${index}`
        )!.id,
        averageRatingDelta: 0,
        averageMatchCost: 1,
        averageScore: 0,
        averagePlacement: 1,
        averageAccuracy: 1,
        matchesPlayed: seed.matchesPlayed,
        matchesWon: 0,
        matchesLost: seed.matchesPlayed,
        gamesPlayed: seed.matchesPlayed,
        gamesWon: 0,
        gamesLost: seed.matchesPlayed,
        teammateIds: [],
      }))
    );

    // One rating per ruleset, so a joined rating names the ruleset it matched
    await db.insert(schema.playerRatings).values(
      playerIds.flatMap((playerId) =>
        ALL_RULESETS.map((ruleset) => ({
          playerId,
          ruleset,
          rating: 1000 + ruleset,
          volatility: 100,
          percentile: 0.5,
          globalRank: 1,
          countryRank: 1,
        }))
      )
    );
  });

  afterAll(async () => {
    await remove();
    await pool.end();
  });

  // Drizzle drops table names from a single-table select's fields, where a raw
  // `sql` subquery would match on `"player_id" = "id"`
  it('resolves each player in a single-table select', async () => {
    const rows = await db
      .select({
        id: schema.players.id,
        defaultRuleset: defaultRulesetSql(schema.players.id),
      })
      .from(schema.players)
      .where(inArray(schema.players.id, playerIds));

    expect(byOsuId(rows)).toEqual(expectedByOsuId);
  });

  it('resolves each player through an aliased, joined players table', async () => {
    const player = alias(schema.players, 'joined_player');
    const rows = await db
      .select({
        id: player.id,
        defaultRuleset: defaultRulesetSql(player.id),
      })
      .from(schema.playerRatings)
      .innerJoin(player, eq(player.id, schema.playerRatings.playerId))
      .where(
        and(
          eq(schema.playerRatings.ruleset, Ruleset.Osu),
          inArray(player.id, playerIds)
        )
      );

    expect(byOsuId(rows)).toEqual(expectedByOsuId);
  });

  it('ignores the profile setting in the ruleset played most', async () => {
    const rows = await db
      .select({
        id: schema.players.id,
        defaultRuleset: mostPlayedRulesetSql(schema.players.id),
      })
      .from(schema.players)
      .where(inArray(schema.players.id, playerIds));

    expect(byOsuId(rows)).toEqual(mostPlayedByOsuId);
  });

  // Admin notes select from an unaliased users table joined to players. The
  // settings subquery's own users table must not capture the caller's.
  it('resolves through a caller that joins unaliased users', async () => {
    const rows = await db
      .select({
        id: schema.players.id,
        fromPlayer: defaultRulesetSql(schema.players.id),
        fromUser: defaultRulesetSql(schema.users.playerId),
      })
      .from(schema.users)
      .innerJoin(schema.players, eq(schema.players.id, schema.users.playerId))
      .where(inArray(schema.players.id, playerIds));

    const expected = new Map<number | undefined, Ruleset>(
      userOsuIds.map((osuId) => [osuId, expectedByOsuId.get(osuId)!])
    );
    expect(
      byOsuId(
        rows.map((row) => ({ id: row.id, defaultRuleset: row.fromPlayer }))
      )
    ).toEqual(expected);
    expect(
      byOsuId(rows.map((row) => ({ id: row.id, defaultRuleset: row.fromUser })))
    ).toEqual(expected);
  });

  it('joins the rating of each player’s default ruleset', async () => {
    const rows = await db
      .select({
        id: schema.players.id,
        rating: schema.playerRatings.rating,
      })
      .from(schema.players)
      .leftJoin(
        schema.playerRatings,
        and(
          eq(schema.playerRatings.playerId, schema.players.id),
          eq(schema.playerRatings.ruleset, defaultRulesetSql(schema.players.id))
        )
      )
      .where(inArray(schema.players.id, playerIds));

    expect(
      byOsuId(
        rows.map((row) => ({
          id: row.id,
          defaultRuleset: (row.rating! - 1000) as Ruleset,
        }))
      )
    ).toEqual(expectedByOsuId);
  });
});
