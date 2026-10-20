'use client';

import type { Ruleset } from '@otr/core/osu';

import { useListState } from '@/lib/kit/lists/use-list-state';

import { STATS_PARAMS } from './stats-params';

/**
 * The page's ruleset (`?ruleset=`). Every ruleset's data is on the page, so
 * a switch rewrites the address in place instead of rendering the page
 * again.
 */
export function useStatsRuleset(): Ruleset {
  return useListState(STATS_PARAMS, { shallow: true }).state.ruleset;
}
