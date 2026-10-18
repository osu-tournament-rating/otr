import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, eq, gte, like, lt } from 'drizzle-orm';
import type { UserStatUpdate } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import {
  createTestDb,
  silentLogger,
} from '../../beatmap-attributes/__tests__/db-fixtures';
import {
  pickRelevantStatUpdate,
  processOsuTrackPlayerResults,
} from '../persistence';

// The `checks` job in .github/workflows/ci.yml sets this.
const url = process.env.SEARCH_TEST_DATABASE_URL;

const createUpdate = (
  timestamp: string,
  overrides: Partial<UserStatUpdate> = {}
): UserStatUpdate => ({
  count300: 0,
  count100: 0,
  count50: 0,
  playCount: 0,
  rankedScore: 0,
  totalScore: 0,
  rank: 100,
  level: 0,
  pp: 0,
  accuracy: 0,
  countSs: 0,
  countS: 0,
  countA: 0,
  timestamp: new Date(timestamp),
  ...overrides,
});

describe('pickRelevantStatUpdate', () => {
  it('returns null when updates array is empty', () => {
    expect(pickRelevantStatUpdate([], null)).toBeNull();
  });

  it('returns earliest entry when earliest match date is unavailable', () => {
    const updates = [
      createUpdate('2024-05-02T00:00:00.000Z', { rank: 50 }),
      createUpdate('2024-05-01T00:00:00.000Z', { rank: 25 }),
    ];

    const selected = pickRelevantStatUpdate(updates, null);

    expect(selected?.rank).toBe(25);
    expect(selected?.timestamp.toISOString()).toBe('2024-05-01T00:00:00.000Z');
  });

  it('returns update closest to earliest verified match date', () => {
    const updates = [
      createUpdate('2024-05-01T00:00:00.000Z', { rank: 25 }),
      createUpdate('2024-05-05T00:00:00.000Z', { rank: 10 }),
      createUpdate('2024-05-03T00:00:00.000Z', { rank: 15 }),
    ];

    const earliestMatch = new Date('2024-05-04T00:00:00.000Z');

    const selected = pickRelevantStatUpdate(updates, earliestMatch);

    expect(selected?.rank).toBe(10);
    expect(selected?.timestamp.toISOString()).toBe('2024-05-05T00:00:00.000Z');
  });
});

// Far above any real osu! id and clear of other test files' ranges.
const SEED_OSU_ID_BASE = 90_000_100_000;
const SEED_OSU_ID_END = SEED_OSU_ID_BASE + 10_000;
const TOURNAMENT_PREFIX = 'osu!track alignment test';

