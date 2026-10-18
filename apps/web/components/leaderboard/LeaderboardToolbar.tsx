'use client';

import type { Ruleset } from '@otr/core/osu';

import {
  LEADERBOARD_LIST_PARAMS,
  LEADERBOARD_MATCHES_SCALE,
  LEADERBOARD_RANGES,
  LEADERBOARD_TIER_LABELS,
} from '@/app/leaderboard/list-params';
import { CountryCombobox } from '@/components/kit/country/CountryCombobox';
import { ActiveFilterChips } from '@/components/kit/lists/ActiveFilterChips';
import {
  ChoiceFilter,
  FilterField,
  FilterPanel,
} from '@/components/kit/lists/FilterPanel';
import { RangeFilter } from '@/components/kit/lists/RangeFilter';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { RulesetSwitch } from '@/components/kit/lists/RulesetSwitch';
import { ScopeSwitch } from '@/components/kit/lists/ScopeSwitch';
import { SearchField } from '@/components/kit/lists/SearchField';
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';
import { tournamentRankScale } from '@/lib/filters/tournament-rank';
import { type CountryOption, getCountryName } from '@/lib/kit/format/country';
import { fieldLabel } from '@/lib/kit/format/fields';
import {
  formatChoiceFilterLabel,
  formatFilterNumber,
  formatRangeFilterLabel,
} from '@/lib/kit/lists/filters';
import { useListState } from '@/lib/kit/lists/use-list-state';
import {
  leaderboardTierKeys,
  type LeaderboardSort,
} from '@/lib/orpc/schema/leaderboard';

// Each key starts highest first, as the column headers do.
const SORT_OPTIONS: readonly SortOption<LeaderboardSort>[] = [
  { value: 'rating', label: 'Rating', defaultDirection: 'desc' },
  { value: 'tournaments', label: 'Tournaments', defaultDirection: 'desc' },
  { value: 'matches', label: 'Matches', defaultDirection: 'desc' },
  { value: 'winRate', label: 'Win rate', defaultDirection: 'desc' },
];

const TIER_OPTIONS = leaderboardTierKeys.map((tier) => ({
  value: tier,
  label: LEADERBOARD_TIER_LABELS[tier],
}));

const OSU_RANK_LABEL = fieldLabel('osuRank');
const WIN_RATE_LABEL = fieldLabel('winRate');

const formatWinRate = (value: number) => `${formatFilterNumber(value)}%`;

/**
 * The strip at the top of the leaderboard's panel: player search, sort and
 * filters, then All / Friends, the ruleset and the player count. Everything
 * it changes lives in the address.
 */
