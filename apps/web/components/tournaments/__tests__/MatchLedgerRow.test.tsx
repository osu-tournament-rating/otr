import { describe, expect, it } from 'bun:test';
import {
  MatchRejectionReason,
  MatchWarningFlags,
  Team,
  VerificationStatus,
} from '@otr/core/osu';
import { renderToStaticMarkup } from 'react-dom/server';

import MatchLedgerRow from '@/components/tournaments/MatchLedgerRow';
import {
  getOneVsOneResult,
  type MatchRow,
} from '@/components/tournaments/matchRow';
import { TooltipProvider } from '@/components/ui/tooltip';

// 72268 on the site: Argentina, the title's first name, played blue and won.
const argentinaWon: NonNullable<MatchRow['winRecord']> = {
  matchId: 72268,
  isTied: false,
  winnerTeam: Team.Blue,
  loserTeam: Team.Red,
  winnerPoints: 5,
  loserPoints: 3,
  winnerRoster: [11, 12],
  loserRoster: [21, 22],
};

const row = (overrides: Partial<MatchRow>): MatchRow => ({
  id: 72268,
  name: 'CWC 2016: (Argentina) vs (Japan)',
  status: {
    verificationStatus: VerificationStatus.Verified,
    warningFlags: MatchWarningFlags.None,
    rejectionReason: MatchRejectionReason.None,
    verifiedByUsername: null,
  },
  startDate: null,
  winRecord: argentinaWon,
  oneVsOne: false,
  playerResult: null,
  games: [],
  matchAdminNotes: [],
  ...overrides,
});

/** The text of the row's link to its match, as it reads. */
function titleOf(match: MatchRow) {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <ul>
        <MatchLedgerRow match={match} isSelected={false} />
      </ul>
    </TooltipProvider>
  );
  const link = new RegExp(`<a[^>]*href="/matches/${match.id}"[^>]*>(.*?)</a>`)
    .exec(html)?.[1]
    ?.replace(/<[^>]+>/g, ' ');

  return link?.replace(/\s+/g, ' ').trim();
}

describe('MatchLedgerRow title', () => {
  it('keeps a team match title in its own order whoever won', () => {
    expect(titleOf(row({}))).toBe('Argentina vs Japan');
  });

  it('names a 1v1 winner first, from the stored result', () => {
    // 30011: the title lists zonelouise first; Chamosiala won 4-0.
    const match = row({
      id: 30011,
      name: 'YSC: (zonelouise) vs (Chamosiala)',
      winRecord: { ...argentinaWon, winnerTeam: Team.Red },
      oneVsOne: true,
      playerResult: { winner: 'Chamosiala', loser: 'zonelouise' },
    });

    expect(titleOf(match)).toBe('Chamosiala vs zonelouise');
  });
});

describe('getOneVsOneResult', () => {
  const usernames = new Map([
    [1, 'Chamosiala'],
    [2, 'zonelouise'],
  ]);
  const decided = {
    ...argentinaWon,
    winnerRoster: [1],
    loserRoster: [2],
  };

  it('names the winner and loser of a decided 1v1', () => {
    expect(getOneVsOneResult(decided, usernames)).toEqual({
      winner: 'Chamosiala',
      loser: 'zonelouise',
    });
  });

  it.each([
    ['no result', null],
    [
      'a draw',
      { ...decided, isTied: true, winnerRoster: null, loserRoster: null },
    ],
    ['a side of two players', { ...decided, winnerRoster: [1, 3] }],
    ['a player with no name', { ...decided, loserRoster: [9] }],
  ])('names no one for %s', (_, winRecord) => {
    expect(getOneVsOneResult(winRecord, usernames)).toBeNull();
  });
});
