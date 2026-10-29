import type { Ruleset } from '@otr/core/osu';
import type { z } from 'zod';

import { RATED_RULESETS } from '@/lib/kit/format/ruleset';
import {
  arrayParam,
  clearListFilters,
  defineListParams,
  listStateHref,
  pageParam,
  rangeParam,
  searchParam,
  sortParam,
  type ListState,
} from '@/lib/kit/lists/params';
import { toDescending } from '@/lib/kit/lists/sort';
import {
  BeatmapListSortSchema,
  type BeatmapListRequest,
} from '@/lib/orpc/schema/beatmapList';

/** Every sort key the list procedure takes, and so the address accepts. */
export type BeatmapListSortKey = z.infer<typeof BeatmapListSortSchema>;

/** Applied by the sort select and the column headers; both write the URL. */
export type BeatmapListSortChange = (
  sort: BeatmapListSortKey,
  descending: boolean
) => void;

/** Rows per page of the beatmap list. */
export const BEATMAP_LIST_PAGE_SIZE = 30;

/**
 * The beatmap list's state in the page address. Keys match the links the
 * list wrote before (`q`, `ruleset`, `minSr`…), and `descending=false` from
 * old links still reads as an ascending sort. Range domains follow the real
 * distribution, as the filter panel's sliders do.
 *
 * An address without a ruleset shows the visitor's browsing ruleset, which
 * the page resolves (every ruleset when signed out), so every ruleset needs
 * its own value: `ruleset=all`.
 */
export const BEATMAP_LIST_PARAMS = defineListParams({
  q: searchParam(),
  page: pageParam(),
  sort: sortParam(
    BeatmapListSortSchema.options,
    { key: 'gameCount', direction: 'desc' },
    { legacyDescendingKey: 'descending' }
  ),
  ruleset: arrayParam(RATED_RULESETS, { role: 'scope', allValue: 'all' }),
  sr: rangeParam({ min: 0, max: 15 }),
  bpm: rangeParam({ min: 0, max: 600 }),
  length: rangeParam({ min: 0, max: 1800, integer: true }),
  games: rangeParam({
    min: 0,
    max: 600,
    integer: true,
    keys: ['minGameCount', 'maxGameCount'],
  }),
  tournaments: rangeParam({
    min: 0,
    max: 80,
    integer: true,
    keys: ['minTournamentCount', 'maxTournamentCount'],
  }),
  cs: rangeParam({ min: 0, max: 10 }),
  ar: rangeParam({ min: 0, max: 10 }),
  od: rangeParam({ min: 0, max: 10 }),
  hp: rangeParam({ min: 0, max: 10 }),
});

export type BeatmapListState = ListState<typeof BEATMAP_LIST_PARAMS>;

/** The range filters in the order the filter panel and its chips show them. */
export type BeatmapListRangeKey =
  'sr' | 'bpm' | 'length' | 'games' | 'tournaments' | 'cs' | 'ar' | 'od' | 'hp';

/**
 * The list procedure's input for a list state, with `defaultRulesets`, the
 * visitor's browsing ruleset (empty for every ruleset), standing in for a
 * ruleset the address leaves out.
 */
export function toBeatmapListRequest(
  state: BeatmapListState,
  defaultRulesets: readonly Ruleset[]
): BeatmapListRequest {
  const rulesets = state.ruleset ?? defaultRulesets;
  return {
    page: state.page,
    pageSize: BEATMAP_LIST_PAGE_SIZE,
    searchQuery: state.q || undefined,
    rulesets: rulesets.length > 0 ? [...rulesets] : undefined,
    minSr: state.sr.min,
    maxSr: state.sr.max,
    minBpm: state.bpm.min,
    maxBpm: state.bpm.max,
    minLength: state.length.min,
    maxLength: state.length.max,
    minGameCount: state.games.min,
    maxGameCount: state.games.max,
    minTournamentCount: state.tournaments.min,
    maxTournamentCount: state.tournaments.max,
    minCs: state.cs.min,
    maxCs: state.cs.max,
    minAr: state.ar.min,
    maxAr: state.ar.max,
    minOd: state.od.min,
    maxOd: state.od.max,
    minHp: state.hp.min,
    maxHp: state.hp.max,
    ...toDescending(state.sort),
  };
}

/** The address of the list in `state`, on `page`. */
export function beatmapListHref(
  state: BeatmapListState,
  page = state.page
): string {
  return listStateHref('/beatmaps', BEATMAP_LIST_PARAMS, { ...state, page });
}

/**
 * The address of the same list with its filters cleared, for an empty
 * state's "Clear filters": search, sort and rulesets stay.
 */
export function clearedBeatmapListHref(state: BeatmapListState): string {
  return listStateHref(
    '/beatmaps',
    BEATMAP_LIST_PARAMS,
    clearListFilters(BEATMAP_LIST_PARAMS, state)
  );
}
