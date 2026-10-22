import { describe, expect, it } from 'bun:test';
import { Ruleset, Team, VerificationStatus } from '@otr/core/osu';

import { TournamentStatsCalculator } from '../tournament-stats-calculator';
import type {
  StatsCalculationSuccess,
  StatsGame,
  StatsMatch,
  StatsScore,
  StatsTournament,
} from '../types';

type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

const createVerifiedTournament = (): StatsTournament => ({
  id: 1,
  verificationStatus: VerificationStatus.Verified,
  matches: [
    {
      id: 10,
      verificationStatus: VerificationStatus.Verified,
      games: [
        {
          id: 100,
          matchId: 10,
          verificationStatus: VerificationStatus.Verified,
          rosters: [],
          scores: [
            {
              id: 1,
              gameId: 100,
              playerId: 1,
              score: 100_000,
              placement: 1,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Red,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 2,
              gameId: 100,
              playerId: 2,
              score: 95_000,
              placement: 2,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Red,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 3,
              gameId: 100,
              playerId: 3,
              score: 90_000,
              placement: 3,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Blue,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 4,
              gameId: 100,
              playerId: 4,
              score: 85_000,
              placement: 4,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Blue,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
          ],
        },
        {
          id: 101,
          matchId: 10,
          verificationStatus: VerificationStatus.Verified,
          rosters: [],
          scores: [
            {
              id: 5,
              gameId: 101,
              playerId: 1,
              score: 102_000,
              placement: 1,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Red,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 6,
              gameId: 101,
              playerId: 2,
              score: 94_000,
              placement: 2,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Red,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 7,
              gameId: 101,
              playerId: 3,
              score: 88_000,
              placement: 3,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Blue,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
            {
              id: 8,
              gameId: 101,
              playerId: 4,
              score: 87_000,
              placement: 4,
              accuracy: 100.0,
              statMeh: 0,
              statOk: 0,
              statGreat: 300,
              statMiss: 0,
              statGood: null,
              statPerfect: null,
              team: Team.Blue,
              ruleset: Ruleset.Osu,
              verificationStatus: VerificationStatus.Verified,
            },
          ],
        },
      ],
      playerRatingAdjustments: [
        { id: 1000, playerId: 1, ratingBefore: 1000, ratingAfter: 1010 },
        { id: 1001, playerId: 2, ratingBefore: 1000, ratingAfter: 1005 },
        { id: 1002, playerId: 3, ratingBefore: 1000, ratingAfter: 995 },
        { id: 1003, playerId: 4, ratingBefore: 1000, ratingAfter: 990 },
      ],
    },
  ],
});

/** A verified score worth `value`; the stats under test ignore the rest. */
const score = (
  gameId: number,
  playerId: number,
  team: Team,
  value: number,
  verificationStatus = VerificationStatus.Verified
): StatsScore => ({
  id: gameId * 100 + playerId,
  gameId,
  playerId,
  score: value,
  placement: 1,
  accuracy: 100,
  statMeh: 0,
  statOk: 0,
  statGreat: 300,
  statMiss: 0,
  statGood: null,
  statPerfect: null,
  team,
  ruleset: Ruleset.Osu,
  verificationStatus,
});

const game = (
  id: number,
  matchId: number,
  scores: StatsScore[],
  verificationStatus = VerificationStatus.Verified
): StatsGame => ({ id, matchId, verificationStatus, rosters: [], scores });

/** A verified match in which each of `playerIds` has a rating change. */
const match = (
  id: number,
  games: StatsGame[],
  playerIds: number[]
): StatsMatch => ({
  id,
  verificationStatus: VerificationStatus.Verified,
  games,
  playerRatingAdjustments: playerIds.map((playerId) => ({
    id: id * 100 + playerId,
    playerId,
    ratingBefore: 1000,
    ratingAfter: 1010,
  })),
});

const tournamentOf = (...matches: StatsMatch[]): StatsTournament => ({
  id: 1,
  verificationStatus: VerificationStatus.Verified,
  matches,
});

const calculate = (tournament: StatsTournament) => {
  const result = new TournamentStatsCalculator().calculateAllStatistics(
    tournament
  );
  if (!result.success) {
    throw new Error(`Expected success, got: ${result.errorMessage}`);
  }
  return result;
};

const playerMatchStat = (
  result: StatsCalculationSuccess,
  matchId: number,
  playerId: number
) => {
  const stat = result.matches
    .find((entry) => entry.matchId === matchId)
    ?.playerMatchStats.find((entry) => entry.playerId === playerId);
  if (!stat) {
    throw new Error(`No stats for player ${playerId} in match ${matchId}`);
  }
  return stat;
};

const playerTournamentStat = (
  result: StatsCalculationSuccess,
  playerId: number
) => {
  const stat = result.playerTournamentStats.find(
    (entry) => entry.playerId === playerId
  );
  if (!stat) {
    throw new Error(`No tournament stats for player ${playerId}`);
  }
  return stat;
};

describe('TournamentStatsCalculator', () => {
  it('calculates statistics for verified tournaments', () => {
    const calculator = new TournamentStatsCalculator();
    const tournament = createVerifiedTournament();

    const result = calculator.calculateAllStatistics(tournament);
    expect(result.success).toBe(true);

    if (!result.success) {
      return;
    }

    expect(result.verifiedMatchesCount).toBe(1);
    expect(result.playerMatchStatsCount).toBe(4);
    expect(result.playerTournamentStatsCount).toBe(4);

    const [matchResult] = result.matches;
    expect(matchResult.matchRosters).toHaveLength(2);
    const redRoster = matchResult.matchRosters.find(
      (roster) => roster.team === Team.Red
    );
    expect(redRoster?.score).toBe(2);
    expect(redRoster?.roster).toEqual([1, 2]);

    const playerOneStats = matchResult.playerMatchStats.find(
      (stat) => stat.playerId === 1
    );
    expect(playerOneStats).toBeDefined();
    expect(playerOneStats?.won).toBe(true);
    expect(playerOneStats?.gamesPlayed).toBe(2);
    expect(playerOneStats?.gamesWon).toBe(2);
    expect(playerOneStats?.teammateIds).toEqual([2]);
    expect(playerOneStats?.opponentIds.sort()).toEqual([3, 4]);

    const playerTournamentStats = result.playerTournamentStats.find(
      (stat) => stat.playerId === 1
    );
    expect(playerTournamentStats).toBeDefined();
    expect(playerTournamentStats?.matchesPlayed).toBe(1);
    expect(playerTournamentStats?.matchesWon).toBe(1);
    expect(playerTournamentStats?.matchWinRate).toBeCloseTo(1);
    expect(playerTournamentStats?.averageRatingDelta).toBeCloseTo(10);
  });

  it('fails when tournament is not verified', () => {
    const calculator = new TournamentStatsCalculator();
    const tournament: Mutable<StatsTournament> = createVerifiedTournament();
    tournament.verificationStatus = VerificationStatus.PreVerified;

    const result = calculator.calculateAllStatistics(tournament);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.errorMessage).toContain('is not verified');
  });

  it('skips a match without verified games and counts the rest', () => {
    const tournament = createVerifiedTournament();
    // Players 5 and 6 play only this match, whose one game is not verified.
    tournament.matches.push(
      match(
        11,
        [
          game(
            110,
            11,
            [score(110, 5, Team.Red, 500_000), score(110, 6, Team.Blue, 1)],
            VerificationStatus.PreVerified
          ),
        ],
        [5, 6]
      )
    );

    const result = calculate(tournament);

    expect(result.matches.map((entry) => entry.matchId)).toEqual([10]);
    expect(result.skippedMatchIds).toEqual([11]);
    expect(
      result.playerTournamentStats.map((stat) => stat.playerId).sort()
    ).toEqual([1, 2, 3, 4]);
  });

  it('skips a match without rating changes and counts the rest', () => {
    const tournament = createVerifiedTournament();
    // The rating run skips a match whose games all have one verified score.
    const unrated = match(
      11,
      [game(110, 11, [score(110, 5, Team.Red, 500_000)])],
      []
    );
    tournament.matches.push(unrated);

    const result = calculate(tournament);

    expect(result.matches.map((entry) => entry.matchId)).toEqual([10]);
    expect(result.skippedMatchIds).toEqual([11]);
    expect(playerTournamentStat(result, 1).matchesPlayed).toBe(1);
  });

  it('fails when no verified match can be counted', () => {
    const tournament = createVerifiedTournament();
    tournament.matches[0]!.playerRatingAdjustments = [];

    const result = new TournamentStatsCalculator().calculateAllStatistics(
      tournament
    );

    expect(result.success).toBe(false);
  });

  it('skips a verified game without verified scores and counts the match', () => {
    // An aborted lobby: verified with the rest of the match, but empty.
    const tournament = tournamentOf(
      match(
        10,
        [
          game(100, 10, [
            score(100, 1, Team.Red, 600_000),
            score(100, 2, Team.Blue, 400_000),
          ]),
          game(101, 10, []),
        ],
        [1, 2]
      )
    );

    const result = calculate(tournament);

    const [matchResult] = result.matches;
    expect(matchResult!.gameRosters.map((entry) => entry.gameId)).toEqual([
      100,
    ]);
    expect(playerMatchStat(result, 10, 1)).toMatchObject({
      gamesPlayed: 1,
      gamesWon: 1,
      won: true,
    });
  });

  it('gives a tied game to neither team', () => {
    // Blue's score comes first in the tied game, as the database may return it.
    const tournament = tournamentOf(
      match(
        10,
        [
          game(100, 10, [
            score(100, 2, Team.Blue, 1_000_000),
            score(100, 1, Team.Red, 1_000_000),
          ]),
          game(101, 10, [
            score(101, 1, Team.Red, 600_000),
            score(101, 2, Team.Blue, 400_000),
          ]),
        ],
        [1, 2]
      )
    );

    const result = calculate(tournament);

    const rosterScores = Object.fromEntries(
      result.matches[0]!.matchRosters.map((roster) => [
        roster.team,
        roster.score,
      ])
    );
    expect(rosterScores).toEqual({ [Team.Red]: 1, [Team.Blue]: 0 });
    expect(playerMatchStat(result, 10, 1)).toMatchObject({
      gamesWon: 1,
      gamesLost: 0,
      won: true,
    });
    expect(playerMatchStat(result, 10, 2)).toMatchObject({
      gamesWon: 0,
      gamesLost: 1,
      won: false,
    });
    expect(playerTournamentStat(result, 2)).toMatchObject({
      matchesWon: 0,
      matchesLost: 1,
    });
  });

  it('counts a drawn match as neither a win nor a loss', () => {
    // A 1v1 that ends 1-1.
    const tournament = tournamentOf(
      match(
        10,
        [
          game(100, 10, [
            score(100, 1, Team.Red, 600_000),
            score(100, 2, Team.Blue, 400_000),
          ]),
          game(101, 10, [
            score(101, 1, Team.Red, 400_000),
            score(101, 2, Team.Blue, 600_000),
          ]),
        ],
        [1, 2]
      )
    );

    const result = calculate(tournament);

    for (const playerId of [1, 2]) {
      expect(playerMatchStat(result, 10, playerId).won).toBe(false);
      expect(playerTournamentStat(result, playerId)).toMatchObject({
        matchesPlayed: 1,
        matchesWon: 0,
        matchesLost: 0,
        matchWinRate: 0,
      });
    }
  });

  it('counts a loss for a player who did not win and played for a team that was beaten', () => {
    // Red and Blue draw 1-1, and No team wins no game. Player 3 plays for Red,
    // then for No team, as player profiles read it from the stored rosters.
    const tournament = tournamentOf(
      match(
        10,
        [
          game(100, 10, [
            score(100, 1, Team.Red, 600_000),
            score(100, 2, Team.Blue, 500_000),
          ]),
          game(101, 10, [
            score(101, 2, Team.Blue, 600_000),
            score(101, 3, Team.Red, 500_000),
            score(101, 4, Team.NoTeam, 400_000),
          ]),
          game(102, 10, [
            score(102, 1, Team.Red, 500_000),
            score(102, 3, Team.NoTeam, 400_000),
            score(102, 2, Team.Blue, 500_000),
          ]),
        ],
        [1, 2, 3, 4]
      )
    );

    const result = calculate(tournament);

    const rosterScores = Object.fromEntries(
      result.matches[0]!.matchRosters.map((roster) => [
        roster.team,
        roster.score,
      ])
    );
    expect(rosterScores).toEqual({
      [Team.Red]: 1,
      [Team.Blue]: 1,
      [Team.NoTeam]: 0,
    });
    expect(playerTournamentStat(result, 3)).toMatchObject({
      matchesWon: 0,
      matchesLost: 1,
    });
    expect(playerTournamentStat(result, 1)).toMatchObject({
      matchesWon: 0,
      matchesLost: 0,
    });
  });
});
