'use client';

import { Mods, Ruleset, VerificationStatus } from '@otr/core/osu';
import { ChartLine, LayoutGrid, Rows3, Table2, Trophy } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';

import { GallerySection, Specimen } from '../gallery';
import {
  DEFAULT_LEADERBOARD_RULESET,
  LEADERBOARD_LIST_PARAMS,
  LEADERBOARD_MATCHES_SCALE,
  LEADERBOARD_RANGES,
  LEADERBOARD_TIER_LABELS,
} from '@/app/leaderboard/list-params';
import { rulesetsForAddress } from '@/app/tournaments/list-params';
import { AuditSystemSwitch } from '@/components/audit/AuditSystemSwitch';
import BeatmapCover from '@/components/beatmaps/BeatmapCover';
import { Button } from '@/components/kit/controls/Button';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  ActiveFilterChips,
  type ActiveFilter,
} from '@/components/kit/lists/ActiveFilterChips';
import { ChoiceChip } from '@/components/kit/lists/ChoiceChip';
import { Calendar, DateField } from '@/components/kit/lists/DateField';
import { DayRangeFilter } from '@/components/kit/lists/DayRangeFilter';
import { FilterButton } from '@/components/kit/lists/FilterButton';
import {
  ChoiceFilter,
  FilterPanel,
  FilterPanelContent,
  SwitchFilter,
} from '@/components/kit/lists/FilterPanel';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { RangeFilter } from '@/components/kit/lists/RangeFilter';
import { RulesetChips } from '@/components/kit/lists/RulesetChips';
import { RulesetSwitch } from '@/components/kit/lists/RulesetSwitch';
import { ScopeSwitch } from '@/components/kit/lists/ScopeSwitch';
import { SearchField } from '@/components/kit/lists/SearchField';
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';
import {
  VerificationStatusGlyph,
  VerificationStatusIcon,
} from '@/components/kit/status/VerificationStatusIcon';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { tieredScale } from '@/lib/filters/scale';
import { tournamentRankScale } from '@/lib/filters/tournament-rank';
import { formatDateRange } from '@/lib/kit/format/date';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatMods } from '@/lib/kit/format/mods';
import {
  formatCount,
  formatCountOf,
  formatPercent,
  formatRank,
  formatRating,
} from '@/lib/kit/format/number';
import { RATED_RULESETS, getRulesetLabel } from '@/lib/kit/format/ruleset';
import {
  formatChoiceFilterLabel,
  formatDayRangeFilterLabel,
  formatRangeFilterLabel,
} from '@/lib/kit/lists/filters';
import {
  applyListPatch,
  arrayParam,
  booleanParam,
  clearListFilters,
  countActiveFilters,
  dayRangeParam,
  defineListParams,
  enumParam,
  flagsParam,
  getDefaultListState,
  listStateHref,
  pageParam,
  rangeParam,
  searchParam,
  sortParam,
  type ListParams,
  type ListState,
} from '@/lib/kit/lists/params';
import { normalizeSearchTerm } from '@/lib/kit/lists/search';
import { useListState } from '@/lib/kit/lists/use-list-state';
import {
  leaderboardTierKeys,
  type LeaderboardSort,
} from '@/lib/orpc/schema/leaderboard';
import {
  VERIFICATION_STATUS_ORDER,
  getVerificationStatusName,
} from '@/lib/kit/status/verification';
import { cn } from '@/lib/utils';

const KIT = '@/components/kit/lists';

// --- Demo data ----------------------------------------------------------------

type TournamentSortKey = 'endTime' | 'startTime' | 'submitted' | 'lobbySize';

// The tournament list's own sort keys. Like the list, a new key keeps the
// current direction.
const TOURNAMENT_SORTS: readonly SortOption<TournamentSortKey>[] = [
  { value: 'endTime', label: 'End date' },
  { value: 'startTime', label: 'Start date' },
  { value: 'submitted', label: 'Submission date' },
  { value: 'lobbySize', label: 'Lobby size' },
];

const LOBBY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * The spec a tournaments page would share between its server page and client
 * toolbar. A bare address shows the visitor's browsing ruleset, so every
 * ruleset is `ruleset=all`.
 */
const TOURNAMENT_PARAMS = defineListParams({
  q: searchParam(),
  page: pageParam(),
  sort: sortParam(
    TOURNAMENT_SORTS.map((option) => option.value),
    { key: 'endTime', direction: 'desc' }
  ),
  ruleset: arrayParam(RATED_RULESETS, { role: 'scope', allValue: 'all' }),
  status: arrayParam(VERIFICATION_STATUS_ORDER),
  lobbySize: arrayParam(LOBBY_SIZES),
  rank: rangeParam({ min: 1, max: 1_000_000, integer: true }),
  date: dayRangeParam(),
  verified: booleanParam(),
});

type TournamentState = ListState<typeof TOURNAMENT_PARAMS>;

/** The demo visitor's browsing ruleset, which a bare address shows. */
const DEMO_BROWSING_RULESETS: readonly Ruleset[] = [Ruleset.Osu];

interface DemoTournament {
  id: number;
  name: string;
  abbreviation: string;
  ruleset: Ruleset;
  lobbySize: number;
  rank: number;
  start: string;
  end: string;
  submitted: string;
  status: VerificationStatus;
}

