'use client';

import { ReportStatus, Ruleset } from '@otr/core/osu';
import {
  AlertCircle,
  ArrowLeft,
  ChartNoAxesColumn,
  ChevronDown,
  ClipboardList,
  Clock,
  Compass,
  Copy,
  Flag,
  Gauge,
  History,
  Lock,
  Medal,
  Music,
  RefreshCw,
  ShieldAlert,
  ShieldQuestion,
  SlidersHorizontal,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';

import { GallerySection, Specimen } from '../gallery';
import { SiteBannerContent } from '@/components/banner/SiteBanner';
import SectionError from '@/components/error/SectionError';
import { Button } from '@/components/kit/controls/Button';
import { Callout } from '@/components/kit/feedback/Callout';
import { CalloutChip } from '@/components/kit/feedback/CalloutChip';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import {
  ChartPlotSkeleton,
  HeroTabsSkeleton,
  ListToolbarSkeleton,
  LoadMoreSkeleton,
  PanelSkeleton,
  PhoneRowListSkeleton,
  RowListSkeleton,
  RulesetSwitchSkeleton,
  SectionHeaderSkeleton,
  SkeletonBlock,
  SkeletonText,
  StatTileGridSkeleton,
  TableSkeleton,
  type TableSkeletonColumn,
} from '@/components/kit/feedback/Skeletons';
import { StatusPage } from '@/components/kit/feedback/StatusPage';
import { RatingDelta } from '@/components/kit/format/RatingDelta';
import { HeroTabs } from '@/components/kit/layout/HeroTabs';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { typeScale } from '@/components/kit/layout/Typography';
import { ReportStatusBadge } from '@/components/kit/status/ReportStatusBadge';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { LoadMore } from '@/components/kit/tables/LoadMore';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { ActiveFilterChips } from '@/components/kit/lists/ActiveFilterChips';
import { FilterButton } from '@/components/kit/lists/FilterButton';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { RulesetChips } from '@/components/kit/lists/RulesetChips';
import { RulesetSwitch } from '@/components/kit/lists/RulesetSwitch';
import { ScopeSwitch } from '@/components/kit/lists/ScopeSwitch';
import { SearchField } from '@/components/kit/lists/SearchField';
import { SortControl } from '@/components/kit/lists/SortControl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { seriesColor } from '@/lib/kit/color/categorical';
import { formatLobbySize } from '@/lib/kit/format/fields';
import { formatCountOf } from '@/lib/kit/format/number';
import { formatChoiceFilterLabel } from '@/lib/kit/lists/filters';
import { cn } from '@/lib/utils';

const KIT = '@/components/kit/feedback';

const TOURNAMENTS = [
  {
    name: 'Corsace Open 2025',
    ruleset: Ruleset.Osu,
    lobbySize: 4,
    meta: 'osu! · 4v4 · Open rank',
    dates: 'Jul 20 – Aug 3, 2025',
  },
  {
    name: 'Oceania Taiko Cup 2026',
    ruleset: Ruleset.Taiko,
    lobbySize: 2,
    meta: 'taiko · 2v2 · 10,000+',
    dates: 'Feb 7 – 28, 2026',
  },
  {
    name: 'Mania 4K World Cup 2026',
    ruleset: Ruleset.Mania4k,
    lobbySize: 4,
    meta: 'mania 4K · 4v4 · Open rank',
    dates: 'Mar 14 – Apr 26, 2026',
  },
];

// Worded as the audit log words its events.
const AUDIT_EVENTS = [
  'apricot verified tournament Corsace Open 2025',
  'System pre-verified 412 matches in Corsace Open 2025',
  'Raikouhou submitted tournament Oceania Taiko Cup 2026',
];

const PLAYERS = [
  { name: 'distantmemory', country: 'United States', rating: '2,215' },
  { name: 'Raikouhou', country: 'Japan', rating: '2,108' },
  { name: 'Yasui', country: 'Japan', rating: '1,996' },
];

const OVERVIEW_LABELS = ['Rating', 'Global rank', 'Matches'];

const REPORT_COLUMNS: TableSkeletonColumn[] = [
  { label: 'Type', width: 'w-28' },
  { label: 'Entity' },
  { label: 'Reason', showFrom: 'lg' },
  { label: 'Status', width: 'w-32' },
  { label: 'Submitted', width: 'w-32', align: 'end' },
];

const REPORTS = [
  {
    id: 1204,
    type: 'Match',
    entity: 'CO25: (Lunar Lobster) vs (Team Rocket)',
    reason: 'Incorrect match result',
    status: ReportStatus.Pending,
    submitted: 'Oct 12, 2025',
  },
  {
    id: 1187,
    type: 'Tournament',
    entity: 'Break The Meta Cup',
    reason: 'Incorrect tournament details',
    status: ReportStatus.Approved,
    submitted: 'Oct 3, 2025',
  },
  {
    id: 1162,
    type: 'Score',
    entity: "Yasui's score",
    reason: 'Invalid score',
    status: ReportStatus.Rejected,
    submitted: 'Sep 28, 2025',
  },
];

/** Plays a retry: spins for a moment, then either loads or fails again. */
function useRetryDemo(succeed: boolean) {
  const [failed, setFailed] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return {
    failed,
    retrying,
    retry: () => {
      setRetrying(true);
      timer.current = setTimeout(() => {
        setRetrying(false);
        if (succeed) setFailed(false);
      }, 1200);
    },
    fail: () => setFailed(true),
  };
}

function PlayerAvatar({ name }: { name: string }) {
  return (
    <Avatar className="size-8">
      <AvatarFallback className="text-xs font-medium">
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function TournamentRows({
  tournaments = TOURNAMENTS,
}: {
  tournaments?: typeof TOURNAMENTS;
}) {
  return (
    <RowList>
      {tournaments.map((tournament) => (
        <RowListItem
          key={tournament.name}
          title={
            <EntityLink href="#feedback-empty-state-filtered">
              {tournament.name}
            </EntityLink>
          }
          description={tournament.meta}
          trailing={<span className={typeScale.meta}>{tournament.dates}</span>}
        />
      ))}
    </RowList>
  );
}

/** Flips a specimen between its skeleton and its loaded state. */
function LoadToggle({
  loading,
  onChange,
}: {
  loading: boolean;
  onChange: (loading: boolean) => void;
}) {
  return (
    <ScopeSwitch
      label="Specimen state"
      value={loading ? 'loading' : 'loaded'}
      onValueChange={(next) => onChange(next === 'loading')}
      options={[
        { value: 'loading', label: 'Loading' },
        { value: 'loaded', label: 'Loaded' },
      ]}
      className="w-fit"
    />
  );
}

/**
 * A filterable list's panel: its toolbar, then the rows or the empty state.
 * The lobby size filter empties the list; the ruleset is a scope, so Clear
 * filters leaves it alone.
 */
function FilteredEmptyDemo() {
  const [rulesets, setRulesets] = useState<Ruleset[]>([Ruleset.Taiko]);
  const [lobbySizes, setLobbySizes] = useState<number[]>([1]);
  const shown = TOURNAMENTS.filter(
    (tournament) =>
      (rulesets.length === 0 || rulesets.includes(tournament.ruleset)) &&
      (lobbySizes.length === 0 || lobbySizes.includes(tournament.lobbySize))
  );
  const clearFilters = () => setLobbySizes([]);

  return (
    <Panel>
      <ListToolbar
        label="Filter tournaments"
        rulesets={<RulesetChips value={rulesets} onValueChange={setRulesets} />}
        count={formatCountOf(shown.length, 'tournament')}
        activeFilters={
          <ActiveFilterChips
            filters={[
              {
                key: 'lobbySize',
                label: formatChoiceFilterLabel(
                  'Lobby size',
                  lobbySizes.map((size) => formatLobbySize(size))
                ),
                onRemove: clearFilters,
              },
            ]}
            onClearAll={clearFilters}
          />
        }
      />
      {shown.length === 0 ? (
        <EmptyState
          title="No tournaments match"
          description="Try a different name, ruleset, or fewer filters."
          clearFilters={
            lobbySizes.length > 0 ? { onClick: clearFilters } : undefined
          }
        />
      ) : (
        <TournamentRows tournaments={shown} />
      )}
    </Panel>
  );
}

function RegularErrorDemo() {
  const { failed, retrying, retry, fail } = useRetryDemo(true);

  return (
    <Panel>
      <SectionHeader
        icon={Trophy}
        title="Tournament history"
        meta={failed ? undefined : '3 tournaments'}
        actions={
          failed ? null : (
            <Button size="sm" variant="outline" onClick={fail}>
              Fail again
            </Button>
          )
        }
      />
      {failed ? (
        <SectionError
          title="Tournament history could not load"
          retrying={retrying}
          onRetry={retry}
        />
      ) : (
        <TournamentRows />
      )}
    </Panel>
  );
}

function CompactErrorDemo() {
  const { retrying, retry } = useRetryDemo(false);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel>
        <SectionHeader icon={History} title="Rating history" />
        <SectionError
          size="compact"
          title="Rating history could not load"
          retrying={retrying}
          onRetry={retry}
        />
      </Panel>
      <Panel>
        <SectionHeader icon={ChartNoAxesColumn} title="Score distribution" />
        <EmptyState
          size="compact"
          icon={ChartNoAxesColumn}
          title="Not enough data"
        />
      </Panel>
    </div>
  );
}

function InlineErrorDemo() {
  const reasonId = useId();
  const list = useRetryDemo(false);
  const row = useRetryDemo(false);
  const field = useRetryDemo(false);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <SectionHeader icon={ClipboardList} title="Audit logs" />
        <RowList>
          {AUDIT_EVENTS.map((event) => (
            <RowListItem key={event} className="py-2.5 text-sm">
              {event}
            </RowListItem>
          ))}
        </RowList>
        <div className="border-t px-4 py-4">
          <SectionError
            size="inline"
            title="More audit events could not load"
            retrying={list.retrying}
            onRetry={list.retry}
            className="justify-center"
          />
        </div>
      </Panel>
      <Panel>
        <SectionHeader icon={History} title="Audit history" />
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">apricot</span> rejected 9 matches in
            Break The Meta Cup
          </p>
          <SectionError
            size="inline"
            title="Affected matches could not load"
            retrying={row.retrying}
            onRetry={row.retry}
          />
        </div>
      </Panel>
      <Panel>
        <SectionHeader icon={Flag} title="Report a data issue" />
        <PanelBody className="flex flex-col gap-2">
          <Label htmlFor={reasonId}>
            Reason{' '}
            <span aria-hidden="true" className="text-destructive-foreground">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </Label>
          <Select disabled>
            <SelectTrigger
              id={reasonId}
              aria-required="true"
              className="w-full"
            >
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
          </Select>
          <SectionError
            size="inline"
            title="Report reasons could not load"
            retrying={field.retrying}
            onRetry={field.retry}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

const TIER_BREAKDOWN_INFO = 'Shows tiers with 5+ scores';

function OverviewSkeletonDemo() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading overview">
          <SectionHeaderSkeleton icon={Gauge} title="Overview" />
          <PanelBody>
            <StatTileGridSkeleton labels={OVERVIEW_LABELS} sub />
          </PanelBody>
        </PanelSkeleton>
      ) : (
        <Panel>
          <SectionHeader icon={Gauge} title="Overview" meta="osu!" />
          <PanelBody>
            <StatTileGrid columns={3}>
              <StatTile label="Rating" value="1,835" sub="Peak 1,902" />
              <StatTile
                label="Global rank"
                value="#1,024"
                sub="98th percentile"
              />
              <StatTile label="Matches" value="312" sub="Win rate 58.3%" />
            </StatTileGrid>
          </PanelBody>
        </Panel>
      )}
      {/* The real info button, and a meta bar as wide as the loaded meta,
          so the strip wraps on a phone where the loaded one does. */}
      {loading ? (
        <PanelSkeleton className="h-40">
          <SectionHeaderSkeleton
            icon={Medal}
            title="Tier breakdown"
            infoText={TIER_BREAKDOWN_INFO}
            meta="w-40"
          />
        </PanelSkeleton>
      ) : (
        <Panel className="h-40">
          <SectionHeader
            icon={Medal}
            title="Tier breakdown"
            infoText={TIER_BREAKDOWN_INFO}
            meta="1,368 of 1,368 scores rated"
          />
        </Panel>
      )}
    </div>
  );
}

