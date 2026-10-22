import { describe, expect, it } from 'bun:test';
import { Team, VerificationStatus } from '@otr/core/osu';

import { seriesColor } from '@/lib/kit/color/categorical';
import type { Game, MatchDetail, MatchPlayer } from '@/lib/orpc/schema/match';
import {
  calculateHighlightStats,
  formatAverage,
  formatMatchCost,
  processMatchStatistics,
} from '../MatchStatsUtils';
import {
  buildPlayerScoreChartData,
  buildTeamScoreChartData,
} from '../MatchTeamScoresChart';

function createMatch(): MatchDetail {
  return {
    players: [
      {
        id: 10,
        osuId: 100,
        username: 'Red player',
      },
      {
        id: 20,
        osuId: 200,
        username: 'Blue player',
      },
    ],
    playerMatchStats: [
      {
        id: 1,
        playerId: 10,
        matchId: 50,
        won: false,
        gamesWon: 6,
        gamesLost: 7,
        gamesPlayed: 13,
        averageScore: 400_000,
        averageAccuracy: 0.97,
        averageMisses: 3,
        averagePlacement: 1.8,
        matchCost: 1.1,
        teammateIds: [],
        opponentIds: [20],
      },
      {
        id: 2,
        playerId: 20,
        matchId: 50,
        won: true,
        gamesWon: 7,
        gamesLost: 6,
        gamesPlayed: 13,
        averageScore: 425_000,
        averageAccuracy: 0.95,
        averageMisses: 4,
        averagePlacement: 1.6,
        matchCost: 1.3,
        teammateIds: [],
        opponentIds: [10],
      },
    ],
    ratingAdjustments: [
      {
        playerId: 10,
        ratingBefore: 1_400,
        ratingAfter: 1_410,
        ratingDelta: 10,
        volatilityBefore: 100,
        volatilityAfter: 95,
        volatilityDelta: -5,
      },
      {
        playerId: 20,
        ratingBefore: 1_490,
        ratingAfter: 1_500,
        ratingDelta: 10,
        volatilityBefore: 90,
        volatilityAfter: 85,
        volatilityDelta: -5,
      },
    ],
    rosters: [
      { id: 1, roster: [10], team: Team.Red, score: 6 },
      { id: 2, roster: [20], team: Team.Blue, score: 7 },
    ],
    winRecord: {
      matchId: 50,
      isTied: false,
      loserRoster: [10],
      winnerRoster: [20],
      loserPoints: 6,
      winnerPoints: 7,
      loserTeam: Team.Red,
      winnerTeam: Team.Blue,
    },
    games: [
      { verificationStatus: VerificationStatus.PreVerified },
      { verificationStatus: VerificationStatus.Verified },
    ],
  } as unknown as MatchDetail;
}

describe('match statistics processing', () => {
  it('joins player, rating, match cost, and roster team data', () => {
    const match = createMatch();
    const players = processMatchStatistics(match, match.players);

    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({
      playerId: 10,
      team: 'red',
      matchCost: 1.1,
      won: false,
      ratingBefore: 1_400,
      ratingAfter: 1_410,
      ratingDelta: 10,
    });
    expect(players[1]).toMatchObject({
      playerId: 20,
      team: 'blue',
      matchCost: 1.3,
      won: true,
    });
  });

  it('builds a stable six-card summary from verified match data', () => {
    const match = createMatch();
    const players = processMatchStatistics(match, match.players);
    const summary = calculateHighlightStats(players, match);

    expect(summary).toHaveLength(6);
    expect(summary[0]).toMatchObject({
      id: 'match-result',
      value: '6–7',
      sublabel: 'Blue wins',
    });
    expect(summary.find((stat) => stat.id === 'rated-games')?.value).toBe('1');
    expect(summary.find((stat) => stat.id === 'average-rating')).toMatchObject({
      label: 'Average rating',
      value: '1,455',
      icon: 'TrendingUp',
    });
    expect(summary.find((stat) => stat.id === 'match-cost')).toMatchObject({
      value: '1.30',
      player: { id: 20, username: 'Blue player' },
    });
  });

  it('does not invent a winner when no usable win record exists', () => {
    const match = createMatch();
    match.winRecord = null;
    match.rosters = [{ id: 1, roster: [10, 20], team: Team.NoTeam, score: 13 }];
    match.playerMatchStats = match.playerMatchStats.map((stats) => ({
      ...stats,
      won: true,
      gamesWon: stats.gamesPlayed,
      gamesLost: 0,
    }));

    const players = processMatchStatistics(match, match.players);
    const summary = calculateHighlightStats(players, match);

    expect(players.every((player) => !player.won)).toBe(true);
    expect(summary[0]).toMatchObject({
      value: '—',
      sublabel: 'Result unavailable',
    });
  });

  it('does not label tied players as winners', () => {
    const match = createMatch();
    match.winRecord = {
      ...match.winRecord!,
      isTied: true,
      winnerRoster: [10, 20],
      winnerPoints: 6,
      loserPoints: 6,
    };

    const players = processMatchStatistics(match, match.players);
    const summary = calculateHighlightStats(players, match);

    expect(players.every((player) => !player.won)).toBe(true);
    expect(summary[0].sublabel).toBe('Draw');
  });
});