const DEMO_TOURNAMENTS: readonly DemoTournament[] = [
  {
    id: 1,
    name: 'osu! World Cup 2025',
    abbreviation: 'OWC2025',
    ruleset: Ruleset.Osu,
    lobbySize: 4,
    rank: 1,
    start: '2025-11-01',
    end: '2025-12-14',
    submitted: '2025-10-02',
    status: VerificationStatus.Verified,
  },
  {
    id: 2,
    name: 'Corsace Open 2025',
    abbreviation: 'CO25',
    ruleset: Ruleset.Osu,
    lobbySize: 4,
    rank: 1,
    start: '2025-09-06',
    end: '2025-10-19',
    submitted: '2025-08-11',
    status: VerificationStatus.PreVerified,
  },
  {
    id: 3,
    name: 'Taiko World Cup 2025',
    abbreviation: 'TWC2025',
    ruleset: Ruleset.Taiko,
    lobbySize: 3,
    rank: 1,
    start: '2025-06-14',
    end: '2025-08-03',
    submitted: '2025-05-20',
    status: VerificationStatus.Verified,
  },
  {
    id: 4,
    name: '5 Digit United States Cup 2026',
    abbreviation: '5USC26',
    ruleset: Ruleset.Osu,
    lobbySize: 3,
    rank: 10_000,
    start: '2026-06-26',
    end: '2026-08-09',
    submitted: '2026-06-01',
    status: VerificationStatus.None,
  },
  {
    id: 5,
    name: 'Mania 4K World Cup 2025',
    abbreviation: 'MWC4K',
    ruleset: Ruleset.Mania4k,
    lobbySize: 4,
    rank: 1,
    start: '2025-03-01',
    end: '2025-04-20',
    submitted: '2025-02-03',
    status: VerificationStatus.Verified,
  },
  {
    id: 6,
    name: 'Catch the Beat World Cup 2025',
    abbreviation: 'CWC2025',
    ruleset: Ruleset.Catch,
    lobbySize: 2,
    rank: 1,
    start: '2025-05-03',
    end: '2025-06-22',
    submitted: '2025-04-07',
    status: VerificationStatus.PreRejected,
  },
];

const STATUS_OPTIONS = VERIFICATION_STATUS_ORDER.map((status) => ({
  value: status,
  label: getVerificationStatusName(status),
  icon: <VerificationStatusGlyph status={status} className="size-4" />,
}));

const LOBBY_OPTIONS = LOBBY_SIZES.map((size) => ({
  value: size,
  label: formatLobbySize(size),
}));

function filterTournaments(state: TournamentState): DemoTournament[] {
  const term = normalizeSearchTerm(state.q).toLowerCase();
  const rulesets = state.ruleset ?? DEMO_BROWSING_RULESETS;
  const rows = DEMO_TOURNAMENTS.filter(
    (row) =>
      (!term ||
        row.name.toLowerCase().includes(term) ||
        row.abbreviation.toLowerCase().includes(term)) &&
      (rulesets.length === 0 || rulesets.includes(row.ruleset)) &&
      (state.status.length === 0 || state.status.includes(row.status)) &&
      (state.lobbySize.length === 0 ||
        state.lobbySize.some((size) => size === row.lobbySize)) &&
      (state.rank.min === undefined || row.rank >= state.rank.min) &&
      (state.rank.max === undefined || row.rank <= state.rank.max) &&
      // Like the list: started on or after From, ended on or before Through.
      (!state.date.from || row.start >= state.date.from) &&
      (!state.date.to || row.end <= state.date.to) &&
      (!state.verified || row.status === VerificationStatus.Verified)
  );

  const sortValue: Record<
    TournamentSortKey,
    (row: DemoTournament) => string | number
  > = {
    endTime: (row) => row.end,
    startTime: (row) => row.start,
    submitted: (row) => row.submitted,
    lobbySize: (row) => row.lobbySize,
  };
  const read = sortValue[state.sort.key];
  const sign = state.sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) =>
    read(a) < read(b) ? -sign : read(a) > read(b) ? sign : 0
  );
}