/**
 * An audit history's header, whose name and description follow the entity:
 * SkeletonText keeps each line's height inside the real PageHeader, and
 * SkeletonBlock stands in for the 36px button.
 */
function TextSkeletonDemo() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PageHeader
          icon={History}
          title={<SkeletonText className="h-7 w-56" />}
          description={<SkeletonText className="w-40" />}
          // Page actions stack full width on phones.
          actions={<SkeletonBlock className="h-9 w-full sm:w-28" />}
        />
      ) : (
        <PageHeader
          icon={History}
          title="Break The Meta Cup"
          description="Tournament #401"
          actions={
            <Button variant="outline" icon={Flag}>
              Report
            </Button>
          }
        />
      )}
    </div>
  );
}

/** The tournament list's toolbar, loading and loaded. */
function ToolbarSkeletonDemo() {
  const [loading, setLoading] = useState(true);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading tournaments">
          <ListToolbarSkeleton search sort filters rulesets={6} count />
          <RowListSkeleton rows={2} leading="none" />
        </PanelSkeleton>
      ) : (
        <Panel>
          <ListToolbar
            label="Search and filter tournaments"
            search={
              <SearchField
                label="Search tournaments by name or abbreviation"
                placeholder="Name or abbreviation"
                value=""
                onSearch={() => {}}
              />
            }
            sort={
              <SortControl
                label="Sort tournaments by"
                options={[{ value: 'endTime', label: 'End date' }]}
                value={{ key: 'endTime', direction: 'desc' }}
                onValueChange={() => {}}
              />
            }
            filters={<FilterButton count={0} />}
            rulesets={
              <RulesetChips value={rulesets} onValueChange={setRulesets} />
            }
            count={formatCountOf(1_284, 'tournament')}
          />
          <TournamentRows tournaments={TOURNAMENTS.slice(0, 2)} />
        </Panel>
      )}
    </div>
  );
}

