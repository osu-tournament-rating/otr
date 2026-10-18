import { describe, expect, it } from 'bun:test';

import { Team, VerificationStatus } from '@otr/core/osu';

import {
  deriveTournamentWinRecord,
  deriveVerifiedWinRecord,
  deriveWinRecord,
} from '../winRecord';

const roster = (id: number, team: Team, score: number, players: number[]) => ({
  id,
  roster: players,
  team,
  score,
});

describe('deriveWinRecord', () => {
  it('names the higher score the winner', () => {
    expect(
      deriveWinRecord(7, [
        roster(1, Team.Red, 3, [10, 11]),
        roster(2, Team.Blue, 5, [20, 21]),
      ])
    ).toEqual({
      matchId: 7,
      isTied: false,
      loserRoster: [10, 11],
      winnerRoster: [20, 21],
      loserPoints: 3,
      winnerPoints: 5,
      loserTeam: Team.Red,
      winnerTeam: Team.Blue,
    });
  });

  it('ignores the order the rosters arrive in', () => {
    const rosters = [
      roster(1, Team.Red, 7, [10]),
      roster(2, Team.Blue, 2, [20]),
      roster(3, Team.NoTeam, 4, [30]),
    ];

    expect(deriveWinRecord(7, rosters)).toEqual(
      deriveWinRecord(7, [...rosters].reverse())
    );
    expect(deriveWinRecord(7, rosters)).toMatchObject({
      winnerRoster: [10],
      winnerPoints: 7,
      loserRoster: [30],
      loserPoints: 4,
    });
  });

  it('reports a tie when the top score is shared', () => {
    expect(
      deriveWinRecord(9, [
        roster(1, Team.Red, 4, [10]),
        roster(2, Team.Blue, 4, [20]),
      ])
    ).toEqual({
      matchId: 9,
      isTied: true,
      loserRoster: null,
      winnerRoster: null,
      loserPoints: 4,
      winnerPoints: 4,
      loserTeam: null,
      winnerTeam: null,
    });
  });

  it('returns null for fewer than two rosters', () => {
    expect(deriveWinRecord(9, [roster(1, Team.Red, 4, [10])])).toBeNull();
  });
});

describe('deriveVerifiedWinRecord', () => {
  const rosters = [
    roster(1, Team.Red, 3, [10, 11]),
    roster(2, Team.Blue, 5, [20, 21]),
  ];

  it('derives the full record for a verified match', () => {
    expect(
      deriveVerifiedWinRecord(7, VerificationStatus.Verified, rosters)
    ).toEqual({
      matchId: 7,
      isTied: false,
      loserRoster: [10, 11],
      winnerRoster: [20, 21],
      loserPoints: 3,
      winnerPoints: 5,
      loserTeam: Team.Red,
      winnerTeam: Team.Blue,
    });
  });

  it.each([
    ['Rejected', VerificationStatus.Rejected],
    ['PreRejected', VerificationStatus.PreRejected],
    ['PreVerified', VerificationStatus.PreVerified],
  ])('returns null for a %s match that still has rosters', (_, status) => {
    expect(deriveVerifiedWinRecord(7, status, rosters)).toBeNull();
  });
});

describe('deriveTournamentWinRecord', () => {
  const rosters = [
    roster(1, Team.Red, 3, [10, 11]),
    roster(2, Team.Blue, 5, [20, 21]),
  ];

  it('drops the roster arrays a verified match derives', () => {
    expect(
      deriveTournamentWinRecord(7, VerificationStatus.Verified, rosters)
    ).toEqual({
      matchId: 7,
      isTied: false,
      winnerTeam: Team.Blue,
      loserTeam: Team.Red,
      winnerPoints: 5,
      loserPoints: 3,
    });
  });

  it('returns null for a non-verified match that still has rosters', () => {
    expect(
      deriveTournamentWinRecord(7, VerificationStatus.Rejected, rosters)
    ).toBeNull();
    expect(
      deriveTournamentWinRecord(7, VerificationStatus.PreRejected, rosters)
    ).toBeNull();
  });

  it('returns null when a verified match has no rosters', () => {
    expect(
      deriveTournamentWinRecord(7, VerificationStatus.Verified, [])
    ).toBeNull();
  });
});