function tournamentActiveFilters(
  state: TournamentState,
  update: (patch: Partial<TournamentState>) => void
): ActiveFilter[] {
  return [
    {
      key: 'status',
      label: formatChoiceFilterLabel(
        'Status',
        state.status.map((status) => getVerificationStatusName(status))
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
  ];
}

/**
 * Local stand-in for `useListState`: the same spec and helpers, with React
 * state instead of the page address, so the gallery never navigates.
 */
function useDemoListState<P extends ListParams>(
  params: P,
  initial?: Partial<ListState<P>>
) {
  const [state, setState] = useState<ListState<P>>(() => ({
    ...getDefaultListState(params),
    ...initial,
  }));
  const [isPending, setPending] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Pretend the server takes a moment, so the search spinner shows.
  const settle = () => {
    setPending(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPending(false), 700);
  };

  return {
    state,
    isPending,
    activeFilterCount: countActiveFilters(params, state),
    setState: (patch: Partial<ListState<P>>) => {
      setState((current) => applyListPatch(params, current, patch));
      settle();
    },
    clearFilters: () => {
      setState((current) => clearListFilters(params, current));
      settle();
    },
  };
}

// --- Specimens ----------------------------------------------------------------

function TournamentToolbarDemo() {
  const list = useDemoListState(TOURNAMENT_PARAMS);
  const { state, setState } = list;
  const rows = useMemo(() => filterTournaments(state), [state]);
  const href = listStateHref('/tournaments', TOURNAMENT_PARAMS, state);

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <ListToolbar
          label="Search and filter tournaments"
          search={
            <SearchField
              label="Search tournaments by name or abbreviation"
              placeholder="Name or abbreviation"
              value={state.q}
              pending={list.isPending}
              onSearch={(q) => setState({ q })}
            />
          }
          sort={
            <SortControl
              label="Sort tournaments by"
              options={TOURNAMENT_SORTS}
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
                options={LOBBY_OPTIONS}
                value={state.lobbySize}
                onValueChange={(lobbySize) => setState({ lobbySize })}
              />
              <RangeFilter
                label="Rank restriction"
                valueLabel="rank"
                description="Use 1 for open-rank tournaments."
                min={1}
                max={1_000_000}
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
              value={state.ruleset ?? DEMO_BROWSING_RULESETS}
              onValueChange={(ruleset) =>
                setState({
                  ruleset: rulesetsForAddress(ruleset, DEMO_BROWSING_RULESETS),
                })
              }
            />
          }
          count={formatCountOf(rows.length, 'tournament', 'tournaments')}
          activeFilters={
            <ActiveFilterChips
              filters={tournamentActiveFilters(state, setState)}
              onClearAll={list.clearFilters}
            />
          }
        />
        {rows.length > 0 ? (
          // Tournament rows open as a whole, like the tournament list.
          <RowList>
            {rows.map((row) => (
              <RowListItem
                key={row.id}
                href="#lists-toolbar"
                linkLabel={`View ${row.name}`}
                leading={
                  <VerificationStatusIcon status={row.status} tooltip="hover" />
                }
                title={row.name}
                description={[
                  getRulesetLabel(row.ruleset),
                  formatLobbySize(row.lobbySize),
                  formatRankRange(row.rank),
                  formatDateRange(row.start, row.end),
                ].join(' · ')}
              />
            ))}
          </RowList>
        ) : (
          <EmptyState
            title="No tournaments match"
            description="Try a different name, ruleset, or fewer filters."
            clearFilters={
              list.activeFilterCount > 0
                ? { onClick: list.clearFilters }
                : undefined
            }
          />
        )}
      </Panel>
      <p className="text-xs break-all text-muted-foreground">Address: {href}</p>
    </div>
  );
}

const DEMO_PLAYERS = [
  {
    rank: 1,
    name: 'mrekk',
    tournaments: 58,
    winRate: 0.724,
    rating: 3121.4,
  },
  {
    rank: 2,
    name: 'lifeline',
    tournaments: 71,
    winRate: 0.689,
    rating: 3044.9,
  },
  {
    rank: 3,
    name: 'Accolibed',
    tournaments: 44,
    winRate: 0.701,
    rating: 2912.2,
  },
] as const;

const DEMO_BEATMAPS = [
  {
    id: 1,
    title: 'Hotohashiru',
    diff: 'Extra',
    artist: 'ORESAMA',
    mapper: 'Meg',
    games: 330,
  },
  {
    id: 2,
    title: 'sense',
    diff: "LC's Insane",
    artist: 'Mami Kawada',
    mapper: 'La Cataline',
    games: 314,
  },
  {
    id: 3,
    title: 'Nostalgic Blood of the Strife',
    diff: 'MAXIMUM',
    artist: 'Laur',
    mapper: 'Zelq',
    games: 288,
  },
] as const;

// The leaderboard's own spec, sort options and tier chips
// (components/leaderboard/LeaderboardToolbar.tsx); its osu! rank, win rate
// and country filters are left out here.
const LEADERBOARD_SORTS: readonly SortOption<LeaderboardSort>[] = [
  { value: 'rating', label: 'Rating', defaultDirection: 'desc' },
  { value: 'tournaments', label: 'Tournaments', defaultDirection: 'desc' },
  { value: 'matches', label: 'Matches', defaultDirection: 'desc' },
  { value: 'winRate', label: 'Win rate', defaultDirection: 'desc' },
];

const TIER_OPTIONS = leaderboardTierKeys.map((tier) => ({
  value: tier,
  label: LEADERBOARD_TIER_LABELS[tier],
}));

function LeaderboardToolbarDemo({ hasFriends }: { hasFriends: boolean }) {
  const list = useDemoListState(LEADERBOARD_LIST_PARAMS, {
    rating: { min: 1500 },
  });
  const { state, setState } = list;

  return (
    <Panel>
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
            options={LEADERBOARD_SORTS}
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
              label="Matches"
              valueLabel="matches"
              {...LEADERBOARD_RANGES.matches}
              scale={LEADERBOARD_MATCHES_SCALE}
              value={state.matches}
              onValueChange={(matches) => setState({ matches })}
            />
            <ChoiceFilter
              label="Tiers"
              options={TIER_OPTIONS}
              value={state.tiers}
              onValueChange={(tiers) => setState({ tiers })}
            />
          </FilterPanel>
        }
        scope={
          <ScopeSwitch
            label="Players to show"
            value={state.friend ? 'friends' : 'all'}
            onValueChange={(scope) => setState({ friend: scope === 'friends' })}
            options={[
              { value: 'all', label: 'All' },
              {
                value: 'friends',
                label: 'Friends',
                disabled: !hasFriends,
                disabledReason: 'Sync friends in Settings',
              },
            ]}
          />
        }
        rulesets={
          <RulesetSwitch
            value={state.ruleset ?? DEFAULT_LEADERBOARD_RULESET}
            onValueChange={(ruleset) =>
              setState({
                ruleset:
                  ruleset === DEFAULT_LEADERBOARD_RULESET ? undefined : ruleset,
              })
            }
          />
        }
        count={formatCountOf(3_906, 'player', 'players')}
        activeFilters={
          <ActiveFilterChips
            filters={[
              {
                key: 'rating',
                label: formatRangeFilterLabel('Rating', state.rating),
                onRemove: () => setState({ rating: {} }),
              },
              {
                key: 'matches',
                label: formatRangeFilterLabel('Matches', state.matches),
                onRemove: () => setState({ matches: {} }),
              },
              {
                key: 'tiers',
                label: formatChoiceFilterLabel(
                  'Tiers',
                  state.tiers.map((tier) => LEADERBOARD_TIER_LABELS[tier])
                ),
                onRemove: () => setState({ tiers: [] }),
              },
            ]}
            onClearAll={list.clearFilters}
          />
        }
      />
      {/* Only the names link on the leaderboard, so rows get no tint. */}
      <RowList>
        {DEMO_PLAYERS.map((player) => (
          <RowListItem
            key={player.rank}
            leading={
              <span className="inline-block w-8 text-sm font-medium text-muted-foreground tabular-nums">
                {formatRank(player.rank)}
              </span>
            }
            title={
              <EntityLink href="#lists-toolbar-scope">{player.name}</EntityLink>
            }
            description={`${formatCountOf(player.tournaments, 'tournament')} · ${formatPercent(player.winRate)} win rate`}
            trailing={
              <span className="font-semibold tabular-nums">
                {formatRating(player.rating)}
              </span>
            }
          />
        ))}
      </RowList>
    </Panel>
  );
}