/**
 * A RulesetSwitch list, as on the leaderboard: no All chip, so the blocks
 * take each ruleset's width (`rulesetsAll={false}`).
 */
function SwitchToolbarSkeletonDemo() {
  const [loading, setLoading] = useState(true);
  const [ruleset, setRuleset] = useState<Ruleset>(Ruleset.Osu);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading leaderboard">
          <ListToolbarSkeleton search rulesets={5} rulesetsAll={false} count />
          <RowListSkeleton rows={2} />
        </PanelSkeleton>
      ) : (
        <Panel>
          <ListToolbar
            label="Search and filter players"
            search={
              <SearchField
                label="Search players"
                placeholder="Search by username"
                value=""
                onSearch={() => {}}
              />
            }
            rulesets={
              <RulesetSwitch value={ruleset} onValueChange={setRuleset} />
            }
            count={formatCountOf(12_483, 'player')}
          />
          <RowList>
            {PLAYERS.slice(0, 2).map((player) => (
              <RowListItem
                key={player.name}
                leading={<PlayerAvatar name={player.name} />}
                title={player.name}
                description={player.country}
                trailing={
                  <span className="font-semibold">{player.rating}</span>
                }
              />
            ))}
          </RowList>
        </Panel>
      )}
    </div>
  );
}

