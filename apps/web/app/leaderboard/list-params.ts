import { Ruleset } from '@otr/core/osu';

import { tieredScale } from '@/lib/filters/scale';
import { RATED_RULESETS } from '@/lib/kit/format/ruleset';
import {
  applyListPatch,
  arrayParam,
  booleanParam,
  defineListParams,
  enumParam,
  listStateHref,
  pageParam,
  rangeParam,
  searchParam,
  sortParam,
  type ListState,
} from '@/lib/kit/lists/params';
import { sortStatesEqual, type SortState } from '@/lib/kit/lists/sort';
import {
  LEADERBOARD_SEARCH_MAX_LENGTH,
  LEADERBOARD_SEARCH_MIN_LENGTH,
  leaderboardSortKeys,
  leaderboardTierKeys,
  type LeaderboardRequest,
  type LeaderboardSort,
  type LeaderboardTierKey,
} from '@/lib/orpc/schema/leaderboard';

/** Highest rating first: the same order as global rank. */
export const DEFAULT_LEADERBOARD_SORT: SortState<LeaderboardSort> = {
  key: 'rating',
  direction: 'desc',
};

/**
 * The domain of each range filter, shared by the params and the fields, so
 * a field rounds typed numbers exactly as its address does.
 */
export const LEADERBOARD_RANGES = {
  rating: { min: 100, max: 3500, integer: true },
  osuRank: { min: 1, max: 1_000_000, integer: true },
  matches: { min: 1, max: 1000, integer: true },
  // Percent. Old links may hold a decimal, such as 55.5.
  winRate: { min: 0, max: 100, integer: false },
} as const;

/**
 * Most players have played fewer than 200 matches, so the low end of the
 * track gets single steps.
 */
export const LEADERBOARD_MATCHES_SCALE = tieredScale({
  tiers: [
    { start: 1, end: 50, step: 1 },
    { start: 50, end: 200, step: 5 },
    { start: 200, end: 1000, step: 25 },
  ],
});

/**
 * Everything that changes what the leaderboard shows. The URL keys are the
 * ones the page has always used (`friend`, `tiers`, `minRating`, ...), so
 * old links keep working; `q`, `sort` and `dir` are the kit's.
 *
 * `ruleset` has no default: an address without one shows the visitor's
 * browsing ruleset, which the page resolves (osu! when signed out). A link
 * that means a ruleset names it, osu! included.
 */
export const LEADERBOARD_LIST_PARAMS = defineListParams({
  q: searchParam({
    minLength: LEADERBOARD_SEARCH_MIN_LENGTH,
    maxLength: LEADERBOARD_SEARCH_MAX_LENGTH,
  }),
  sort: sortParam(leaderboardSortKeys, DEFAULT_LEADERBOARD_SORT),
  ruleset: enumParam(RATED_RULESETS, { role: 'scope' }),
  friend: booleanParam({ role: 'scope' }),
  // A trimmed string, as the search is: a country code such as `US`.
  country: searchParam({ minLength: 2, maxLength: 4, role: 'filter' }),
  tiers: arrayParam(leaderboardTierKeys),
  rating: rangeParam(LEADERBOARD_RANGES.rating),
  osuRank: rangeParam(LEADERBOARD_RANGES.osuRank),
  matches: rangeParam(LEADERBOARD_RANGES.matches),
  winRate: rangeParam(LEADERBOARD_RANGES.winRate),
  page: pageParam(),
});

export type LeaderboardListState = ListState<typeof LEADERBOARD_LIST_PARAMS>;

export const LEADERBOARD_PATH = '/leaderboard';

/**
 * The leaderboard's address with `patch` applied to `state`, for links the
 * server renders (sort headers, pages, country links). Like `useListState`,
 * any change but the page goes back to page 1.
 */
export function leaderboardHref(
  state: LeaderboardListState,
  patch: Partial<LeaderboardListState>
): string {
  return listStateHref(
    LEADERBOARD_PATH,
    LEADERBOARD_LIST_PARAMS,
    applyListPatch(LEADERBOARD_LIST_PARAMS, state, patch)
  );
}

/** The tier filter's chips, in tier order. */
export const LEADERBOARD_TIER_LABELS: Readonly<
  Record<LeaderboardTierKey, string>
> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  emerald: 'Emerald',
  diamond: 'Diamond',
  master: 'Master',
  grandmaster: 'Grandmaster',
  eliteGrandmaster: 'Elite Grandmaster',
};

/** Fractions for the API, which takes win rate between 0 and 1. */
const toFraction = (percent: number | undefined) =>
  percent === undefined ? undefined : percent / 100;

/**
 * The ruleset an address without one shows when the visitor has no browsing
 * ruleset: signed out, or most played in an unrated ruleset.
 */
export const DEFAULT_LEADERBOARD_RULESET = Ruleset.Osu;

/**
 * The procedures' input for a list state. `defaultRuleset` is the visitor's
 * browsing ruleset, shown when the address names none. The default sort is
 * left out, so the server keeps its global rank order; `friend` picks the
 * procedure and is not part of the input.
 */
export function toLeaderboardRequest(
  state: LeaderboardListState,
  defaultRuleset: Ruleset
): Omit<LeaderboardRequest, 'friend' | 'userId'> {
  const sorted = !sortStatesEqual(state.sort, DEFAULT_LEADERBOARD_SORT);

  return {
    page: state.page,
    ruleset: state.ruleset ?? defaultRuleset,
    searchQuery: state.q || undefined,
    sort: sorted ? state.sort.key : undefined,
    descending: sorted ? state.sort.direction === 'desc' : undefined,
    country: state.country || undefined,
    tiers: state.tiers.length > 0 ? state.tiers : undefined,
    minRating: state.rating.min,
    maxRating: state.rating.max,
    minOsuRank: state.osuRank.min,
    maxOsuRank: state.osuRank.max,
    minMatches: state.matches.min,
    maxMatches: state.matches.max,
    minWinRate: toFraction(state.winRate.min),
    maxWinRate: toFraction(state.winRate.max),
  };
}