// The admin report queue: no search, a status scope, and a date sort.
type ReportSortKey = 'created' | 'resolvedAt';
type ReportScope = 'all' | 'pending' | 'confirmed' | 'dismissed';

const NEWEST_FIRST = { desc: 'Newest first', asc: 'Oldest first' } as const;

const REPORT_SORTS: readonly SortOption<ReportSortKey>[] = [
  { value: 'created', label: 'Date submitted', directionLabels: NEWEST_FIRST },
  {
    value: 'resolvedAt',
    label: 'Date reviewed',
    directionLabels: NEWEST_FIRST,
  },
];

const REPORT_SCOPES: readonly { value: ReportScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dismissed', label: 'Dismissed' },
];

const REPORT_COUNTS: Record<ReportScope, number> = {
  all: 1_214,
  pending: 48,
  confirmed: 903,
  dismissed: 263,
};

function ReportQueueToolbarDemo() {
  const [scope, setScope] = useState<ReportScope>('pending');
  const [sort, setSort] = useState<{
    key: ReportSortKey;
    direction: 'asc' | 'desc';
  }>({ key: 'created', direction: 'desc' });

  return (
    <Panel>
      <ListToolbar
        label="Sort and filter reports"
        scope={
          <ScopeSwitch
            label="Status"
            value={scope}
            onValueChange={setScope}
            options={REPORT_SCOPES}
          />
        }
        sort={
          <SortControl
            label="Sort reports by"
            options={REPORT_SORTS}
            value={sort}
            onValueChange={setSort}
          />
        }
        count={formatCountOf(REPORT_COUNTS[scope], 'report')}
      />
      <RowList>
        {DEMO_REPORTS.map((report) => (
          <RowListItem
            key={report.entity}
            title={
              <EntityLink href="#lists-toolbar-no-search">
                {report.entity}
              </EntityLink>
            }
            description={`${report.type} · ${report.reason}`}
          />
        ))}
      </RowList>
    </Panel>
  );
}

// An entity's audit history (components/audit/AuditEntityTimeline.tsx):
// "Show system events" widens the list rather than filtering it, so it leads
// the strip, and the count stays on the right of the same line.
const AUDIT_HISTORY_ROWS = [
  { sentence: 'apricot verified', system: false },
  { sentence: 'System pre-verified', system: true },
  { sentence: 'Hobbes updated', system: false },
] as const;

function AuditHistoryToolbarDemo() {
  const [system, setSystem] = useState(false);
  const rows = AUDIT_HISTORY_ROWS.filter((row) => system || !row.system);

  return (
    <Panel>
      <ListToolbar
        label="Filter audit history"
        leading={
          <AuditSystemSwitch checked={system} onCheckedChange={setSystem} />
        }
        count={formatCountOf(rows.length, 'change')}
      />
      <RowList>
        {rows.map((row) => (
          <RowListItem key={row.sentence} title={row.sentence} />
        ))}
      </RowList>
    </Panel>
  );
}

const AUDIT_ACTIONS = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'deleted', label: 'Deleted' },
] as const;

type AuditAction = (typeof AUDIT_ACTIONS)[number]['value'];

/**
 * The audit log's strip: a switch that widens the feed leads it, and the
 * Filters button follows on the same line, on the right, even on a phone.
 */
function LeadingFiltersToolbarDemo() {
  const [system, setSystem] = useState(false);
  const [actions, setActions] = useState<AuditAction[]>([]);

  return (
    <Panel>
      <ListToolbar
        label="Filter audit events"
        leading={
          <AuditSystemSwitch checked={system} onCheckedChange={setSystem} />
        }
        filters={
          <FilterPanel
            title="Filter audit events"
            activeCount={actions.length > 0 ? 1 : 0}
            onClearAll={() => setActions([])}
          >
            <ChoiceFilter
              label="Action type"
              options={AUDIT_ACTIONS}
              value={actions}
              onValueChange={setActions}
            />
          </FilterPanel>
        }
        activeFilters={
          <ActiveFilterChips
            onClearAll={() => setActions([])}
            filters={[
              {
                key: 'action',
                label: formatChoiceFilterLabel(
                  'Action type',
                  actions.map(
                    (action) =>
                      AUDIT_ACTIONS.find((option) => option.value === action)
                        ?.label ?? action
                  )
                ),
                onRemove: () => setActions([]),
              },
            ]}
          />
        }
      />
      <RowList>
        {AUDIT_DEMO_EVENTS.map((event) => (
          <RowListItem key={event} title={event} />
        ))}
      </RowList>
    </Panel>
  );
}

const AUDIT_DEMO_EVENTS = [
  'apricot verified tournament Corsace Open 2025',
  'Raikouhou submitted tournament Oceania Taiko Cup 2026',
] as const;

const DEMO_REPORTS = [
  {
    type: 'Match',
    entity: 'CO25: (Lunar Lobster) vs (Team Rocket)',
    reason: 'Incorrect match result',
  },
  {
    type: 'Tournament',
    entity: 'Break The Meta Cup',
    reason: 'Incorrect tournament details',
  },
] as const;