export default function LeaderboardToolbar({
  count,
  countries,
  signedIn,
  hasFriends,
  defaultRuleset,
}: {
  /** The player count, already formatted. */
  count: string;
  /**
   * The country filter's options, named on the server
   * (`getCountryOptions()`), so the browser's region names never differ.
   */
  countries: readonly CountryOption[];
  /** All / Friends shows only to signed-in visitors. */
  signedIn: boolean;
  hasFriends: boolean;
  /**
   * The visitor's browsing ruleset, which an address without a ruleset
   * shows. Choosing it leaves the ruleset out of the address.
   */
  defaultRuleset: Ruleset;
}) {
  const list = useListState(LEADERBOARD_LIST_PARAMS);
  const { state, setState } = list;
  // A code the options leave out (osu!'s `EU` from a flag link) is named
  // as the combobox names it.
  const countryName = state.country
    ? (countries.find((country) => country.code === state.country)?.name ??
      getCountryName(state.country))
    : '';

  return (
    <ListToolbar
      label="Search and filter players"
      search={
        <SearchField
          label="Search players"
          placeholder="Search players"
          value={state.q}
          pending={list.isPending}
          onSearch={(q) => setState({ q })}
        />
      }
      sort={
        <SortControl
          label="Sort players by"
          options={SORT_OPTIONS}
          value={state.sort}
          onValueChange={(sort) => setState({ sort })}
        />
      }
      filters={
        <FilterPanel
          title="Filter players"
          activeCount={list.activeFilterCount}
          onClearAll={list.clearFilters}
        >
          <RangeFilter
            label="Rating"
            valueLabel="rating"
            {...LEADERBOARD_RANGES.rating}
            step={20}
            value={state.rating}
            onValueChange={(rating) => setState({ rating })}
          />
          <RangeFilter
            label={OSU_RANK_LABEL}
            valueLabel={OSU_RANK_LABEL}
            {...LEADERBOARD_RANGES.osuRank}
            scale={tournamentRankScale}
            value={state.osuRank}
            onValueChange={(osuRank) => setState({ osuRank })}
          />
          <RangeFilter
            label="Matches"
            valueLabel="matches"
            {...LEADERBOARD_RANGES.matches}
            scale={LEADERBOARD_MATCHES_SCALE}
            value={state.matches}
            onValueChange={(matches) => setState({ matches })}
          />
          <RangeFilter
            label={WIN_RATE_LABEL}
            valueLabel="win rate"
            {...LEADERBOARD_RANGES.winRate}
            // The table shows win rate to one decimal, and the filter has
            // always taken one (55.5).
            step={0.1}
            format={formatWinRate}
            value={state.winRate}
            onValueChange={(winRate) => setState({ winRate })}
          />
          <ChoiceFilter
            label="Tiers"
            options={TIER_OPTIONS}
            value={state.tiers}
            onValueChange={(tiers) => setState({ tiers })}
          />
          <FilterField label="Country">
            <CountryCombobox
              value={state.country}
              onValueChange={(country) => setState({ country })}
              countries={countries}
              data-testid="leaderboard-filter-country-button"
            />
          </FilterField>
        </FilterPanel>
      }
      scope={
        signedIn ? (
          <ScopeSwitch
            data-testid="leaderboard-tabs"
            label="Players to show"
            value={state.friend ? 'friends' : 'all'}
            onValueChange={(scope) => setState({ friend: scope === 'friends' })}
            options={[
              { value: 'all', label: 'All' },
              {
                value: 'friends',
                label: 'Friends',
                disabled: !hasFriends,
                disabledReason: 'Sync friends in settings to enable',
              },
            ]}
          />
        ) : undefined
      }
      rulesets={
        <RulesetSwitch
          value={state.ruleset ?? defaultRuleset}
          onValueChange={(ruleset) =>
            setState({
              ruleset: ruleset === defaultRuleset ? undefined : ruleset,
            })
          }
        />
      }
      count={count}
      activeFilters={
        <ActiveFilterChips
          onClearAll={list.clearFilters}
          filters={[
            {
              key: 'rating',
              label: formatRangeFilterLabel('Rating', state.rating),
              onRemove: () => setState({ rating: {} }),
            },
            {
              key: 'osuRank',
              label: formatRangeFilterLabel(OSU_RANK_LABEL, state.osuRank),
              onRemove: () => setState({ osuRank: {} }),
            },
            {
              key: 'matches',
              label: formatRangeFilterLabel('Matches', state.matches),
              onRemove: () => setState({ matches: {} }),
            },
            {
              key: 'winRate',
              label: formatRangeFilterLabel(
                WIN_RATE_LABEL,
                state.winRate,
                formatWinRate
              ),
              onRemove: () => setState({ winRate: {} }),
            },
            {
              key: 'tiers',
              label: formatChoiceFilterLabel(
                'Tiers',
                state.tiers.map((tier) => LEADERBOARD_TIER_LABELS[tier])
              ),
              onRemove: () => setState({ tiers: [] }),
            },
            {
              key: 'country',
              label: countryName ? `Country: ${countryName}` : '',
              onRemove: () => setState({ country: '' }),
            },
          ]}
        />
      }
    />
  );
}
