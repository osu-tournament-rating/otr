'use client';

import type * as React from 'react';

import BeatmapCoverPreview from '@/components/beatmaps/BeatmapCoverPreview';
import BeatmapIdentity from '@/components/beatmaps/BeatmapIdentity';
import BeatmapTopMods from '@/components/beatmaps/BeatmapTopMods';
import StarRatingPill from '@/components/beatmaps/StarRatingPill';
import { RulesetName } from '@/components/kit/format/RulesetName';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import {
  DataTableLinkCell,
  DataTableLinkRow,
} from '@/components/kit/tables/DataTableLinkRow';
import { SortableHeader } from '@/components/kit/tables/SortableHeader';
import { Checkbox } from '@/components/ui/checkbox';
import type {
  BeatmapListSortChange,
  BeatmapListSortKey,
} from '@/lib/beatmaps/list-params';
import {
  getBeatmapDisplayRuleset,
  isManiaRuleset,
} from '@/lib/beatmaps/presentation';
import type { BeatmapTableRow } from '@/lib/beatmaps/table-row';
import { formatDuration } from '@/lib/kit/format/date';
import { formatCount, formatNumber } from '@/lib/kit/format/number';
import { fromDescending, type SortState } from '@/lib/kit/lists/sort';
import type { ColumnBreakpoint } from '@/lib/kit/tables/cell';
import { cn } from '@/lib/utils';

/** Row selection, for the surfaces that let an admin act on a set of rows. */
export interface BeatmapTableSelection {
  isSelected: (row: BeatmapTableRow) => boolean;
  onSelect: (row: BeatmapTableRow, checked: boolean) => void;
  allSelected: boolean;
  onSelectAll: (checked: boolean) => void;
  /** Names a row inside its checkbox's accessible label. */
  getRowLabel: (row: BeatmapTableRow) => string;
}

interface BeatmapListTableProps {
  beatmaps: BeatmapTableRow[];
  sort: BeatmapListSortKey;
  descending: boolean;
  onSortChange: BeatmapListSortChange;
  /** A single tournament's pool has nothing to count here. */
  showTournamentCount?: boolean;
  selection?: BeatmapTableSelection;
  /** A width floor for callers that keep this table on phones. */
  minWidthClassName?: string;
  stickyHeader?: boolean;
  /** Rows shown instead of the table below tablet width. */
  phoneRows?: React.ReactNode;
  /**
   * The sort above `phoneRows`, for a caller whose only sort is the table's
   * headers: a `SortControl size="sm"` on the same sort (DataTable's
   * `phoneSort`). The beatmap list leaves it out; its toolbar sorts.
   */
  phoneSort?: React.ReactNode;
  /** Classes for the wrapper around the table. */
  className?: string;
}

// One width and breakpoint per column, shared by its header and its cells.
const COLUMN = {
  select: { className: 'w-11' },
  mode: { className: 'w-13' },
  sr: { className: 'w-22' },
  bpm: { className: 'w-17' },
  length: { className: 'w-20' },
  cs: { className: 'w-15', showFrom: 'xl' },
  ar: { className: 'w-15', showFrom: 'xl' },
  games: { className: 'w-20' },
  // From `lg`: at tablet width the beatmap's name needs the room.
  tournaments: { className: 'w-29', showFrom: 'lg' },
  mods: { className: 'w-34', showFrom: 'lg' },
} as const satisfies Record<
  string,
  { className: string; showFrom?: ColumnBreakpoint }
>;

/**
 * The dense layout, shared by the beatmap list and a tournament's pool. Each
 * row opens its beatmap as a whole. Sorting is the caller's: the list keeps
 * it in the address and reloads server-sorted rows, while a pool the caller
 * holds in full sorts in place.
 */