function BeatmapToolbarDemo() {
  const [layout, setLayout] = useState('compact');
  const [sort, setSort] = useState<{
    key:
      'gameCount' | 'tournamentCount' | 'sr' | 'bpm' | 'cs' | 'ar' | 'length';
    direction: 'asc' | 'desc';
  }>({ key: 'gameCount', direction: 'desc' });
  const [rulesets, setRulesets] = useState<Ruleset[]>([Ruleset.Osu]);
  const [query, setQuery] = useState('');

  return (
    <Panel>
      <ListToolbar
        label="Search and filter beatmaps"
        search={
          <SearchField
            // The short placeholder fits a phone; the name keeps the full scope.
            label="Search beatmaps by title, artist, difficulty, mapper or ID"
            placeholder="Title, artist, mapper or ID"
            value={query}
            onSearch={setQuery}
          />
        }
        sort={
          <SortControl
            label="Sort beatmaps by"
            value={sort}
            onValueChange={setSort}
            options={[
              { value: 'gameCount', label: 'Games' },
              { value: 'tournamentCount', label: 'Tournaments' },
              { value: 'sr', label: 'SR', group: 'attributes' },
              { value: 'bpm', label: 'BPM', group: 'attributes' },
              { value: 'cs', label: 'CS', group: 'attributes' },
              { value: 'ar', label: 'AR', group: 'attributes' },
              { value: 'length', label: 'Length', group: 'attributes' },
            ]}
          />
        }
        filters={
          <FilterPanel
            title="Filter beatmaps"
            activeCount={0}
            onClearAll={() => {}}
          >
            <p className="col-span-2 text-sm text-muted-foreground">
              See the filter panel specimen below.
            </p>
          </FilterPanel>
        }
        rulesets={<RulesetChips value={rulesets} onValueChange={setRulesets} />}
        view={
          <ToggleGroup
            type="single"
            variant="outline"
            value={layout}
            onValueChange={(next) => next && setLayout(next)}
            aria-label="Beatmap layout"
          >
            {[
              { value: 'cards', label: 'Card view', icon: LayoutGrid },
              { value: 'compact', label: 'Compact view', icon: Rows3 },
              { value: 'table', label: 'Table view', icon: Table2 },
            ].map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={label}
                className="size-8 data-[state=off]:bg-background data-[state=on]:bg-primary/10 data-[state=on]:text-primary dark:data-[state=off]:bg-input/50 dark:data-[state=on]:bg-primary/20"
              >
                <Icon aria-hidden="true" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
        count={formatCountOf(281_338, 'map', 'maps')}
      />
      {/* Beatmap rows open as a whole, in every layout. */}
      <RowList>
        {DEMO_BEATMAPS.map((map) => (
          <RowListItem
            key={map.id}
            href="#lists-toolbar-view"
            linkLabel={`View ${map.artist} - ${map.title} [${map.diff}]`}
            leading={
              <BeatmapCover
                alt=""
                sizes="56px"
                className="h-8 w-14 rounded-md"
              />
            }
            title={
              <>
                {map.title}{' '}
                <span className="font-normal text-muted-foreground">
                  [{map.diff}]
                </span>
              </>
            }
            description={`${map.artist} · ${map.mapper}`}
            trailing={
              <>
                <div className="font-semibold tabular-nums">
                  {formatCount(map.games)}
                </div>
                <div className="text-xs text-muted-foreground">games</div>
              </>
            }
          />
        ))}
      </RowList>
    </Panel>
  );
}

function SearchFieldDemo() {
  const [term, setTerm] = useState('');
  const [pending, setPending] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="flex flex-col gap-4">
      <SearchField
        label="Search tournaments by name or abbreviation"
        placeholder="Name or abbreviation"
        value={term}
        pending={pending}
        onSearch={(next) => {
          setTerm(next);
          setPending(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setPending(false), 900);
        }}
      />
      <p className="text-xs text-muted-foreground">
        State: {`{ q: '${term}' }`}
      </p>
      <SearchField
        label="Search tournaments by name or abbreviation"
        placeholder="Name or abbreviation"
        value="c"
        onSearch={() => {}}
      />
    </div>
  );
}

function SortControlDemo() {
  const [sort, setSort] = useState<{
    key: TournamentSortKey;
    direction: 'asc' | 'desc';
  }>({ key: 'endTime', direction: 'desc' });
  return (
    <div className="flex flex-col gap-4">
      <SortControl
        label="Sort tournaments by"
        options={TOURNAMENT_SORTS}
        value={sort}
        onValueChange={setSort}
      />
      <p className="text-xs text-muted-foreground">
        State: {`{ key: '${sort.key}', direction: '${sort.direction}' }`}
      </p>
      {/* size="sm": 32px, so the header strip keeps its 48px height. */}
      <Panel>
        <SectionHeader
          icon={Trophy}
          title="Tournaments"
          actions={
            <SortControl
              size="sm"
              label="Sort tournaments by"
              options={TOURNAMENT_SORTS}
              value={sort}
              onValueChange={setSort}
            />
          }
        />
        <RowList>
          {DEMO_TOURNAMENTS.slice(0, 2).map((row) => (
            <RowListItem
              key={row.id}
              title={
                <EntityLink href="#lists-sort-control">{row.name}</EntityLink>
              }
              description={formatDateRange(row.start, row.end)}
            />
          ))}
        </RowList>
      </Panel>
    </div>
  );
}

function RulesetChipsDemo() {
  const [value, setValue] = useState<Ruleset[]>([Ruleset.Osu]);
  return <RulesetChips value={value} onValueChange={setValue} />;
}

function RulesetSwitchDemo() {
  const [value, setValue] = useState<Ruleset>(Ruleset.Taiko);
  return <RulesetSwitch value={value} onValueChange={setValue} />;
}

function ScopeSwitchDemo() {
  const [scope, setScope] = useState<'all' | 'friends'>('all');
  return (
    <div className="flex flex-col gap-3">
      <ScopeSwitch
        label="Players to show"
        value={scope}
        onValueChange={setScope}
        options={[
          { value: 'all', label: 'All' },
          { value: 'friends', label: 'Friends' },
        ]}
      />
      <ScopeSwitch
        label="Players to show"
        value="all"
        onValueChange={() => {}}
        options={[
          { value: 'all', label: 'All' },
          {
            value: 'friends',
            label: 'Friends',
            disabled: true,
            disabledReason: 'Sync friends in Settings',
          },
        ]}
      />
      {/* The same control as a view toggle, at the top of a panel. */}
      <Suspense fallback={null}>
        <RatingViewToggleDemo />
      </Suspense>
    </div>
  );
}

// The profile's rating history views, as a shallow list state: the chart's
// data is all on the client, so the address changes without a server render.
// The decay chip is on by default, so only `decay=false` is ever written.
const RATING_VIEW_PARAMS = defineListParams({
  metric: enumParam(['rating', 'volatility'] as const, {
    default: 'rating',
    role: 'scope',
  }),
  view: enumParam(['chart', 'table'] as const, {
    default: 'chart',
    role: 'scope',
  }),
  decay: booleanParam({ default: true, role: 'scope' }),
});

function RatingViewToggleDemo() {
  const list = useListState(RATING_VIEW_PARAMS, { shallow: true });
  const { state, setState } = list;

  return (
    <Panel>
      <SectionHeader icon={ChartLine} title="Rating history" />
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <ScopeSwitch
          label="Rating or volatility"
          value={state.metric}
          onValueChange={(metric) => setState({ metric })}
          options={[
            { value: 'rating', label: 'Rating' },
            { value: 'volatility', label: 'Volatility' },
          ]}
        />
        <ScopeSwitch
          label="View"
          value={state.view}
          onValueChange={(view) => setState({ view })}
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
        />
        <ChoiceChip
          selected={state.decay}
          onClick={() => setState({ decay: !state.decay })}
        >
          Display decay
        </ChoiceChip>
      </div>
      <p className="px-4 pt-3 pb-4 text-xs break-all text-muted-foreground">
        Address: {list.hrefFor({})}
      </p>
    </Panel>
  );
}

function ChoiceChipDemo() {
  const [teams, setTeams] = useState(true);
  const [verified, setVerified] = useState(true);
  const [solo, setSolo] = useState(false);
  return (
    <div className="flex flex-wrap gap-1.5">
      <ChoiceChip selected={teams} onClick={() => setTeams(!teams)}>
        {formatLobbySize(4)}
      </ChoiceChip>
      {/* A status glyph keeps its own colour when selected. */}
      <ChoiceChip
        selected={verified}
        onClick={() => setVerified(!verified)}
        icon={
          <VerificationStatusGlyph
            status={VerificationStatus.Verified}
            className="size-4"
          />
        }
      >
        {getVerificationStatusName(VerificationStatus.Verified)}
      </ChoiceChip>
      <ChoiceChip selected={solo} onClick={() => setSolo(!solo)}>
        {formatLobbySize(1)}
      </ChoiceChip>
    </div>
  );
}

const lengthScale = tieredScale({
  tiers: [
    { start: 0, end: 300, step: 5 },
    { start: 300, end: 600, step: 10 },
    { start: 600, end: 1800, step: 60 },
  ],
});

function formatSeconds(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type Range = { min?: number; max?: number };

const isRangeSet = (range: Range) =>
  range.min !== undefined || range.max !== undefined;

/**
 * The Filters button with its panel open under it, drawn flat: right-aligned
 * and 8px below, where the popover opens.
 */
function OpenFilterPanel({
  title,
  activeCount,
  onClearAll,
  children,
}: {
  title: string;
  activeCount: number;
  onClearAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col items-end gap-2">
      <FilterPanel
        title={title}
        activeCount={activeCount}
        onClearAll={onClearAll}
      >
        {children}
      </FilterPanel>
      <div className="w-full max-w-[24rem] overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md">
        <FilterPanelContent
          title={title}
          activeCount={activeCount}
          onClearAll={onClearAll}
        >
          {children}
        </FilterPanelContent>
      </div>
    </div>
  );
}

function BeatmapFiltersDemo() {
  const [sr, setSr] = useState<Range>({ min: 5.5, max: 7 });
  const [length, setLength] = useState<Range>({});
  const [cs, setCs] = useState<Range>({ max: 4.5 });
  const [ar, setAr] = useState<Range>({});
  const ranges = [sr, length, cs, ar];

  return (
    <OpenFilterPanel
      title="Filter beatmaps"
      activeCount={ranges.filter(isRangeSet).length}
      onClearAll={() => {
        setSr({});
        setLength({});
        setCs({});
        setAr({});
      }}
    >
      <RangeFilter
        label="SR"
        min={0}
        max={15}
        step={0.1}
        value={sr}
        onValueChange={setSr}
      />
      <RangeFilter
        label="Length (seconds)"
        valueLabel="length"
        min={0}
        max={1800}
        scale={lengthScale}
        format={formatSeconds}
        value={length}
        onValueChange={setLength}
      />
      <RangeFilter
        label="CS"
        span="half"
        min={0}
        max={10}
        step={0.1}
        value={cs}
        onValueChange={setCs}
      />
      <RangeFilter
        label="AR"
        span="half"
        min={0}
        max={10}
        step={0.1}
        value={ar}
        onValueChange={setAr}
      />
    </OpenFilterPanel>
  );
}

function TournamentFiltersDemo() {
  const [rank, setRank] = useState<Range>({ min: 1000 });
  const [status, setStatus] = useState<VerificationStatus[]>([
    VerificationStatus.Verified,
  ]);
  const [dates, setDates] = useState<{ from?: string; to?: string }>({
    from: '2025-06-01',
    to: '2025-08-31',
  });
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const active =
    (isRangeSet(rank) ? 1 : 0) +
    (status.length ? 1 : 0) +
    (dates.from || dates.to ? 1 : 0) +
    (verifiedOnly ? 1 : 0);

  return (
    <OpenFilterPanel
      title="Filter tournaments"
      activeCount={active}
      onClearAll={() => {
        setRank({});
        setStatus([]);
        setDates({});
        setVerifiedOnly(false);
      }}
    >
      <RangeFilter
        label="Rank restriction"
        valueLabel="rank"
        info="Best global rank allowed, 1 if open"
        min={1}
        max={1_000_000}
        scale={tournamentRankScale}
        value={rank}
        onValueChange={setRank}
      />
      <ChoiceFilter
        label="Status"
        options={STATUS_OPTIONS}
        value={status}
        onValueChange={setStatus}
      />
      <DayRangeFilter
        label="Tournament dates"
        value={dates}
        onValueChange={setDates}
      />
      <SwitchFilter
        label="Verified only"
        checked={verifiedOnly}
        onCheckedChange={setVerifiedOnly}
      />
    </OpenFilterPanel>
  );
}

function FilterFieldsDemo() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <BeatmapFiltersDemo />
      <TournamentFiltersDemo />
    </div>
  );
}

