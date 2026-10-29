'use client';

import type { Ruleset } from '@otr/core/osu';
import { useEffect, useState } from 'react';

import BeatmapListGrid from '@/components/beatmaps/list/BeatmapListGrid';
import BeatmapListToolbar from '@/components/beatmaps/list/BeatmapListToolbar';
import {
  isBeatmapLayout,
  type BeatmapLayout,
} from '@/components/beatmaps/list/layout';
import {
  BEATMAP_LIST_PARAMS,
  clearedBeatmapListHref,
  type BeatmapListSortChange,
} from '@/lib/beatmaps/list-params';
import { fromDescending } from '@/lib/kit/lists/sort';
import { useListState } from '@/lib/kit/lists/use-list-state';
import type { BeatmapListItem } from '@/lib/orpc/schema/beatmapList';

const BEATMAP_LAYOUT_STORAGE_KEY = 'otr-beatmap-layout';

interface BeatmapListContentProps {
  beatmaps: BeatmapListItem[];
  /** The visitor's browsing ruleset; empty for every ruleset. */
  defaultRulesets: readonly Ruleset[];
  isFiltered: boolean;
  totalCount: number;
}

/** The beatmap list's toolbar and rows, inside the list's panel. */
export default function BeatmapListContent({
  beatmaps,
  defaultRulesets,
  isFiltered,
  totalCount,
}: BeatmapListContentProps) {
  const list = useListState(BEATMAP_LIST_PARAMS);
  const [layout, setLayout] = useState<BeatmapLayout>('cards');

  useEffect(() => {
    try {
      const storedLayout = window.localStorage.getItem(
        BEATMAP_LAYOUT_STORAGE_KEY
      );
      if (isBeatmapLayout(storedLayout)) {
        setLayout(storedLayout);
      }
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, []);

  // A device preference, not a shareable filter.
  const changeLayout = (nextLayout: BeatmapLayout) => {
    setLayout(nextLayout);
    try {
      window.localStorage.setItem(BEATMAP_LAYOUT_STORAGE_KEY, nextLayout);
    } catch {
      // Storage can be unavailable.
    }
  };

  // The table's headers and the toolbar's sort share one state.
  const changeSort: BeatmapListSortChange = (sort, descending) =>
    list.setState({ sort: fromDescending(sort, descending) });

  return (
    <>
      <BeatmapListToolbar
        list={list}
        defaultRulesets={defaultRulesets}
        layout={layout}
        onLayoutChange={changeLayout}
        totalCount={totalCount}
      />

      <BeatmapListGrid
        beatmaps={beatmaps}
        isFiltered={isFiltered}
        clearFiltersHref={
          list.activeFilterCount > 0
            ? clearedBeatmapListHref(list.state)
            : undefined
        }
        layout={layout}
        sort={list.state.sort.key}
        descending={list.state.sort.direction === 'desc'}
        onSortChange={changeSort}
      />
    </>
  );
}