export default function BeatmapListTable({
  beatmaps,
  sort,
  descending,
  onSortChange,
  showTournamentCount = true,
  selection,
  minWidthClassName,
  stickyHeader = false,
  phoneRows,
  phoneSort,
  className,
}: BeatmapListTableProps) {
  const sortState = fromDescending(sort, descending);
  const sortProps = {
    sort: sortState,
    onSortChange: (next: SortState<BeatmapListSortKey>) =>
      onSortChange(next.key, next.direction === 'desc'),
    numeric: true,
  };

  return (
    <DataTable
      fixed
      stickyHeader={stickyHeader}
      phoneRows={phoneRows}
      phoneSort={phoneSort}
      containerClassName={className}
      className={minWidthClassName}
    >
      <DataTableHeader>
        <DataTableRow>
          {selection ? (
            <DataTableHead {...COLUMN.select}>
              <Checkbox
                data-testid="beatmap-table-select-all"
                checked={selection.allSelected}
                onCheckedChange={(checked) =>
                  selection.onSelectAll(checked === true)
                }
                aria-label="Select all beatmaps"
              />
            </DataTableHead>
          ) : null}
          {/* Not sortable: the server has no title sort. */}
          <DataTableHead className={cn(selection && 'pl-1')}>
            Beatmap
          </DataTableHead>
          <DataTableHead {...COLUMN.mode}>Mode</DataTableHead>
          <SortableHeader {...sortProps} {...COLUMN.sr} sortKey="sr">
            SR
          </SortableHeader>
          <SortableHeader {...sortProps} {...COLUMN.bpm} sortKey="bpm">
            BPM
          </SortableHeader>
          <SortableHeader {...sortProps} {...COLUMN.length} sortKey="length">
            Length
          </SortableHeader>
          <SortableHeader {...sortProps} {...COLUMN.cs} sortKey="cs">
            CS
          </SortableHeader>
          <SortableHeader {...sortProps} {...COLUMN.ar} sortKey="ar">
            AR
          </SortableHeader>
          <SortableHeader {...sortProps} {...COLUMN.games} sortKey="gameCount">
            Games
          </SortableHeader>
          {showTournamentCount ? (
            <SortableHeader
              {...sortProps}
              {...COLUMN.tournaments}
              sortKey="tournamentCount"
            >
              Tournaments
            </SortableHeader>
          ) : null}
          <DataTableHead {...COLUMN.mods}>Mods</DataTableHead>
        </DataTableRow>
      </DataTableHeader>

      <DataTableBody>
        {beatmaps.map((beatmap) => {
          const ruleset = getBeatmapDisplayRuleset(
            beatmap.ruleset,
            beatmap.diffName
          );

          return (
            <DataTableLinkRow
              key={beatmap.id}
              data-testid={`beatmap-list-row-${beatmap.osuId}`}
              data-state={
                selection?.isSelected(beatmap) ? 'selected' : undefined
              }
            >
              {selection ? (
                <DataTableCell {...COLUMN.select} empty={false}>
                  <Checkbox
                    checked={selection.isSelected(beatmap)}
                    onCheckedChange={(checked) =>
                      selection.onSelect(beatmap, checked === true)
                    }
                    aria-label={`Select ${selection.getRowLabel(beatmap)}`}
                  />
                </DataTableCell>
              ) : null}

              <DataTableLinkCell
                href={`/beatmaps/${beatmap.osuId}`}
                label={`View ${beatmap.artist} - ${beatmap.title} [${beatmap.diffName}]`}
                className={cn(
                  selection && 'pl-1',
                  beatmap.isDeleted &&
                    '[&_[data-testid=beatmap-title]]:text-muted-foreground [&_[data-testid=beatmap-title]]:line-through'
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <BeatmapIdentity
                    osuId={beatmap.osuId}
                    beatmapsetOsuId={beatmap.beatmapsetOsuId}
                    artist={beatmap.artist}
                    title={beatmap.title}
                    diffName={beatmap.diffName}
                    creator={beatmap.creator}
                    size="table"
                    coverSizes="72px"
                    className="min-w-0 flex-1"
                  >
                    <BeatmapCoverPreview
                      beatmapsetOsuId={beatmap.beatmapsetOsuId}
                      artist={beatmap.artist}
                      title={beatmap.title}
                      difficulty={beatmap.diffName}
                      size="sm"
                      className="rounded-md"
                    />
                  </BeatmapIdentity>
                  {beatmap.isDeleted ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Deleted
                    </span>
                  ) : null}
                </div>
              </DataTableLinkCell>

              <DataTableCell {...COLUMN.mode}>
                {/* Above the row link, so its name opens on tap. */}
                <RulesetName
                  ruleset={ruleset}
                  iconOnly
                  className="relative z-20"
                />
              </DataTableCell>

              <DataTableCell {...COLUMN.sr} align="end">
                <StarRatingPill starRating={beatmap.sr} />
              </DataTableCell>
              <DataTableCell {...COLUMN.bpm} numeric>
                {formatCount(Math.round(beatmap.bpm))}
              </DataTableCell>
              <DataTableCell {...COLUMN.length} numeric>
                {formatDuration(Number(beatmap.totalLength))}
              </DataTableCell>
              <DataTableCell {...COLUMN.cs} numeric>
                {formatNumber(beatmap.cs, { decimals: 1 })}
              </DataTableCell>
              <DataTableCell {...COLUMN.ar} numeric>
                {formatNumber(beatmap.ar, { decimals: 1 })}
              </DataTableCell>
              <DataTableCell {...COLUMN.games} numeric>
                {formatCount(beatmap.gameCount)}
              </DataTableCell>
              {showTournamentCount ? (
                <DataTableCell {...COLUMN.tournaments} numeric>
                  {formatCount(beatmap.tournamentCount)}
                </DataTableCell>
              ) : null}
              <DataTableCell {...COLUMN.mods} empty={false}>
                {isManiaRuleset(ruleset) ? null : (
                  // Only the dominant group; a second pill costs the beatmap column 72px.
                  <BeatmapTopMods
                    mods={beatmap.topMods.slice(0, 1)}
                    showIcon={false}
                    maxBadges={1}
                  />
                )}
              </DataTableCell>
            </DataTableLinkRow>
          );
        })}
      </DataTableBody>
    </DataTable>
  );
}
