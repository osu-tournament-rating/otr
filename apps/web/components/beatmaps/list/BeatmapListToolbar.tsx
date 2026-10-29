'use client';

import type { Ruleset } from '@otr/core/osu';
import { LayoutGrid, Rows3, Table2 } from 'lucide-react';

import {
  ActiveFilterChips,
  type ActiveFilter,
} from '@/components/kit/lists/ActiveFilterChips';
import { FilterPanel } from '@/components/kit/lists/FilterPanel';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { RangeFilter } from '@/components/kit/lists/RangeFilter';
import { RulesetChips } from '@/components/kit/lists/RulesetChips';
import { SearchField } from '@/components/kit/lists/SearchField';
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  BEATMAP_LAYOUTS,
  isBeatmapLayout,
  type BeatmapLayout,
} from '@/components/beatmaps/list/layout';
import type {
  BEATMAP_LIST_PARAMS,
  BeatmapListRangeKey,
  BeatmapListSortKey,
} from '@/lib/beatmaps/list-params';
import { tieredScale, type NumericScale } from '@/lib/filters/scale';
import { formatCountOf } from '@/lib/kit/format/number';
import {
  formatFilterNumber,
  formatRangeFilterLabel,
} from '@/lib/kit/lists/filters';
import { valuesForAddress } from '@/lib/kit/lists/params';
import type { UseListStateResult } from '@/lib/kit/lists/use-list-state';
import { formatDuration } from '@/lib/kit/format/date';

type BeatmapList = UseListStateResult<typeof BEATMAP_LIST_PARAMS>;

const SORT_OPTIONS: readonly SortOption<BeatmapListSortKey>[] = [
  { value: 'gameCount', label: 'Games' },
  { value: 'tournamentCount', label: 'Tournaments' },
  { value: 'sr', label: 'SR', group: 'attributes' },
  { value: 'bpm', label: 'BPM', group: 'attributes' },
  { value: 'cs', label: 'CS', group: 'attributes' },
  { value: 'ar', label: 'AR', group: 'attributes' },
  { value: 'length', label: 'Length', group: 'attributes' },
];

const LAYOUT_OPTIONS: Record<
  BeatmapLayout,
  { label: string; icon: typeof LayoutGrid }
> = {
  cards: { label: 'Card view', icon: LayoutGrid },
  compact: { label: 'Compact view', icon: Rows3 },
  table: { label: 'Table view', icon: Table2 },
};

interface RangeField {
  key: BeatmapListRangeKey;
  label: string;
  /** The chip's name when the panel's label carries a unit. */
  chipLabel?: string;
  min: number;
  max: number;
  /**
   * The param's `integer`, false when left out. Always passed on, because
   * RangeFilter would otherwise guess from the track, and BPM's whole-number
   * track would round a typed fraction that the address keeps.
   */
  integer?: boolean;
  step?: number;
  scale?: NumericScale;
  span?: 'half';
  valueLabel?: string;
  format?: (value: number) => string;
}

// Domains match BEATMAP_LIST_PARAMS; scales follow the real distribution.
const RANGE_FIELDS: readonly RangeField[] = [
  { key: 'sr', label: 'SR', min: 0, max: 15, step: 0.1 },
  { key: 'bpm', label: 'BPM', min: 0, max: 600, step: 1 },
  {
    key: 'length',
    label: 'Length (seconds)',
    chipLabel: 'Length',
    valueLabel: 'length',
    format: formatDuration,
    min: 0,
    max: 1800,
    integer: true,
    scale: tieredScale({
      tiers: [
        { start: 0, end: 300, step: 5 },
        { start: 300, end: 600, step: 10 },
        { start: 600, end: 1800, step: 60 },
      ],
    }),
  },
  {
    key: 'games',
    label: 'Games',
    min: 0,
    max: 600,
    integer: true,
    scale: tieredScale({
      tiers: [
        { start: 0, end: 50, step: 1 },
        { start: 50, end: 200, step: 5 },
        { start: 200, end: 600, step: 25 },
      ],
    }),
  },
  {
    key: 'tournaments',
    label: 'Tournaments',
    min: 0,
    max: 80,
    integer: true,
    scale: tieredScale({
      tiers: [
        { start: 0, end: 30, step: 1 },
        { start: 30, end: 80, step: 5 },
      ],
    }),
  },
  { key: 'cs', label: 'CS', min: 0, max: 10, step: 0.1, span: 'half' },
  { key: 'ar', label: 'AR', min: 0, max: 10, step: 0.1, span: 'half' },
  { key: 'od', label: 'OD', min: 0, max: 10, step: 0.1, span: 'half' },
  { key: 'hp', label: 'HP', min: 0, max: 10, step: 0.1, span: 'half' },
];