function DateFieldDemo() {
  const [day, setDay] = useState<string | undefined>('2025-07-20');
  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-56">
        <DateField label="From" value={day} onValueChange={setDay} />
      </div>
      <div className="w-fit rounded-xl border bg-popover p-3 text-popover-foreground shadow-md">
        <Calendar
          value={day}
          onSelect={setDay}
          highlight={{ from: day, to: '2025-08-03' }}
        />
      </div>
    </div>
  );
}

function ActiveFilterChipsDemo() {
  const initial: ActiveFilter[] = [
    {
      key: 'sr',
      label: formatRangeFilterLabel('SR', { min: 5.5, max: 7 }),
      onRemove: () => {},
    },
    {
      key: 'status',
      label: formatChoiceFilterLabel('Status', [
        'Pending',
        'Pre-verified',
        'Pre-rejected',
      ]),
      onRemove: () => {},
    },
    {
      key: 'dates',
      label: formatDayRangeFilterLabel('Dates', { from: '2025-06-01' }),
      onRemove: () => {},
    },
  ];
  const [keys, setKeys] = useState(initial.map((filter) => filter.key));
  const filters = initial
    .filter((filter) => keys.includes(filter.key))
    .map((filter) => ({
      ...filter,
      onRemove: () =>
        setKeys((current) => current.filter((key) => key !== filter.key)),
    }));

  return keys.length ? (
    <ActiveFilterChips filters={filters} onClearAll={() => setKeys([])} />
  ) : (
    // Gallery only: brings the removed chips back.
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setKeys(initial.map((filter) => filter.key))}
    >
      Reset
    </Button>
  );
}