describe.skipIf(!url)('processOsuTrackPlayerResults', () => {
  const { pool, db } = createTestDb(url!);
  const playerOsuId = SEED_OSU_ID_BASE;
  let nextOsuId = SEED_OSU_ID_BASE + 1;
  let ranks: Map<number, number | null>;

  const removeSeed = async () => {
    await db
      .delete(schema.tournaments)
      .where(like(schema.tournaments.name, `${TOURNAMENT_PREFIX} #%`));
    await db
      .delete(schema.players)
      .where(
        and(
          gte(schema.players.osuId, SEED_OSU_ID_BASE),
          lt(schema.players.osuId, SEED_OSU_ID_END)
        )
      );
  };

  const playedMatch = async (
    playerId: number,
    ruleset: Ruleset,
    startTime: string,
    matchStatus = VerificationStatus.Verified
  ) => {
    const osuId = nextOsuId++;
    const [tournament] = await db
      .insert(schema.tournaments)
      .values({
        name: `${TOURNAMENT_PREFIX} #${osuId}`,
        abbreviation: `OTA${osuId % 10_000}`,
        forumUrl: `https://osu.ppy.sh/community/forums/topics/${osuId}`,
        rankRangeLowerBound: 1,
        ruleset,
        lobbySize: 4,
        verificationStatus: VerificationStatus.Verified,
      })
      .returning({ id: schema.tournaments.id });
    const [match] = await db
      .insert(schema.matches)
      .values({
        osuId,
        tournamentId: tournament!.id,
        startTime,
        verificationStatus: matchStatus,
      })
      .returning({ id: schema.matches.id });
    const [game] = await db
      .insert(schema.games)
      .values({
        osuId,
        ruleset,
        scoringType: 3,
        teamType: 0,
        mods: 0,
        matchId: match!.id,
        verificationStatus: matchStatus,
      })
      .returning({ id: schema.games.id });
    await db.insert(schema.gameScores).values({
      rawScore: 500_000,
      placement: 1,
      accuracy: 0.95,
      maxCombo: 100,
      pass: true,
      isPerfectCombo: false,
      legacyPerfect: false,
      grade: 2,
      mods: 0,
      team: 0,
      ruleset,
      verificationStatus: matchStatus,
      rejectionReason: 0,
      legacyTotalScore: 500_000,
      gameId: game!.id,
      playerId,
    });
  };

  beforeAll(async () => {
    await removeSeed();

    const [player] = await db
      .insert(schema.players)
      .values({ osuId: playerOsuId, username: `align-${playerOsuId}` })
      .returning({ id: schema.players.id });
    const playerId = player!.id;

    await db
      .insert(schema.playerOsuRulesetData)
      .values(
        [
          Ruleset.Osu,
          Ruleset.Taiko,
          Ruleset.Catch,
          Ruleset.ManiaOther,
          Ruleset.Mania4k,
          Ruleset.Mania7k,
        ].map((ruleset) => ({ playerId, ruleset, pp: 0, globalRank: 1 }))
      );

    // Taiko from 2018 and osu! from 2022, as in the issue. The rejected 2018
    // osu! match must not count.
    await playedMatch(playerId, Ruleset.Taiko, '2018-03-01T00:00:00.000Z');
    await playedMatch(playerId, Ruleset.Osu, '2022-06-01T00:00:00.000Z');
    await playedMatch(
      playerId,
      Ruleset.Osu,
      '2018-03-01T00:00:00.000Z',
      VerificationStatus.Rejected
    );
    await playedMatch(playerId, Ruleset.Mania4k, '2019-01-01T00:00:00.000Z');
    await playedMatch(playerId, Ruleset.Mania7k, '2023-01-01T00:00:00.000Z');

    const history = (rank2018: number, rank2022: number): UserStatUpdate[] => [
      createUpdate('2018-03-02T00:00:00.000Z', { rank: rank2018 }),
      createUpdate('2019-01-02T00:00:00.000Z', { rank: rank2018 + 1 }),
      createUpdate('2022-06-02T00:00:00.000Z', { rank: rank2022 }),
      createUpdate('2023-01-02T00:00:00.000Z', { rank: rank2022 + 1 }),
    ];

    await processOsuTrackPlayerResults({
      db,
      logger: silentLogger,
      osuPlayerId: playerOsuId,
      results: [
        { mode: 0, updates: history(50_000, 9_000) },
        { mode: 1, updates: history(300, 100) },
        // Catch is never played, so its rank follows the first match in any ruleset.
        {
          mode: 2,
          updates: [
            createUpdate('2014-01-01T00:00:00.000Z', { rank: 30_000 }),
            ...history(7_000, 2_000),
          ],
        },
        { mode: 3, updates: history(4_000, 800) },
      ],
    });

    const rows = await db
      .select({
        ruleset: schema.playerOsuRulesetData.ruleset,
        rank: schema.playerOsuRulesetData.earliestGlobalRank,
      })
      .from(schema.playerOsuRulesetData)
      .where(eq(schema.playerOsuRulesetData.playerId, playerId));
    ranks = new Map(rows.map((row) => [row.ruleset, row.rank]));
  });

  afterAll(async () => {
    await removeSeed();
    await pool.end();
  });

  it.each([
    ['osu! from its own first verified match', Ruleset.Osu, 9_000],
    ['taiko from its own first verified match', Ruleset.Taiko, 300],
    [
      'an unplayed ruleset from the first match in any ruleset',
      Ruleset.Catch,
      7_000,
    ],
    ['mania 4K from its own first match', Ruleset.Mania4k, 4_001],
    ['mania 7K from its own first match', Ruleset.Mania7k, 801],
    [
      'overall mania from the first match in any variant',
      Ruleset.ManiaOther,
      4_001,
    ],
  ])('aligns %s', (_, ruleset, rank) => {
    expect(ranks.get(ruleset)).toBe(rank);
  });
});