/**
 * A chart panel with a RulesetSwitch strip under its header: the real
 * header, RulesetSwitchSkeleton, and ChartPlotSkeleton as tall as the plot.
 */
function ChartSkeletonDemo() {
  const [loading, setLoading] = useState(true);
  const [ruleset, setRuleset] = useState<Ruleset>(Ruleset.Osu);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading rating distribution">
          <SectionHeaderSkeleton
            icon={ChartNoAxesColumn}
            title="Rating distribution"
            meta="w-22"
          />
          <RulesetSwitchSkeleton className="border-b px-4 py-3" />
          <div className="p-4">
            <ChartPlotSkeleton className="h-40" />
          </div>
        </PanelSkeleton>
      ) : (
        <Panel>
          <SectionHeader
            icon={ChartNoAxesColumn}
            title="Rating distribution"
            meta={formatCountOf(8_412, 'player')}
          />
          <div className="border-b px-4 py-3">
            <RulesetSwitch value={ruleset} onValueChange={setRuleset} />
          </div>
          <div className="p-4">
            <div className="flex h-40 items-end gap-1">
              {[18, 34, 62, 88, 100, 74, 46, 28, 14, 6].map((height) => (
                <span
                  key={height}
                  className="flex-1 rounded-t-sm"
                  style={{
                    height: `${height}%`,
                    backgroundColor: seriesColor(0),
                  }}
                />
              ))}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

/**
 * An audit history's panel, whose tabs sit at its top: HeroTabsSkeleton
 * with the real labels, then the toolbar.
 */
function TabsSkeletonDemo() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading audit history">
          <HeroTabsSkeleton
            labels={['Tournament', 'Matches']}
            className="border-b"
          />
          <ListToolbarSkeleton leading="w-44" count />
        </PanelSkeleton>
      ) : (
        <Panel>
          <HeroTabs
            aria-label="Audit history views"
            value="tournament"
            className="border-b"
            items={[
              {
                value: 'tournament',
                label: 'Tournament',
                href: '#feedback-skeleton-tabs',
              },
              {
                value: 'matches',
                label: 'Matches',
                href: '#feedback-skeleton-tabs',
              },
            ]}
          />
          <ListToolbar
            label="Filter audit events"
            leading={
              <span className="flex h-10 items-center text-sm font-medium">
                Show system events
              </span>
            }
            count={formatCountOf(214, 'event')}
          />
        </Panel>
      )}
    </div>
  );
}