describe('team score chart data', () => {
  it('uses only verified games and scores while preserving game numbering', () => {
    const games = [
      {
        verificationStatus: VerificationStatus.PreVerified,
        scores: [],
      },
      {
        verificationStatus: VerificationStatus.Verified,
        scores: [
          {
            team: Team.Red,
            score: 400_000,
            verificationStatus: VerificationStatus.Verified,
          },
          {
            team: Team.Red,
            score: 999_999,
            verificationStatus: VerificationStatus.Rejected,
          },
          {
            team: Team.Blue,
            score: 350_000,
            verificationStatus: VerificationStatus.Verified,
          },
        ],
        beatmap: null,
        mods: 0,
      },
      {
        verificationStatus: VerificationStatus.Verified,
        scores: [
          {
            team: Team.NoTeam,
            score: 500_000,
            verificationStatus: VerificationStatus.Verified,
          },
        ],
        beatmap: null,
        mods: 0,
      },
    ] as unknown as Game[];

    expect(buildTeamScoreChartData(games)).toEqual([
      {
        mapNumber: 2,
        mapLabel: '2',
        redScore: 400_000,
        blueScore: 350_000,
        winner: 'red',
        beatmapTitle: 'Unknown title',
        beatmapArtist: 'Unknown artist',
        beatmapDifficulty: 'Unknown difficulty',
        mods: 'NM',
        scoreDifference: 50_000,
      },
    ]);
  });
});

describe('1v1 match statistics', () => {
  // The same match from a 1v1 tournament. Its stored red and blue may be
  // o!TR's own, from converting a head-to-head lobby.
  const oneVsOne = () =>
    ({
      ...createMatch(),
      tournament: { lobbySize: 1 },
    }) as unknown as MatchDetail;

  it('names the winner and gives the players no team', () => {
    const match = oneVsOne();
    const players = processMatchStatistics(match, match.players);
    const [result] = calculateHighlightStats(players, match);

    expect(players.map((player) => player.team)).toEqual([
      undefined,
      undefined,
    ]);
    expect(result).toMatchObject({
      value: '7–6',
      sublabel: 'Blue player wins',
    });
  });

  it('charts each player’s verified scores, with no team', () => {
    const players = [
      { id: 10, username: 'Menty' },
      { id: 20, username: 'LINKI' },
    ] as MatchPlayer[];
    const games = [
      {
        verificationStatus: VerificationStatus.Verified,
        scores: [
          {
            playerId: 10,
            team: Team.NoTeam,
            score: 400_000,
            verificationStatus: VerificationStatus.Verified,
          },
          {
            playerId: 20,
            team: Team.NoTeam,
            score: 350_000,
            verificationStatus: VerificationStatus.Verified,
          },
          {
            playerId: 30,
            team: Team.NoTeam,
            score: 0,
            verificationStatus: VerificationStatus.Rejected,
          },
        ],
        beatmap: null,
        mods: 0,
      },
    ] as unknown as Game[];

    const { points, series } = buildPlayerScoreChartData(games, players);

    // In name order, so a colour never follows the result.
    expect(series).toEqual([
      { key: 'player-20', label: 'LINKI', color: seriesColor(0) },
      { key: 'player-10', label: 'Menty', color: seriesColor(1) },
    ]);
    expect(points).toEqual([
      {
        mapNumber: 1,
        beatmapTitle: 'Unknown title',
        beatmapArtist: 'Unknown artist',
        beatmapDifficulty: 'Unknown difficulty',
        mods: 'NM',
        'player-10': 400_000,
        'player-20': 350_000,
        winner: 'player-10',
        result: 'Menty wins by 50,000',
      },
    ]);
  });
});

describe('stat formatting', () => {
  it('writes match costs with two decimals and averages with one', () => {
    expect(formatMatchCost(1.3)).toBe('1.30');
    expect(formatMatchCost(1.305)).toBe('1.31');
    expect(formatAverage(8.24)).toBe('8.2');
    expect(formatAverage(1_234.56)).toBe('1,234.6');
  });

  it('labels the summary in sentence case', () => {
    const match = createMatch();
    const players = processMatchStatistics(match, match.players);
    const labels = calculateHighlightStats(players, match).map(
      (stat) => stat.label
    );

    expect(labels).toEqual([
      'Match result',
      'Players',
      'Rated games',
      'Average rating',
      'Top match cost',
      'Top accuracy',
    ]);
  });
});
