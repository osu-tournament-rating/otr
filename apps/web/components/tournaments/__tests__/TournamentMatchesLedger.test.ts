import { describe, expect, it } from 'bun:test';
import {
  MatchRejectionReason,
  MatchWarningFlags,
  Team,
  VerificationStatus,
} from '@otr/core/osu';

import { groupMatches } from '@/components/tournaments/TournamentMatchesLedger';
import type { MatchRow } from '@/components/tournaments/matchRow';

const match = (
  id: number,
  startDate: string | null,
  {
    name = `Match ${id}`,
    games = 0,
    margin,
  }: { name?: string; games?: number; margin?: number } = {}
): MatchRow => ({
  id,
  name,
  status: {
    verificationStatus: VerificationStatus.Verified,
    warningFlags: MatchWarningFlags.None,
    rejectionReason: MatchRejectionReason.None,
    verifiedByUsername: null,
  },
  startDate,
  winRecord:
    margin === undefined
      ? null
      : {
          matchId: id,
          isTied: false,
          winnerPoints: 5 + margin,
          loserPoints: 5,
          winnerTeam: Team.Red,
          loserTeam: Team.Blue,
          winnerRoster: [1],
          loserRoster: [2],
        },
  oneVsOne: false,
  playerResult: null,
  games: Array.from({ length: games }, (_, index) => ({
    id: id * 100 + index,
    verificationStatus: VerificationStatus.Verified,
    warningFlags: 0,
    rejectionReason: 0,
    startTime: startDate ?? '',
    adminNotes: [],
  })),
  matchAdminNotes: [],
});

// Two play weeks: Sat/Sun Jul 20-21 and Sat Jul 27, 2024, plus an undated match.
const matches = [
  match(1, '2024-07-20T12:00:00Z', { name: 'b', games: 3, margin: 2 }),
  match(2, '2024-07-27T12:00:00Z', { name: 'c', games: 1, margin: 1 }),
  match(3, '2024-07-21T12:00:00Z', { name: 'a', games: 5, margin: 3 }),
  match(4, null, { name: 'd', games: 2 }),
];

const ids = (groups: ReturnType<typeof groupMatches>) =>
  groups.map((group) => group.matches.map((m) => m.id));

describe('groupMatches', () => {
  it('groups date sorts by play week, undated last', () => {
    const newest = groupMatches(matches, { key: 'date', direction: 'desc' });
    expect(newest.map((group) => group.label)).toEqual([
      'Jul 27, 2024',
      'Jul 20 – 21, 2024',
      'No start time',
    ]);
    expect(ids(newest)).toEqual([[2], [3, 1], [4]]);

    expect(
      ids(groupMatches(matches, { key: 'date', direction: 'asc' }))
    ).toEqual([[1, 3], [2], [4]]);
  });

  it('sorts every other key across the whole tournament', () => {
    for (const [sort, order] of [
      [{ key: 'name', direction: 'asc' }, [3, 1, 2, 4]],
      [{ key: 'name', direction: 'desc' }, [4, 2, 1, 3]],
      [{ key: 'games', direction: 'desc' }, [3, 1, 4, 2]],
      [{ key: 'games', direction: 'asc' }, [2, 4, 1, 3]],
      // A match without a result has no margin and sorts last both ways.
      [{ key: 'margin', direction: 'asc' }, [2, 1, 3, 4]],
      [{ key: 'margin', direction: 'desc' }, [3, 1, 2, 4]],
    ] as const) {
      const groups = groupMatches(matches, sort);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBeNull();
      expect(ids(groups)).toEqual([[...order]]);
    }
  });

  it('breaks ties with the newest match first', () => {
    const tied = [
      match(1, '2024-07-20T12:00:00Z', { games: 2 }),
      match(2, '2024-07-27T12:00:00Z', { games: 2 }),
    ];
    expect(
      ids(groupMatches(tied, { key: 'games', direction: 'desc' }))
    ).toEqual([[2, 1]]);
  });

  it('returns no groups without matches', () => {
    expect(groupMatches([], { key: 'date', direction: 'desc' })).toEqual([]);
    expect(groupMatches([], { key: 'name', direction: 'asc' })).toEqual([]);
  });
});