const HISTORY = [
  { name: 'Corsace Open 2025', record: '5–2', change: 18.7 },
  { name: 'Oceania Taiko Cup 2026', record: '3–3', change: -4.2 },
];

/**
 * Rows that stack on phones, as the profile's tournament history: the name
 * and a detail line, then small stats and a toggle, under the text on a
 * phone and on the right from `sm`; a "Show more" footer under them.
 */
function StackedRowsSkeletonDemo() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading tournament history">
          <SectionHeaderSkeleton icon={Trophy} title="Tournament history" />
          <RowListSkeleton
            rows={HISTORY.length}
            leading="none"
            stats={2}
            statsAction
          />
          <LoadMoreSkeleton />
        </PanelSkeleton>
      ) : (
        <Panel>
          <SectionHeader
            icon={Trophy}
            title="Tournament history"
            meta={formatCountOf(14, 'tournament')}
          />
          <RowList>
            {HISTORY.map((tournament) => (
              <RowListItem key={tournament.name}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className={typeScale.rowTitle}>
                      <EntityLink href="#feedback-skeleton-rows">
                        {tournament.name}
                      </EntityLink>
                    </h3>
                    <p className={cn('mt-1', typeScale.bodyMuted)}>
                      osu! · 4v4 · 2025
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <dl className="flex items-center gap-4">
                      <div className="min-w-14 sm:text-right">
                        <dt className="text-xs text-muted-foreground">
                          Matches
                        </dt>
                        <dd className="text-sm font-semibold tabular-nums">
                          {tournament.record}
                        </dd>
                      </div>
                      <div className="min-w-14 sm:text-right">
                        <dt className="text-xs text-muted-foreground">
                          Rating
                        </dt>
                        <dd className="text-sm font-semibold">
                          <RatingDelta value={tournament.change} />
                        </dd>
                      </div>
                    </dl>
                    <Button variant="ghost" size="sm" className="gap-1">
                      Matches
                      <ChevronDown aria-hidden />
                    </Button>
                  </div>
                </div>
              </RowListItem>
            ))}
          </RowList>
          <LoadMore
            label="Show more"
            hasMore
            shownCount={HISTORY.length}
            totalCount={14}
            onLoadMore={() => {}}
          />
        </Panel>
      )}
    </div>
  );
}

function RowsSkeletonDemo() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading frequent teammates">
          <SectionHeaderSkeleton icon={Users} title="Frequent teammates" />
          <RowListSkeleton rows={3} />
        </PanelSkeleton>
      ) : (
        <Panel>
          <SectionHeader
            icon={Users}
            title="Frequent teammates"
            meta="3 players"
          />
          <RowList>
            {PLAYERS.map((player) => (
              <RowListItem
                key={player.name}
                leading={<PlayerAvatar name={player.name} />}
                title={player.name}
                description={player.country}
                trailing={
                  <span className="font-semibold">{player.rating}</span>
                }
              />
            ))}
          </RowList>
        </Panel>
      )}
    </div>
  );
}

