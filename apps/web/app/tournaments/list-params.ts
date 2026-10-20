import {
  TournamentQuerySortType,
  TournamentRejectionReason,
  type Ruleset,
} from '@otr/core/osu';

import type { SortOption } from '@/components/kit/lists/SortControl';
import { RANK_RANGE_MAX, RANK_RANGE_MIN } from '@/lib/filters/tournament-rank';
import { RATED_RULESETS } from '@/lib/kit/format/ruleset';
import {
  arrayParam,
  booleanParam,
  dayRangeParam,
  defineListParams,
  flagsParam,
  flagsToMask,
  listStateHref,
  numberParam,
  pageParam,
  parseListState,
  rangeParam,
  searchParam,
  sortParam,
  toSearchParams,
  type ListState,
  type SearchParamsInput,
} from '@/lib/kit/lists/params';
import type { SortState } from '@/lib/kit/lists/sort';
import { VERIFICATION_STATUS_ORDER } from '@/lib/kit/status/verification';
import type { TournamentListRequest } from '@/lib/orpc/schema/tournament';

export const TOURNAMENT_LIST_PATH = '/tournaments';

/** Rows per page, the list procedure's default. */
export const TOURNAMENT_PAGE_SIZE = 30;

export type TournamentSortKey =
  'relevance' | 'endTime' | 'startTime' | 'submitted' | 'lobbySize';

/**
 * The list's sort keys with their labels, in menu order. Relevance ranks a
 * search as the public API's relevance sort does, best match first, so it
 * has no direction and is offered only while searching
 * (`getTournamentSortOptions`).
 */
export const TOURNAMENT_SORT_OPTIONS: readonly SortOption<TournamentSortKey>[] =
  [
    {
      value: 'relevance',
      label: 'Relevance',
      defaultDirection: 'desc',
      directionless: true,
    },
    { value: 'endTime', label: 'End date' },
    { value: 'startTime', label: 'Start date' },
    { value: 'submitted', label: 'Submission date' },
    { value: 'lobbySize', label: 'Lobby size' },
  ];

const SORT_TYPES: Readonly<Record<TournamentSortKey, TournamentQuerySortType>> =
  {
    relevance: TournamentQuerySortType.SearchQueryRelevance,
    endTime: TournamentQuerySortType.EndTime,
    startTime: TournamentQuerySortType.StartTime,
    submitted: TournamentQuerySortType.SubmissionDate,
    lobbySize: TournamentQuerySortType.LobbySize,
  };

/**
 * No sort chosen: a search lists its best matches first, and the list
 * without one falls back to end date (`resolveTournamentSort`). Any key the
 * visitor picks, end date included, is written to the address and kept.
 */
export const DEFAULT_TOURNAMENT_SORT: SortState<TournamentSortKey> = {
  key: 'relevance',
  direction: 'desc',
};

/** Lobby sizes a tournament can have, 1v1 to 8v8. */
export const LOBBY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type LobbySize = (typeof LOBBY_SIZES)[number];

/** Every rejection reason flag, in bit order (no `None`). */
export const TOURNAMENT_REJECTION_REASONS: readonly TournamentRejectionReason[] =
  [
    TournamentRejectionReason.NoVerifiedMatches,
    TournamentRejectionReason.NotEnoughVerifiedMatches,
    TournamentRejectionReason.AbnormalWinCondition,
    TournamentRejectionReason.AbnormalFormat,
    TournamentRejectionReason.VaryingLobbySize,
    TournamentRejectionReason.IncompleteData,
  ];

/**
 * Everything that changes what the tournament list shows. The server page
 * parses it and fetches; the toolbar reads and writes it. The rank, date,
 * lobby size, ruleset and rejection reason keys are the ones the list has
 * always written, so old links keep working.
 *
 * An address without a ruleset shows the visitor's browsing ruleset, which
 * the page resolves (every ruleset when signed out), so every ruleset needs
 * its own value: `ruleset=all`.
 */
export const TOURNAMENT_LIST_PARAMS = defineListParams({
  q: searchParam(),
  page: pageParam(),
  sort: sortParam(
    TOURNAMENT_SORT_OPTIONS.map((option) => option.value),
    DEFAULT_TOURNAMENT_SORT,
    { legacyDescendingKey: 'descending' }
  ),
  ruleset: arrayParam(RATED_RULESETS, { role: 'scope', allValue: 'all' }),
  status: arrayParam(VERIFICATION_STATUS_ORDER),
  lobbySize: arrayParam(LOBBY_SIZES),
  reason: flagsParam(TOURNAMENT_REJECTION_REASONS, { key: 'rejectionReason' }),
  rank: rangeParam({
    min: RANK_RANGE_MIN,
    max: RANK_RANGE_MAX,
    integer: true,
    keys: ['minRankRange', 'maxRankRange'],
  }),
  date: dayRangeParam({ keys: ['dateMin', 'dateMax'] }),
  verified: booleanParam(),
  // Reachable from links only; shown as active-filter chips.
  submittedBy: numberParam({ min: 1, integer: true }),
  verifiedBy: numberParam({ min: 1, integer: true }),
});

export type TournamentListState = ListState<typeof TOURNAMENT_LIST_PARAMS>;