/**
 * The beatmap list's toolbar: search, sort and filters on the first row,
 * ruleset chips, the layout toggle and the count on the second, and the
 * active filters under both. Everything but the layout lives in the address.
 */
export default function BeatmapListToolbar({
  list,
  defaultRulesets,
  layout,
  onLayoutChange,
  totalCount,
}: {
  list: BeatmapList;
  /**
   * The visitor's browsing ruleset, which an address without a ruleset
   * shows; empty for every ruleset. Choosing it leaves the ruleset out of
   * the address.
   */
  defaultRulesets: readonly Ruleset[];
  layout: BeatmapLayout;
  onLayoutChange: (layout: BeatmapLayout) => void;
  totalCount: number;
}) {
  const { state, setState } = list;

  const activeFilters: ActiveFilter[] = RANGE_FIELDS.map((field) => ({
    key: field.key,
    label: formatRangeFilterLabel(
      field.chipLabel ?? field.label,
      state[field.key],
      field.format ?? formatFilterNumber
    ),
    onRemove: () => setState({ [field.key]: {} }),
  }));

  return (
    <ListToolbar
      label="Search and filter beatmaps"
      data-testid="beatmap-toolbar"
      search={
        <SearchField
          data-testid="beatmap-search"
          // The short placeholder fits a phone; the name keeps the full scope.
          label="Search beatmaps by title, artist, difficulty, mapper or ID"
          placeholder="Title, artist, mapper or ID"
          value={state.q}
          pending={list.isPending}
          onSearch={(q) => setState({ q })}
        />
      }
      sort={
        <SortControl
          data-testid="beatmap-sort"
          label="Sort beatmaps by"
          options={SORT_OPTIONS}
          value={state.sort}
          onValueChange={(sort) => setState({ sort })}
        />
      }
      filters={
        <FilterPanel
          title="Filter beatmaps"
          activeCount={list.activeFilterCount}
          onClearAll={list.clearFilters}
        >
          {RANGE_FIELDS.map((field) => (
            <RangeFilter
              key={field.key}
              label={field.label}
              valueLabel={field.valueLabel}
              span={field.span}
              min={field.min}
              max={field.max}
              integer={field.integer ?? false}
              step={field.step}
              scale={field.scale}
              format={field.format}
              value={state[field.key]}
              onValueChange={(range) => setState({ [field.key]: range })}
            />
          ))}
        </FilterPanel>
      }
      rulesets={
        <RulesetChips
          data-testid="beatmap-ruleset-filters"
          value={state.ruleset ?? defaultRulesets}
          onValueChange={(ruleset) =>
            setState({ ruleset: valuesForAddress(ruleset, defaultRulesets) })
          }
        />
      }
      view={<LayoutToggle layout={layout} onLayoutChange={onLayoutChange} />}
      count={formatCountOf(totalCount, 'beatmap')}
      activeFilters={
        <ActiveFilterChips
          filters={activeFilters}
          onClearAll={list.clearFilters}
        />
      }
    />
  );
}

/** Cards, compact rows or a table: a device preference, kept in storage. */
function LayoutToggle({
  layout,
  onLayoutChange,
}: {
  layout: BeatmapLayout;
  onLayoutChange: (layout: BeatmapLayout) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={layout}
      // Radix emits '' when the active item is re-clicked.
      onValueChange={(value) => {
        if (isBeatmapLayout(value)) onLayoutChange(value);
      }}
      role="radiogroup"
      aria-label="Beatmap layout"
      data-testid="beatmap-layout-toggle"
      data-layout={layout}
    >
      {/* No tooltips: a TooltipTrigger's `data-state` replaces the item's `on`/`off` */}
      {BEATMAP_LAYOUTS.map((value) => {
        const { label, icon: Icon } = LAYOUT_OPTIONS[value];

        return (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-label={label}
            data-testid={`beatmap-layout-${value}`}
            // Radios: arrow-key focus has to select.
            onFocus={() => onLayoutChange(value)}
            className="size-8 data-[state=off]:bg-background data-[state=on]:bg-primary/10 data-[state=on]:text-primary dark:data-[state=off]:bg-input/50 dark:data-[state=on]:bg-primary/20"
          >
            <Icon aria-hidden="true" />
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