function TableSkeletonDemo() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="flex flex-col gap-3">
      <LoadToggle loading={loading} onChange={setLoading} />
      {loading ? (
        <PanelSkeleton label="Loading reports">
          <SectionHeaderSkeleton icon={Flag} title="Reports" />
          <TableSkeleton
            columns={REPORT_COLUMNS}
            rows={REPORTS.length}
            phoneRows={
              // The loaded phone rows end in a 20px status badge.
              <PhoneRowListSkeleton rows={REPORTS.length} value="badge" />
            }
          />
        </PanelSkeleton>
      ) : (
        <Panel>
          <SectionHeader icon={Flag} title="Reports" meta="3 reports" />
          <DataTable
            fixed
            aria-label="Reports"
            phoneRows={
              <PhoneRowList aria-label="Reports">
                {REPORTS.map((report) => (
                  <PhoneRow
                    key={report.id}
                    title={
                      <EntityLink href="#feedback-skeleton-table">
                        {report.entity}
                      </EntityLink>
                    }
                    description={`${report.type} · ${report.reason}`}
                    value={
                      <ReportStatusBadge status={report.status} size="sm" />
                    }
                  />
                ))}
              </PhoneRowList>
            }
          >
            <DataTableHeader>
              <DataTableRow>
                {REPORT_COLUMNS.map((column) => (
                  <DataTableHead
                    key={column.label}
                    align={column.align}
                    showFrom={column.showFrom}
                    className={column.width}
                  >
                    {column.label}
                  </DataTableHead>
                ))}
              </DataTableRow>
            </DataTableHeader>
            <DataTableBody>
              {REPORTS.map((report) => (
                <DataTableRow key={report.id}>
                  <DataTableCell>{report.type}</DataTableCell>
                  <DataTableCell>
                    <EntityLink href="#feedback-skeleton-table">
                      {report.entity}
                    </EntityLink>
                  </DataTableCell>
                  <DataTableCell showFrom="lg">{report.reason}</DataTableCell>
                  <DataTableCell>
                    <ReportStatusBadge status={report.status} />
                  </DataTableCell>
                  <DataTableCell align="end" muted>
                    {report.submitted}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </Panel>
      )}
    </div>
  );
}

/** The art behind app/not-found.tsx, with the same image classes. */
function NotFoundBackground() {
  return (
    <Image
      src="/images/error-background.svg"
      alt=""
      fill
      sizes="100vw"
      // The art is empty in the middle. Always show all of it: cropped, the
      // outer shapes end in a hard edge at the column's sides. On phones it
      // sits at the top, so the shapes flank the icon and stay off the text.
      className="object-contain object-top sm:object-center"
    />
  );
}

export default function FeedbackSection() {
  return (
    <GallerySection
      id="feedback"
      title="Empty, error and notices"
      description="Empty and error states, loading skeletons, status pages and callouts. The info button is under layout."
    >
      <Specimen
        id="feedback-empty-state"
        name="EmptyState"
        importPath={`${KIT}/EmptyState`}
        description="Takes the place of a list, table or chart with nothing to show, in the section error's frame with a neutral icon. Say what is missing, then why."
      >
        <Panel>
          <SectionHeader icon={Music} title="Pooled beatmaps" />
          <EmptyState
            icon={Music}
            title="No pooled beatmaps"
            description="No beatmaps by this player have been pooled in a tracked tournament."
          />
        </Panel>
      </Specimen>

      <Specimen
        id="feedback-empty-state-filtered"
        name="EmptyState with Clear filters"
        importPath={`${KIT}/EmptyState`}
        description="When the visitor's filters emptied the list, add Clear filters. It clears filters only, never the search, sort, ruleset or tab. Try it."
      >
        <FilteredEmptyDemo />
      </Specimen>

      <Specimen
        id="feedback-empty-state-compact"
        name="Compact EmptyState and SectionError"
        importPath={`${KIT}/EmptyState`}
        description="The compact size fits a chart, a small panel or a dialog. Like the regular size it sits straight under the SectionHeader or ListToolbar, and the compact error and empty state share one frame, so a panel looks the same whichever happens."
      >
        <CompactErrorDemo />
      </Specimen>

      <Specimen
        id="feedback-section-error"
        name="SectionError"
        importPath="@/components/error/SectionError"
        description="Takes the place of a section whose data failed to load, so a failure never reads as an empty list. Try again spins while the request runs."
      >
        <RegularErrorDemo />
      </Specimen>

      <Specimen
        id="feedback-section-error-inline"
        name="SectionError, inline"
        importPath="@/components/error/SectionError"
        description="The inline size is one line with Try again beside it, for a failure inside content that otherwise loaded: the next batch of a feed, an expanded row or a form field's options. The loaded rows stay above it."
      >
        <InlineErrorDemo />
      </Specimen>

      <Specimen
        id="feedback-skeleton-panel"
        name="PanelSkeleton, SectionHeaderSkeleton and StatTileGridSkeleton"
        importPath={`${KIT}/Skeletons`}
        description="Loading screens are built from the same panels as the page, with the real static titles, so nothing shifts when the data arrives. A loading header keeps the loaded one's info button and a meta bar as wide as its meta. Switch between the two states."
      >
        <div className="flex flex-col gap-4">
          <OverviewSkeletonDemo />
          <PanelSkeleton className="h-56" />
        </div>
      </Specimen>

      <Specimen
        id="feedback-skeleton-table"
        name="TableSkeleton and PhoneRowListSkeleton"
        importPath={`${KIT}/Skeletons`}
        description="A DataTable while it loads: the real header strip and the loaded table's columns. Below tablet width it shows phone rows, as the loaded table does, with a badge, a 32px button or a 32px leading avatar where the loaded rows have one. Switch between the two states."
        stacked
      >
        <TableSkeletonDemo />
      </Specimen>

      <Specimen
        id="feedback-skeleton-toolbar"
        name="ListToolbarSkeleton"
        importPath={`${KIT}/Skeletons`}
        description="A list's toolbar while the list loads: the real strip with a block for each control, on the rows the loaded toolbar puts them, so the rows under it start in the same place. The second list picks one ruleset with a RulesetSwitch, which has no All chip, so its skeleton passes rulesetsAll={false}. Switch between the two states."
        stacked
      >
        <div className="flex flex-col gap-6">
          <ToolbarSkeletonDemo />
          <SwitchToolbarSkeletonDemo />
        </div>
      </Specimen>

      <Specimen
        id="feedback-skeleton-tabs"
        name="HeroTabsSkeleton"
        importPath={`${KIT}/Skeletons`}
        description="A tab strip while its page loads: 44px tabs with the real labels when they are static, bars when they follow the data. Inside a panel it takes the loaded strip's border. Switch between the two states."
      >
        <TabsSkeletonDemo />
      </Specimen>

      <Specimen
        id="feedback-skeleton-chart"
        name="ChartPlotSkeleton and RulesetSwitchSkeleton"
        importPath={`${KIT}/Skeletons`}
        description="A chart panel while it loads: the real header, a RulesetSwitch strip with one block per chip, and the plot as one block as tall as the loaded plot. Switch between the two states."
      >
        <ChartSkeletonDemo />
      </Specimen>

      <Specimen
        id="feedback-skeleton-rows"
        name="RowListSkeleton"
        importPath={`${KIT}/Skeletons`}
        description="RowList rows while a list loads: leading avatar, cover or nothing, a title and detail line, and the key number. Rows that stack on phones, like the profile's tournament history, take stats (under the text on a phone, on the right from sm) and LoadMoreSkeleton for their Show more footer."
      >
        <div className="flex flex-col gap-6">
          <RowsSkeletonDemo />
          <StackedRowsSkeletonDemo />
        </div>
      </Specimen>

      <Specimen
        id="feedback-skeleton-text"
        name="SkeletonText and SkeletonBlock"
        importPath={`${KIT}/Skeletons`}
        description="For text and controls inside a real component whose content follows the data, such as an audit history's header: SkeletonText is an inline bar that keeps its line's height, SkeletonBlock a block with a control's height, width and corners."
      >
        <TextSkeletonDemo />
      </Specimen>

      <Specimen
        id="feedback-status-page"
        name="StatusPage"
        importPath={`${KIT}/StatusPage`}
        description="The one layout for not found, unauthorized, banned and error pages: icon, short heading, one sentence, and an action when the page has one. The 404 keeps its blurred background."
        stacked
      >
        <StatusPage
          icon={Compass}
          title="Page not found"
          description="Sorry, we don't have that page!"
          background={<NotFoundBackground />}
          className="min-h-80"
        />
      </Specimen>

      <Specimen
        id="feedback-status-page-variants"
        name="StatusPage: unauthorized, banned and error"
        importPath={`${KIT}/StatusPage`}
        description="Neutral for pages the visitor cannot see, red for a ban or a failure. A ban adds its reason under the sentence; a route error may add a way back before Try again."
        stacked
      >
        <div className="grid divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          <StatusPage
            icon={Lock}
            title="Unauthorized"
            description="You are not authorized to access this page."
            className="min-h-0 py-10"
          />
          <StatusPage
            icon={ShieldAlert}
            tone="destructive"
            title="Account suspended"
            description="Your osu! Tournament Rating account has been temporarily disabled. If you believe this is an error, please contact the administrators."
            className="min-h-0 py-10"
          >
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Reason:</span>{' '}
              Submissions abuse
            </p>
          </StatusPage>
          <StatusPage
            icon={AlertCircle}
            tone="destructive"
            title="Tournament could not load"
            description="Something went wrong on our side. Try again in a moment."
            role="alert"
            action={
              <>
                <Button asChild variant="outline" icon={ArrowLeft}>
                  <a href="#feedback-status-page-variants">Tournaments</a>
                </Button>
                <Button icon={RefreshCw}>Try again</Button>
              </>
            }
            className="min-h-0 py-10"
          />
        </div>
      </Specimen>

      <Specimen
        id="feedback-callout"
        name="Callout"
        importPath={`${KIT}/Callout`}
        description="The one notice box. Info for context, warning for something to check before acting, danger for something that cannot be undone. Each tone has its own glyph."
      >
        <div className="flex flex-col gap-3">
          <Callout tone="info">
            Only verified data is included in ratings.
          </Callout>
          <Callout tone="warning" title="Host compliance">
            Hosts must comply with the{' '}
            <a href="#feedback-callout">
              official tournament support filtering rules
            </a>
            .
          </Callout>
          <Callout tone="danger" title="Saving is permanent">
            This beatmap stops receiving osu! API updates for good. Nothing can
            undo it.
          </Callout>
        </div>
      </Specimen>

      <Specimen
        id="feedback-callout-action"
        name="Callout with an action"
        importPath={`${KIT}/Callout`}
        description="One button or link sits on the right, and under the text on phones. A destructive action is the red-outlined destructive Button; solid red is only for the final confirm."
      >
        <div className="flex flex-col gap-3">
          <Callout
            tone="danger"
            action={
              <Button variant="destructive" size="sm" icon={Trash2}>
                Delete my account
              </Button>
            }
          >
            Permanently delete your account and remove your data from o!TR. Your
            player profile will remain public.
          </Callout>
          {/* The filter tool's forum post text: hosts paste this exact
              format, so it keeps its ISO time. */}
          <Callout
            tone="info"
            title="Forum post text"
            action={
              <Button variant="outline" size="sm" icon={Copy}>
                Copy
              </Button>
            }
          >
            <code className="font-sans [overflow-wrap:anywhere]">
              o!TR Filtering performed at: 2026-10-13 18:42:07 UTC (Report ID:
              4821)
            </code>
          </Callout>
        </div>
      </Specimen>

      <Specimen
        id="feedback-callout-banner"
        name="Callout, banner"
        importPath={`${KIT}/Callout`}
        description="The banner variant is the full-width strip under the site header, for site-wide notices such as the weekly maintenance window. There is one strip (SiteBannerContent, shown here as the site renders it): the maintenance warning, the signed-out note on its own, or both in the warning during the window, never as a second banner."
        stacked
      >
        <div className="flex flex-col gap-3">
          <SiteBannerContent maintenance signedIn />
          <SiteBannerContent maintenance={false} signedIn={false} />
          <SiteBannerContent maintenance signedIn={false} />
        </div>
      </Specimen>

      <Specimen
        id="feedback-callout-merge"
        name="Two notices on one page"
        importPath={`${KIT}/Callout`}
        description="Never two callouts in a stack. The registrant filtering tool (owner decision, 16 Oct): outside the weekly maintenance window it shows its one notice, Host compliance, above the form. During the window the site banner says the window is on, and the page shows only the notice that the tool is paused, in place of Host compliance and the form; the compliance rules apply only while the tool is on."
        stacked
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className={typeScale.meta}>Outside the window</span>
            <Callout tone="warning" title="Host compliance">
              Hosts must comply with the{' '}
              <a href="#feedback-callout-merge">
                official tournament support filtering rules
              </a>
              .
            </Callout>
            <Panel>
              <SectionHeader icon={SlidersHorizontal} title="Filter criteria" />
              <PanelBody className={typeScale.bodyMuted}>
                The filtering form.
              </PanelBody>
            </Panel>
          </div>
          <div className="flex flex-col gap-2">
            <span className={typeScale.meta}>During the window</span>
            <SiteBannerContent maintenance signedIn />
            <Callout
              tone="warning"
              icon={Clock}
              title="Filtering is temporarily unavailable"
            >
              Ratings are currently recalculating, please check back later.
            </Callout>
          </div>
        </div>
      </Specimen>

      <Specimen
        id="feedback-callout-chip"
        name="CalloutChip"
        importPath={`${KIT}/CalloutChip`}
        description="A short warning inside a panel, in the callout's colours. Its words say it all, so nothing opens from it. The rows under the header show each tone at both sizes, labelled by tone."
      >
        <Panel>
          <SectionHeader
            icon={ChartNoAxesColumn}
            title="Tournament rank restrictions"
            actions={
              <CalloutChip icon={ShieldQuestion}>
                Includes unverified
              </CalloutChip>
            }
          />
          <PanelBody className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CalloutChip tone="info">Info</CalloutChip>
              <CalloutChip tone="warning">Warning</CalloutChip>
              <CalloutChip tone="danger">Danger</CalloutChip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CalloutChip tone="info" size="sm">
                Info
              </CalloutChip>
              <CalloutChip tone="warning" size="sm">
                Warning
              </CalloutChip>
              <CalloutChip tone="danger" size="sm">
                Danger
              </CalloutChip>
            </div>
          </PanelBody>
        </Panel>
      </Specimen>
    </GallerySection>
  );
}