export function tournamentListHref(state: TournamentListState): string {
  return listStateHref(TOURNAMENT_LIST_PATH, TOURNAMENT_LIST_PARAMS, state);
}

/**
 * The sort a list state shows and fetches. Relevance means nothing without
 * a search, so there the list falls back to end date, keeping the direction
 * an older end date link carries (`?dir=asc`).
 */
export function resolveTournamentSort(
  state: Pick<TournamentListState, 'q' | 'sort'>
): SortState<TournamentSortKey> {
  if (state.sort.key === 'relevance' && !state.q) {
    return { key: 'endTime', direction: state.sort.direction };
  }
  return state.sort;
}

/** The sort keys the toolbar offers: relevance only while searching. */
export function getTournamentSortOptions(
  searching: boolean
): readonly SortOption<TournamentSortKey>[] {
  return searching
    ? TOURNAMENT_SORT_OPTIONS
    : TOURNAMENT_SORT_OPTIONS.filter((option) => option.value !== 'relevance');
}

/**
 * The rulesets a list state shows: its own, else `defaultRulesets`, the
 * visitor's browsing ruleset (empty for every ruleset).
 */
export function resolveTournamentRulesets(
  state: Pick<TournamentListState, 'ruleset'>,
  defaultRulesets: readonly Ruleset[]
): readonly Ruleset[] {
  return state.ruleset ?? defaultRulesets;
}

/**
 * The address's ruleset for chips set to `rulesets`: nothing when they are
 * the visitor's own `defaultRulesets`, so the visitor's default never lands
 * in a shared link, and otherwise the chips (empty writes `ruleset=all`).
 */
export function rulesetsForAddress(
  rulesets: readonly Ruleset[],
  defaultRulesets: readonly Ruleset[]
): Ruleset[] | undefined {
  const same =
    rulesets.length === defaultRulesets.length &&
    rulesets.every((ruleset) => defaultRulesets.includes(ruleset));
  return same ? undefined : [...rulesets];
}

/**
 * The procedure's input for a list state, with `defaultRulesets` standing in
 * for a ruleset the address leaves out.
 */
export function toTournamentListRequest(
  state: TournamentListState,
  defaultRulesets: readonly Ruleset[]
): TournamentListRequest {
  const reasonMask = flagsToMask(state.reason);
  const rulesets = resolveTournamentRulesets(state, defaultRulesets);
  const sort = resolveTournamentSort(state);

  return {
    page: state.page,
    pageSize: TOURNAMENT_PAGE_SIZE,
    searchQuery: state.q || undefined,
    rulesets: rulesets.length > 0 ? [...rulesets] : undefined,
    verificationStatus: state.status.length > 0 ? [...state.status] : undefined,
    lobbySize: state.lobbySize.length > 0 ? [...state.lobbySize] : undefined,
    rejectionReason: reasonMask > 0 ? reasonMask : undefined,
    minRankRange: state.rank.min,
    maxRankRange: state.rank.max,
    // Both ends are whole UTC days: the list compares start times with >=
    // and end times with <=.
    dateMin: state.date.from ? `${state.date.from}T00:00:00.000Z` : undefined,
    dateMax: state.date.to ? `${state.date.to}T23:59:59.999Z` : undefined,
    verified: state.verified || undefined,
    submittedBy: state.submittedBy,
    verifiedBy: state.verifiedBy,
    sort: SORT_TYPES[sort.key],
    descending: sort.direction === 'desc',
  };
}

const LEGACY_SORT_KEYS: Partial<Record<string, TournamentSortKey>> = {
  [String(TournamentQuerySortType.SearchQueryRelevance)]: 'relevance',
  [String(TournamentQuerySortType.StartTime)]: 'startTime',
  [String(TournamentQuerySortType.EndTime)]: 'endTime',
  [String(TournamentQuerySortType.SubmissionDate)]: 'submitted',
  [String(TournamentQuerySortType.LobbySize)]: 'lobbySize',
};

/**
 * The current address for a link the old toolbar wrote
 * (`searchQuery`, `verificationStatus`, a numeric `sort`, `descending`,
 * `rulesets`), or `null` when the address is already current.
 */
export function legacyTournamentListHref(
  input: SearchParamsInput
): string | null {
  const params = toSearchParams(input);
  const sort = params.get('sort');
  const hasLegacy =
    params.has('searchQuery') ||
    params.has('verificationStatus') ||
    params.has('rulesets') ||
    params.has('descending') ||
    (sort !== null && /^\d+$/.test(sort.trim()));
  if (!hasLegacy) return null;

  const current = new URLSearchParams(params);
  const searchQuery = params.get('searchQuery');
  if (searchQuery !== null && !params.has('q')) {
    current.set('q', searchQuery);
  }
  for (const status of params.getAll('verificationStatus')) {
    current.append('status', status);
  }
  for (const ruleset of params.getAll('rulesets')) {
    current.append('ruleset', ruleset);
  }
  if (sort !== null && /^\d+$/.test(sort.trim())) {
    const key = LEGACY_SORT_KEYS[sort.trim()];
    if (key) current.set('sort', key);
    else current.delete('sort');
  }

  const state = parseListState(TOURNAMENT_LIST_PARAMS, current);
  return tournamentListHref(state);
}