const ADDRESS_EXAMPLES: { note: string; state: Partial<TournamentState> }[] = [
  { note: 'Defaults write nothing', state: {} },
  {
    note: 'Search and sort',
    state: { q: 'world cup', sort: { key: 'startTime', direction: 'desc' } },
  },
  {
    note: 'Only the direction changed',
    state: { sort: { key: 'endTime', direction: 'asc' } },
  },
  {
    note: 'Arrays repeat the key, in a fixed order',
    state: {
      ruleset: [Ruleset.Taiko, Ruleset.Osu],
      status: [VerificationStatus.Verified, VerificationStatus.None],
      lobbySize: [4, 1],
    },
  },
  {
    note: 'Every ruleset, over the visitor’s own default',
    state: { ruleset: [] },
  },
  { note: 'A switch writes true', state: { verified: true } },
  {
    note: 'Ranges and days',
    state: {
      rank: { min: 1000 },
      date: { from: '2025-06-01', to: '2025-08-31' },
    },
  },
  { note: 'Page 3', state: { page: 3 } },
];

/** An address that wraps between params, never inside one. */
function Address({ href }: { href: string }) {
  return href.split(/(?=[?&])/).map((part, index) => (
    <span key={index}>
      {index > 0 ? <wbr /> : null}
      <span className="whitespace-nowrap">{part}</span>
    </span>
  ));
}

// A bitflag enum: a list of flags in state, one bitmask in the address.
const MOD_FLAGS: readonly Mods[] = [
  Mods.Hidden,
  Mods.HardRock,
  Mods.DoubleTime,
  Mods.Flashlight,
];

const MOD_PARAMS = defineListParams({ mods: flagsParam(MOD_FLAGS) });

const MOD_OPTIONS = MOD_FLAGS.map((mod) => ({
  value: mod,
  label: formatMods(mod),
}));

function FlagsParamDemo() {
  const [mods, setMods] = useState<Mods[]>([Mods.Hidden, Mods.HardRock]);
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <ChoiceFilter
        label="Mods"
        description="flagsParam: chosen flags in state, one bitmask in the address."
        options={MOD_OPTIONS}
        value={mods}
        onValueChange={setMods}
      />
      <p className="text-xs break-words text-muted-foreground">
        <Address href={listStateHref('/beatmaps', MOD_PARAMS, { mods })} />
      </p>
    </div>
  );
}

function ListStateDemo() {
  return (
    <div className="flex flex-col gap-4">
      <AddressExamples />
      <FlagsParamDemo />
    </div>
  );
}

