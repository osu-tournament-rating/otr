import { VerificationStatus } from '@otr/core/osu';
import type { MatchRejectionReason, MatchWarningFlags } from '@otr/core/osu';

import type { SortOption } from '@/components/kit/lists/SortControl';
import { defineListParams, sortParam } from '@/lib/kit/lists/params';
import type { SortState } from '@/lib/kit/lists/sort';
import type {
  TournamentMatch,
  TournamentMatchGame,
} from '@/lib/orpc/schema/tournament';

export type AdminNotePreview = {
  note: string;
  adminUsername: string;
  created: string;
};

export type GameWithNotes = Pick<
  TournamentMatchGame,
  'verificationStatus' | 'warningFlags' | 'startTime' | 'rejectionReason'
> & {
  id: number;
  adminNotes: AdminNotePreview[];
};

export type MatchRow = {
  id: number;
  name: string;
  status: {
    verificationStatus: VerificationStatus;
    warningFlags: MatchWarningFlags;
    rejectionReason: MatchRejectionReason;
    verifiedByUsername: string | null;
  };
  startDate: string | null;
  winRecord: TournamentMatch['winRecord'];
  /**
   * From a 1v1 tournament, whose sides are players. Their red and blue are
   * often o!TR's own, from head-to-head lobbies it converted, so the row
   * never shows them.
   */
  oneVsOne: boolean;
  /** A 1v1's winner and loser by name, from its stored result. */
  playerResult: OneVsOneResult | null;
  games: GameWithNotes[];
  matchAdminNotes: AdminNotePreview[];
};

export type OneVsOneResult = { winner: string; loser: string };

/**
 * The names of a decided 1v1's winner and loser, from its stored result.
 * Null for a draw, a side of more than one player, or a name not in
 * `usernames`.
 */
export function getOneVsOneResult(
  winRecord: TournamentMatch['winRecord'],
  usernames: ReadonlyMap<number, string>
): OneVsOneResult | null {
  if (!winRecord || winRecord.isTied) return null;

  const nameOf = (roster: number[] | null) =>
    roster?.length === 1 ? usernames.get(roster[0]!) : undefined;
  const winner = nameOf(winRecord.winnerRoster);
  const loser = nameOf(winRecord.loserRoster);

  return winner && loser ? { winner, loser } : null;
}

/**
 * The two names in an osu! lobby title, `ACRONYM: (one) vs (two)`, in the
 * title's order. Hosts list either side first, so the order says nothing
 * about red, blue or the winner.
 */
export function parseTeamNames(
  name: string
): { first: string; second: string } | null {
  const parsed = /^.*?:\s*\((.+)\)\s+vs\.?\s+\((.+)\)\s*$/i.exec(name.trim());
  const first = parsed?.[1]?.trim();
  const second = parsed?.[2]?.trim();
  return first && second ? { first, second } : null;
}

/** Key of the UTC week containing `date`, weeks running Thursday to Wednesday. */
export function playWeekKey(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000 / 7);
}

/** Statuses from rejected to verified, for sorting by status. */
export const getVerificationStatusPriority = (
  status: VerificationStatus
): number => {
  switch (status) {
    case VerificationStatus.Verified:
      return 4;
    case VerificationStatus.PreVerified:
      return 3;
    case VerificationStatus.None:
      return 2;
    case VerificationStatus.PreRejected:
      return 1;
    case VerificationStatus.Rejected:
      return 0;
    default:
      return -1;
  }
};

export type MatchSortKey = 'date' | 'name' | 'games' | 'margin' | 'status';

/** The match list's sort keys, each with the direction it starts in. */
export const MATCH_SORT_OPTIONS: readonly SortOption<MatchSortKey>[] = [
  {
    value: 'date',
    label: 'Date',
    defaultDirection: 'desc',
    directionLabels: { desc: 'Newest first', asc: 'Oldest first' },
  },
  {
    value: 'name',
    label: 'Match name',
    defaultDirection: 'asc',
    directionLabels: { asc: 'A to Z', desc: 'Z to A' },
  },
  {
    value: 'games',
    label: 'Games played',
    defaultDirection: 'desc',
    directionLabels: { desc: 'Most games first', asc: 'Fewest games first' },
  },
  {
    value: 'margin',
    label: 'Closest result',
    defaultDirection: 'asc',
    directionLabels: { asc: 'Closest first', desc: 'Widest first' },
  },
  {
    value: 'status',
    label: 'Verification status',
    defaultDirection: 'asc',
    directionLabels: { asc: 'Rejected first', desc: 'Verified first' },
  },
];

export const DEFAULT_MATCH_SORT: SortState<MatchSortKey> = {
  key: 'date',
  direction: 'desc',
};

/** The match list's sort, in the tournament page's address. */
export const TOURNAMENT_MATCH_PARAMS = defineListParams({
  sort: sortParam(
    MATCH_SORT_OPTIONS.map((option) => option.value),
    DEFAULT_MATCH_SORT
  ),
});
