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

  it('fails when matches do not have verified games', () => {
    const calculator = new TournamentStatsCalculator();
    const tournament = createVerifiedTournament();
    tournament.matches[0]?.games.forEach((game) => {
      game.verificationStatus = VerificationStatus.PreVerified;
    });

    const result = calculator.calculateAllStatistics(tournament);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.errorMessage).toContain('Failed to process match statistics');
  });

  it('fails when rating adjustments are missing', () => {
    const calculator = new TournamentStatsCalculator();
    const tournament = createVerifiedTournament();
    tournament.matches[0]!.playerRatingAdjustments = [];

    const result = calculator.calculateAllStatistics(tournament);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.errorMessage).toContain('Missing processor data');
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
});