function AddressExamples() {
  const defaults = getDefaultListState(TOURNAMENT_PARAMS);
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-baseline sm:gap-y-3">
      {ADDRESS_EXAMPLES.map((example, index) => (
        <div key={example.note} className="contents">
          <dt
            className={cn(
              'text-xs font-medium text-muted-foreground',
              index > 0 && 'mt-2 sm:mt-0'
            )}
          >
            {example.note}
          </dt>
          <dd className="break-words">
            <Address
              href={listStateHref('/tournaments', TOURNAMENT_PARAMS, {
                ...defaults,
                ...example.state,
              })}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ListsSection() {
  return (
    <GallerySection
      id="lists"
      title="Lists, search and filters"
      description="List toolbar, search, sort, ruleset chips, filter panel and list state in the address."
    >
      <Specimen
        id="lists-toolbar"
        name="ListToolbar"
        importPath={`${KIT}/ListToolbar`}
        description="The strip at the top of every list's panel: search, sort and Filters, then ruleset chips and the count, then active-filter chips. Everything here is live, an EmptyState takes the rows' place when nothing matches, and the address underneath is what the page would show. The chips open on the visitor's browsing ruleset (osu! here), which the address leaves out; All writes ruleset=all."
        stacked
      >
        <TournamentToolbarDemo />
      </Specimen>

      <Specimen
        id="lists-toolbar-scope"
        name="ListToolbar with a scope and one ruleset"
        importPath={`${KIT}/ListToolbar`}
        description="The leaderboard, with its own list spec: search, sort and Filters, then All / Friends and a ruleset switch on the second row with the count. Clear all keeps the scope, ruleset, sort and search."
        stacked
      >
        <LeaderboardToolbarDemo hasFriends />
      </Specimen>

      <Specimen
        id="lists-toolbar-no-search"
        name="ListToolbar without a search"
        importPath={`${KIT}/ListToolbar`}
        description="The admin report queue: with no search the toolbar is one strip, the scope on the left and the count, sort and Filters on the right. On phones the count follows the scope on its line when they fit; a four-option scope like this one fills its line, so the count moves down beside sort rather than onto a line of its own."
        stacked
      >
        <ReportQueueToolbarDemo />
      </Specimen>

      <Specimen
        id="lists-toolbar-leading"
        name="ListToolbar with a leading control"
        importPath={`${KIT}/ListToolbar`}
        description="A control that is neither a search nor a filter goes in leading: first on the strip, before the scope or search. The audit pages' Show system events switch widens the list rather than filtering it, so it leads. Without a search the count, sort and Filters stay on the right of the same strip: an entity's audit history puts its count there, and the audit log its Filters, on one line on phones too until they don't fit."
        stacked
      >
        <div className="flex flex-col gap-6">
          <AuditHistoryToolbarDemo />
          <LeadingFiltersToolbarDemo />
        </div>
      </Specimen>

      <Specimen
        id="lists-toolbar-view"
        name="ListToolbar with view options"
        importPath={`${KIT}/ListToolbar`}
        description="The beatmap list: grouped sort keys, and layout toggles in the view slot before the count."
        stacked
      >
        <BeatmapToolbarDemo />
      </Specimen>

      <Specimen
        id="lists-search-field"
        name="SearchField"
        importPath={`${KIT}/SearchField`}
        description="One search box everywhere: waits 400ms after typing (Enter searches at once), spins until results land, hints below two characters, and clears with the button or Escape."
      >
        <SearchFieldDemo />
      </Specimen>

      <Specimen
        id="lists-sort-control"
        name="SortControl"
        importPath={`${KIT}/SortControl`}
        description="A key dropdown and a direction button. It shares { key, direction } with sortable table headers, so both show the same choice. 40px in a list toolbar; size sm (32px) in a section header's actions, as below, and in a DataTable's phone sort strip."
      >
        <SortControlDemo />
      </Specimen>

      <Specimen
        id="lists-ruleset-chips"
        name="RulesetChips"
        importPath={`${KIT}/RulesetChips`}
        description="Filter a list by any number of rulesets. All is on when none is."
      >
        <RulesetChipsDemo />
      </Specimen>

      <Specimen
        id="lists-ruleset-switch"
        name="RulesetSwitch"
        importPath={`${KIT}/RulesetSwitch`}
        description="The same chips as a single choice, for the profile, stats and leaderboard. Arrow keys move between rulesets."
      >
        <RulesetSwitchDemo />
      </Specimen>

      <Specimen
        id="lists-scope-switch"
        name="ScopeSwitch"
        importPath={`${KIT}/ScopeSwitch`}
        description="A segmented choice of two to four options: whose rows a list shows, or which view of a section is on screen (Rating / Volatility, Chart / Table). An option that cannot be chosen says why through an info button. The rating history toggles here, with its Display decay chip, keep their choice in the address with useListState's shallow option, as the profile does; try them and the back button."
      >
        <ScopeSwitchDemo />
      </Specimen>

      <Specimen
        id="lists-choice-chip"
        name="ChoiceChip"
        importPath={`${KIT}/ChoiceChip`}
        description="One toggle chip, for chip filters that are not rulesets, such as a verification status or a lobby size. Selected chips get a blue edge and tint; a status glyph keeps its own colour."
      >
        <ChoiceChipDemo />
      </Specimen>

      <Specimen
        id="lists-filter-button"
        name="FilterButton"
        importPath={`${KIT}/FilterButton`}
        description="Opens the filter panel. The count is the number of active filters behind it."
      >
        <div className="flex flex-wrap gap-3">
          <FilterButton count={0} />
          <FilterButton count={3} />
        </div>
      </Specimen>

      <Specimen
        id="lists-filter-panel"
        name="FilterPanel and its fields"
        importPath={`${KIT}/FilterPanel`}
        description="One panel layout for every list: the beatmap list's range fields, with CS and AR at half width, and tournament filters built from ChoiceFilter, DayRangeFilter and SwitchFilter. Fields apply as you change them; number boxes sit beside the label and long labels wrap. Clear all resets that panel's fields only. Each panel is drawn open under its button, where the popover opens."
        stacked
        // On a phone the popover is the screen's width less 32px; the frame
        // drops its side padding so the panel is as wide here.
        frameClassName="max-sm:px-0"
      >
        <FilterFieldsDemo />
      </Specimen>

      <Specimen
        id="lists-date-field"
        name="DateField and Calendar"
        importPath={`${KIT}/DateField`}
        description="Pick a UTC day instead of using the browser's date field. Arrow keys move by day, Page Up and Down by month."
      >
        <DateFieldDemo />
      </Specimen>

      <Specimen
        id="lists-active-filter-chips"
        name="ActiveFilterChips"
        importPath={`${KIT}/ActiveFilterChips`}
        description="Names each active filter as a removable chip under the toolbar. Labels come from the helpers in @/lib/kit/lists/filters."
      >
        <ActiveFilterChipsDemo />
      </Specimen>

      <Specimen
        id="lists-list-state"
        name="useListState and the list params"
        importPath="@/lib/kit/lists/use-list-state"
        description="Every control that changes a list lives in the address, described once with the builders in @/lib/kit/lists/params. Defaults are left out, invalid values are ignored, and other params such as a tab are kept. An arrayParam with allValue tells a bare address (the visitor's own default) from every option (ruleset=all). A bitflag filter (flagsParam) is a list of flags in state and one number in the address. The rating history views under ScopeSwitch use the shallow option, which changes this page's address without a server render."
        stacked
      >
        <ListStateDemo />
      </Specimen>
    </GallerySection>
  );
}
