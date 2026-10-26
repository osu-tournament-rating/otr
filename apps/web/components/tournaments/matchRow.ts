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
    pendingRating: boolean;
  };
  startDate: string | null;
  winRecord: TournamentMatch['winRecord'];
  games: GameWithNotes[];
  matchAdminNotes: AdminNotePreview[];
};

/** osu! lobby names follow `ACRONYM: (red team) vs (blue team)`. */
export function parseTeamNames(
  name: string
): { red: string; blue: string } | null {
  const parsed = /^.*?:\s*\((.+)\)\s+vs\.?\s+\((.+)\)\s*$/i.exec(name.trim());
  const red = parsed?.[1]?.trim();
  const blue = parsed?.[2]?.trim();
  return red && blue ? { red, blue } : null;
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
