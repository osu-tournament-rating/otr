'use client';

import type { Ruleset } from '@otr/core/osu';

import {
  TOURNAMENT_LIST_PARAMS,
  TOURNAMENT_REJECTION_REASONS,
  TOURNAMENT_SORT_OPTIONS,
  LOBBY_SIZES,
  rulesetsForAddress,
  type TournamentListState,
} from '@/app/tournaments/list-params';
import {
  ActiveFilterChips,
  type ActiveFilter,
} from '@/components/kit/lists/ActiveFilterChips';
import { DayRangeFilter } from '@/components/kit/lists/DayRangeFilter';
import {
  ChoiceFilter,
  FilterPanel,
  SwitchFilter,
} from '@/components/kit/lists/FilterPanel';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { RangeFilter } from '@/components/kit/lists/RangeFilter';
import { RulesetChips } from '@/components/kit/lists/RulesetChips';
import { SearchField } from '@/components/kit/lists/SearchField';
import { SortControl } from '@/components/kit/lists/SortControl';
import { VerificationStatusGlyph } from '@/components/kit/status/VerificationStatusIcon';
import {
  RANK_RANGE_MAX,
  RANK_RANGE_MIN,
  tournamentRankScale,
} from '@/lib/filters/tournament-rank';
import { TOURNAMENT_REJECTION_REASON_LABELS } from '@/lib/kit/format/enum-labels';
import { formatLobbySize } from '@/lib/kit/format/fields';
import { formatId } from '@/lib/kit/format/number';
import {
  formatChoiceFilterLabel,
  formatDayRangeFilterLabel,
  formatRangeFilterLabel,
} from '@/lib/kit/lists/filters';
import { useListState } from '@/lib/kit/lists/use-list-state';
import {
  VERIFICATION_STATUS_ORDER,
  getVerificationStatusName,
} from '@/lib/kit/status/verification';

const STATUS_OPTIONS = VERIFICATION_STATUS_ORDER.map((status) => ({
  value: status,
  label: getVerificationStatusName(status),
  icon: <VerificationStatusGlyph status={status} className="size-4" />,
}));

const LOBBY_SIZE_OPTIONS = LOBBY_SIZES.map((size) => ({
  value: size,
  label: formatLobbySize(size),
}));

const REJECTION_REASON_OPTIONS = TOURNAMENT_REJECTION_REASONS.map((reason) => ({
  value: reason,
  label: TOURNAMENT_REJECTION_REASON_LABELS[reason],
}));

function getActiveFilters(
  state: TournamentListState,
  update: (patch: Partial<TournamentListState>) => void
): ActiveFilter[] {
  return [
    {
      key: 'status',
      label: formatChoiceFilterLabel(
        'Status',
        state.status.map(getVerificationStatusName)
      ),
      onRemove: () => update({ status: [] }),
    },
    {
      key: 'lobbySize',
      label: formatChoiceFilterLabel(
        'Lobby size',
        state.lobbySize.map((size) => formatLobbySize(size))
      ),
      onRemove: () => update({ lobbySize: [] }),
    },
    {
      key: 'reason',
      label: formatChoiceFilterLabel(
        'Rejection reason',
        state.reason.map((reason) => TOURNAMENT_REJECTION_REASON_LABELS[reason])
      ),
      onRemove: () => update({ reason: [] }),
    },
    {
      key: 'rank',
      label: formatRangeFilterLabel('Rank restriction', state.rank),
      onRemove: () => update({ rank: {} }),
    },
    {
      key: 'date',
      label: formatDayRangeFilterLabel('Dates', state.date),
      onRemove: () => update({ date: {} }),
    },
    {
      key: 'verified',
      label: state.verified ? 'Verified only' : '',
      onRemove: () => update({ verified: false }),
    },
    {
      key: 'submittedBy',
      label:
        state.submittedBy === undefined
          ? ''
          : `Submitted by user ${formatId(state.submittedBy)}`,
      onRemove: () => update({ submittedBy: undefined }),
    },
    {
      key: 'verifiedBy',
      label:
        state.verifiedBy === undefined
          ? ''
          : `Verified by user ${formatId(state.verifiedBy)}`,
      onRemove: () => update({ verifiedBy: undefined }),
    },
  ];
}

/**
 * The tournament list's toolbar: search, sort, filters and ruleset chips,
 * all kept in the page address, with the result count from the server.
 */
export default function TournamentListToolbar({
  count,
  defaultRulesets,
}: {
  count?: string;
  /**
   * The visitor's browsing ruleset, which an address without a ruleset
   * shows; empty for every ruleset. Choosing it leaves the ruleset out of
   * the address.
   */
  defaultRulesets: readonly Ruleset[];
}) {
  const list = useListState(TOURNAMENT_LIST_PARAMS);
  const { state, setState } = list;

  return (
    <ListToolbar
      label="Search and filter tournaments"
      search={
        <SearchField
          label="Search tournaments by name or abbreviation"
          // Short enough for the box at tablet width; the label says it all.
          placeholder="Name or abbreviation"
          value={state.q}
          pending={list.isPending}
          onSearch={(q) => setState({ q })}
        />
      }
      sort={
        <SortControl
          label="Sort tournaments by"
          options={TOURNAMENT_SORT_OPTIONS}
          value={state.sort}
          onValueChange={(sort) => setState({ sort })}
        />
      }
      filters={
        <FilterPanel
          title="Filter tournaments"
          activeCount={list.activeFilterCount}
          onClearAll={list.clearFilters}
        >
          <ChoiceFilter
            label="Status"
            options={STATUS_OPTIONS}
            value={state.status}
            onValueChange={(status) => setState({ status })}
          />
          <ChoiceFilter
            label="Lobby size"
            options={LOBBY_SIZE_OPTIONS}
            value={state.lobbySize}
            onValueChange={(lobbySize) => setState({ lobbySize })}
          />
          <ChoiceFilter
            label="Rejection reason"
            options={REJECTION_REASON_OPTIONS}
            value={state.reason}
            onValueChange={(reason) => setState({ reason })}
          />
          <RangeFilter
            label="Rank restriction"
            valueLabel="rank"
            description="Use 1 for open-rank tournaments."
            min={RANK_RANGE_MIN}
            max={RANK_RANGE_MAX}
            scale={tournamentRankScale}
            value={state.rank}
            onValueChange={(rank) => setState({ rank })}
          />
          <DayRangeFilter
            label="Tournament dates"
            value={state.date}
            onValueChange={(date) => setState({ date })}
          />
          <SwitchFilter
            label="Verified only"
            checked={state.verified}
            onCheckedChange={(verified) => setState({ verified })}
          />
        </FilterPanel>
      }
      rulesets={
        <RulesetChips
          value={state.ruleset ?? defaultRulesets}
          onValueChange={(ruleset) =>
            setState({ ruleset: rulesetsForAddress(ruleset, defaultRulesets) })
          }
        />
      }
      count={count}
      activeFilters={
        <ActiveFilterChips
          filters={getActiveFilters(state, setState)}
          onClearAll={list.clearFilters}
        />
      }
    />
  );
}
