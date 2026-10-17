import {
  TOURNAMENT_LIST_PARAMS,
  TOURNAMENT_LIST_PATH,
} from '@/app/tournaments/list-params';
import {
  defineListParams,
  getDefaultListState,
  listStateHref,
  searchParam,
} from '@/lib/kit/lists/params';

/** The lists a header search group can open, already searched. */
export type SeeAllTarget = 'players' | 'tournaments' | 'beatmaps';

/**
 * Every list keeps its search term in `q` (`searchParam()` under that name),
 * so one spec builds the address for each. Players have no list of their
 * own; their group opens the leaderboard's player search.
 */
const SEARCH_ONLY_PARAMS = defineListParams({ q: searchParam() });

const SEE_ALL_PATHS: Record<SeeAllTarget, string> = {
  players: '/leaderboard',
  tournaments: TOURNAMENT_LIST_PATH,
  beatmaps: '/beatmaps',
};

/**
 * The list's address with `term` as its search: `/tournaments?q=world+cup`.
 * The search found tournaments of every ruleset, so the tournament list
 * opens on every ruleset rather than the visitor's browsing ruleset.
 */
export function getSeeAllHref(target: SeeAllTarget, term: string): string {
  if (target === 'tournaments') {
    return listStateHref(TOURNAMENT_LIST_PATH, TOURNAMENT_LIST_PARAMS, {
      ...getDefaultListState(TOURNAMENT_LIST_PARAMS),
      q: term,
      ruleset: [],
    });
  }
  return listStateHref(SEE_ALL_PATHS[target], SEARCH_ONLY_PARAMS, { q: term });
}
