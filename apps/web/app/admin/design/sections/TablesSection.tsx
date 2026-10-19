'use client';

import {
  AuditActionType,
  AuditEntityType,
  ReportStatus,
  VerificationStatus,
} from '@otr/core/osu';
import {
  ClipboardList,
  Flag,
  History,
  ListOrdered,
  Music2,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';

import { GallerySection, Specimen } from '../gallery';
import AuditEntryRow, {
  AuditSubmissionRow,
} from '@/components/audit/AuditEntryRow';
import AuditNoteItem from '@/components/audit/AuditNoteItem';
import BeatmapCover from '@/components/beatmaps/BeatmapCover';
import TierIcon from '@/components/icons/TierIcon';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { CountryFlag } from '@/components/kit/country/CountryFlag';
import { DateRangeText } from '@/components/kit/format/DateRangeText';
import { DateText } from '@/components/kit/format/DateText';
import { RatingDelta } from '@/components/kit/format/RatingDelta';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { Eyebrow } from '@/components/kit/layout/Typography';
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';
import { Badge } from '@/components/kit/status/Badge';
import { NotificationDot } from '@/components/kit/status/NotificationDot';
import { ReportStatusBadge } from '@/components/kit/status/ReportStatusBadge';
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
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { LoadMore } from '@/components/kit/tables/LoadMore';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { PaginationFooter } from '@/components/kit/tables/PaginationFooter';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { SortableHeader } from '@/components/kit/tables/SortableHeader';
import { ViewButton } from '@/components/kit/tables/ViewButton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { formatLobbySize } from '@/lib/kit/format/fields';
import {
  formatAccuracy,
  formatCount,
  formatCountOf,
  formatId,
  formatPercent,
  formatRank,
  formatRating,
} from '@/lib/kit/format/number';
import type { SortState } from '@/lib/kit/lists/sort';
import { sortRows } from '@/lib/kit/tables/sort';
import type {
  AuditActionUser,
  AuditAdminNote,
  AuditEntry,
} from '@/lib/orpc/schema/audit';
import type { TierName } from '@/lib/utils/tierData';

const KIT = '@/components/kit/tables';

// Demo links stay on the gallery.
const here = (id: string) => `#${id}`;

/** A stand-in avatar: the gallery loads no player images. */
function PlayerAvatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <Avatar style={{ width: size, height: size }}>
      <AvatarFallback className="text-xs font-medium">
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

/** The tier icon; its own tooltip names it on tap, hover and focus. */
function TierMark({
  tier,
  subTier,
  size = 20,
}: {
  tier: TierName;
  subTier?: number;
  size?: number;
}) {
  return (
    <TierIcon
      tier={tier}
      subTier={subTier}
      tooltip
      width={size}
      height={size}
    />
  );
}

// Leaderboard ---------------------------------------------------------------

type LeaderboardRow = {
  id: number;
  rank: number;
  name: string;
  country: string;
  countryName: string;
  tier: TierName;
  subTier?: number;
  rating: number;
  tournaments: number;
  matches: number;
  winRate: number | null;
  you?: boolean;
};

const LEADERBOARD: LeaderboardRow[] = [
  {
    id: 1,
    rank: 1,
    name: 'mrekk',
    country: 'AU',
    countryName: 'Australia',
    tier: 'Elite Grandmaster',
    rating: 3121.4,
    tournaments: 58,
    matches: 1204,
    winRate: 0.724,
  },
  {
    id: 2,
    rank: 2,
    name: 'lifeline',
    country: 'US',
    countryName: 'United States',
    tier: 'Elite Grandmaster',
    rating: 3044.9,
    tournaments: 71,
    matches: 1388,
    winRate: 0.689,
  },
  {
    id: 3,
    rank: 3,
    name: 'Accolibed',
    country: 'KR',
    countryName: 'South Korea',
    tier: 'Grandmaster',
    subTier: 3,
    rating: 2912.2,
    tournaments: 44,
    matches: 902,
    winRate: 0.701,
  },
  {
    id: 4,
    rank: 4,
    name: 'Raikouhou',
    country: 'JP',
    countryName: 'Japan',
    tier: 'Grandmaster',
    subTier: 2,
    rating: 2734.6,
    tournaments: 39,
    matches: 655,
    winRate: null,
  },
  {
    id: 5,
    rank: 5,
    name: 'distantmemory',
    country: 'US',
    countryName: 'United States',
    tier: 'Grandmaster',
    subTier: 1,
    rating: 2615.3,
    tournaments: 52,
    matches: 1017,
    winRate: 0.642,
  },
  {
    id: 6,
    rank: 6,
    name: 'Yasui',
    country: 'JP',
    countryName: 'Japan',
    tier: 'Master',
    subTier: 3,
    rating: 2488.1,
    tournaments: 27,
    matches: 431,
    winRate: 0.598,
    you: true,
  },
];

type LeaderboardSortKey = 'rating' | 'tournaments' | 'matches' | 'winRate';

const LEADERBOARD_SORT: Record<
  LeaderboardSortKey,
  (row: LeaderboardRow) => number | null
> = {
  rating: (row) => row.rating,
  tournaments: (row) => row.tournaments,
  matches: (row) => row.matches,
  winRate: (row) => row.winRate,
};

const PAGE_SIZE = 50;
const PLAYER_COUNT = 8412;

const LEADERBOARD_SORT_OPTIONS: readonly SortOption<LeaderboardSortKey>[] = [
  { value: 'rating', label: 'Rating' },
  { value: 'tournaments', label: 'Tournaments' },
  { value: 'matches', label: 'Matches' },
  { value: 'winRate', label: 'Win rate' },
];

/**
 * The phone row's muted line: what the hidden columns said, leading with
 * the column the rows are sorted by, so a phone shows what it sorts on.
 */
function playerSummary(row: LeaderboardRow, sortKey?: LeaderboardSortKey) {
  if (sortKey === 'matches') {
    return formatCountOf(row.matches, 'match', 'matches');
  }
  const parts = [formatCountOf(row.tournaments, 'tournament')];
  if (row.winRate !== null)
    parts.push(`${formatPercent(row.winRate)} win rate`);
  return parts.join(' · ');
}

function PlayerName({
  row,
  avatar = true,
}: {
  row: LeaderboardRow;
  /** False on a phone row, whose 32px avatar is its `leading`. */
  avatar?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <EntityLink
        href={here('tables-data-table')}
        leading={avatar ? <PlayerAvatar name={row.name} /> : undefined}
      >
        {row.name}
      </EntityLink>
      <CountryFlag code={row.country} name={row.countryName} />
      {row.you ? (
        <Badge size="sm" tone="primary">
          You
        </Badge>
      ) : null}
    </span>
  );
}

function LeaderboardDemo() {
  const [sort, setSort] = useState<SortState<LeaderboardSortKey>>({
    key: 'rating',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;
  const rows = sortRows(LEADERBOARD, sort, LEADERBOARD_SORT).map((row) => ({
    ...row,
    rank: row.rank + offset,
  }));

  return (
    <Panel>
      <SectionHeader
        icon={ListOrdered}
        title="Global leaderboard"
        meta={`${formatCount(PLAYER_COUNT)} players`}
      />
      <DataTable
        aria-label="Global leaderboard"
        phoneSort={
          <SortControl
            size="sm"
            label="Sort players by"
            options={LEADERBOARD_SORT_OPTIONS}
            value={sort}
            onValueChange={setSort}
          />
        }
        phoneRows={
          <PhoneRowList as="ol" aria-label="Global leaderboard">
            {rows.map((row) => (
              <PhoneRow
                key={row.id}
                highlight={row.you}
                rank={formatRank(row.rank)}
                leading={<PlayerAvatar name={row.name} size={32} />}
                leadingHref={here('tables-data-table')}
                title={<PlayerName row={row} avatar={false} />}
                description={playerSummary(row, sort.key)}
                valueAdornment={
                  <TierMark tier={row.tier} subTier={row.subTier} size={22} />
                }
                value={formatRating(row.rating)}
              />
            ))}
          </PhoneRowList>
        }
      >
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead className="w-16">Rank</DataTableHead>
            <DataTableHead>Player</DataTableHead>
            <SortableHeader
              sortKey="rating"
              sort={sort}
              onSortChange={setSort}
              numeric
            >
              Rating
            </SortableHeader>
            <SortableHeader
              sortKey="tournaments"
              sort={sort}
              onSortChange={setSort}
              numeric
            >
              Tournaments
            </SortableHeader>
            <SortableHeader
              sortKey="matches"
              sort={sort}
              onSortChange={setSort}
              numeric
              showFrom="lg"
            >
              Matches
            </SortableHeader>
            <SortableHeader
              sortKey="winRate"
              sort={sort}
              onSortChange={setSort}
              numeric
            >
              Win rate
            </SortableHeader>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {rows.map((row) => (
            <DataTableRow key={row.id} highlight={row.you}>
              <DataTableCell className="font-medium tabular-nums">
                {formatRank(row.rank)}
              </DataTableCell>
              <DataTableCell>
                <PlayerName row={row} />
              </DataTableCell>
              <DataTableCell numeric>
                <span className="flex items-center justify-end gap-1 font-semibold">
                  <TierMark tier={row.tier} subTier={row.subTier} />
                  {formatRating(row.rating)}
                </span>
              </DataTableCell>
              <DataTableCell numeric>
                {formatCount(row.tournaments)}
              </DataTableCell>
              <DataTableCell numeric showFrom="lg">
                {formatCount(row.matches)}
              </DataTableCell>
              <DataTableCell numeric>
                {formatPercent(row.winRate)}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
      <PaginationFooter
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={PLAYER_COUNT}
        onPageChange={setPage}
        label="Leaderboard pages"
      />
    </Panel>
  );
}

// Sortable headers ------------------------------------------------------------

type TournamentRow = {
  id: number;
  name: string;
  start: string;
  end: string;
  matches: number;
  lobbySize: number;
};

const TOURNAMENTS: TournamentRow[] = [
  {
    id: 1,
    name: 'Corsace Open 2025',
    start: '2025-09-06',
    end: '2025-10-19',
    matches: 412,
    lobbySize: 4,
  },
  {
    id: 2,
    name: 'osu! World Cup 2025',
    start: '2025-11-01',
    end: '2025-12-14',
    matches: 128,
    lobbySize: 4,
  },
  {
    id: 3,
    name: 'Break The Meta Cup',
    start: '2024-07-20',
    end: '2024-08-03',
    matches: 96,
    lobbySize: 1,
  },
];

type TournamentSortKey = 'name' | 'matches' | 'lobbySize';

const TOURNAMENT_SORT: Record<
  TournamentSortKey,
  (row: TournamentRow) => string | number | null
> = {
  name: (row) => row.name,
  matches: (row) => row.matches,
  lobbySize: (row) => row.lobbySize,
};

function SortableHeaderDemo() {
  const [sort, setSort] = useState<SortState<TournamentSortKey>>({
    key: 'matches',
    direction: 'desc',
  });
  const rows = sortRows(TOURNAMENTS, sort, TOURNAMENT_SORT);

  return (
    <Panel>
      <SectionHeader icon={Trophy} title="Tournaments" meta="3 tournaments" />
      <DataTable aria-label="Tournaments">
        <DataTableHeader>
          <DataTableRow>
            <SortableHeader
              sortKey="name"
              sort={sort}
              onSortChange={setSort}
              defaultDirection="asc"
            >
              Tournament
            </SortableHeader>
            <DataTableHead showFrom="sm">Dates</DataTableHead>
            <SortableHeader
              sortKey="lobbySize"
              sort={sort}
              onSortChange={setSort}
              numeric
              showFrom="sm"
            >
              Lobby size
            </SortableHeader>
            <SortableHeader
              sortKey="matches"
              sort={sort}
              onSortChange={setSort}
              numeric
            >
              Matches
            </SortableHeader>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {rows.map((row) => (
            <DataTableRow key={row.id}>
              <DataTableCell className="max-w-56">
                <EntityLink href={here('tables-sortable-header')}>
                  {row.name}
                </EntityLink>
              </DataTableCell>
              <DataTableCell muted showFrom="sm">
                <DateRangeText start={row.start} end={row.end} />
              </DataTableCell>
              <DataTableCell numeric showFrom="sm">
                {formatLobbySize(row.lobbySize)}
              </DataTableCell>
              <DataTableCell numeric>{formatCount(row.matches)}</DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </Panel>
  );
}

// Whole-row links -------------------------------------------------------------

const POOL = [
  {
    id: 1,
    title: 'Hotohashiru',
    diff: 'Extra',
    artist: 'ORESAMA',
    mapper: 'Meg',
    sr: '5.63',
    bpm: 140,
    length: '3:48',
    games: 330,
  },
  {
    id: 2,
    title: 'sense',
    diff: "LC's Insane",
    artist: 'Mami Kawada',
    mapper: 'La Cataline',
    sr: '4.50',
    bpm: 168,
    length: '3:59',
    games: 314,
  },
  {
    id: 3,
    title: 'Nostalgic Blood of the Strife',
    diff: 'MAXIMUM',
    artist: 'Laur',
    mapper: 'Zelq',
    sr: '6.48',
    bpm: 240,
    length: '1:54',
    games: null,
  },
];

/** The cover a beatmap shows without its art: the gallery loads no covers. */
function PoolCover({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className="flex shrink-0">
      <BeatmapCover alt="" sizes="48px" className={className} />
    </span>
  );
}

function LinkRowDemo() {
  return (
    <Panel>
      <SectionHeader icon={Music2} title="Pooled beatmaps" meta="3 beatmaps" />
      <DataTable
        aria-label="Pooled beatmaps"
        fixed
        phoneRows={
          <PhoneRowList aria-label="Pooled beatmaps">
            {POOL.map((map) => (
              <PhoneRow
                key={map.id}
                href={here('tables-link-row')}
                linkLabel={`View ${map.artist} - ${map.title} [${map.diff}]`}
                title={
                  <span className="truncate" data-row-title>
                    {map.title}{' '}
                    <span className="font-normal text-muted-foreground">
                      [{map.diff}]
                    </span>
                  </span>
                }
                description={`${map.artist} · ${map.mapper} · ${map.sr} SR`}
                value={map.games === null ? null : formatCount(map.games)}
                valueDescription={map.games === null ? undefined : 'games'}
              />
            ))}
          </PhoneRowList>
        }
      >
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead>Beatmap</DataTableHead>
            <DataTableHead numeric className="w-16">
              SR
            </DataTableHead>
            <DataTableHead numeric showFrom="lg" className="w-16">
              BPM
            </DataTableHead>
            <DataTableHead numeric showFrom="lg" className="w-20">
              Length
            </DataTableHead>
            <DataTableHead numeric className="w-20">
              Games
            </DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {POOL.map((map) => (
            <DataTableLinkRow key={map.id}>
              <DataTableLinkCell
                href={here('tables-link-row')}
                label={`View ${map.artist} - ${map.title} [${map.diff}]`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <PoolCover className="h-7 w-12 rounded-md" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium" data-row-title>
                      {map.title}{' '}
                      <span className="font-normal text-muted-foreground">
                        [{map.diff}]
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {map.artist} · {map.mapper}
                    </span>
                  </span>
                </span>
              </DataTableLinkCell>
              <DataTableCell numeric>{map.sr}</DataTableCell>
              <DataTableCell numeric showFrom="lg">
                {formatCount(map.bpm)}
              </DataTableCell>
              <DataTableCell numeric showFrom="lg">
                {map.length}
              </DataTableCell>
              <DataTableCell numeric>{formatCount(map.games)}</DataTableCell>
            </DataTableLinkRow>
          ))}
        </DataTableBody>
      </DataTable>
    </Panel>
  );
}

// Entity links -----------------------------------------------------------------

function EntityLinkDemo() {
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <EntityLinkRows />
      </Panel>
      <Panel>
        <SectionHeader icon={History} title="Audit logs" />
        <RowList>
          {/* variant="inline": names inside a sentence. */}
          <RowListItem className="py-2.5 text-sm">
            apricot verified tournament{' '}
            <EntityLink href={here('tables-entity-link')} variant="inline">
              Corsace Open 2025
            </EntityLink>
          </RowListItem>
          <RowListItem className="py-2.5 text-sm">
            apricot rejected match{' '}
            <EntityLink href={here('tables-entity-link')} variant="inline">
              CO25: (Lunar Lobster) vs (Team Rocket)
            </EntityLink>{' '}
            in{' '}
            <EntityLink href={here('tables-entity-link')} variant="inline">
              Corsace Open 2025
            </EntityLink>
          </RowListItem>
        </RowList>
      </Panel>
      {/* wrap: a long name outside a table row keeps every word. */}
      <Panel className="max-w-60">
        <RowList>
          <RowListItem
            title={
              <EntityLink href={here('tables-entity-link')} wrap>
                CO25: (Lunar Lobster) vs (Team Rocket)
              </EntityLink>
            }
            description="wrap"
          />
          <RowListItem
            title={
              <EntityLink href={here('tables-entity-link')}>
                CO25: (Lunar Lobster) vs (Team Rocket)
              </EntityLink>
            }
            description="Default: truncates"
          />
        </RowList>
      </Panel>
    </div>
  );
}

function EntityLinkRows() {
  return (
    <RowList>
      <RowListItem
        title={
          <EntityLink
            href={here('tables-entity-link')}
            leading={<PlayerAvatar name="Accolibed" size={32} />}
          >
            Accolibed
          </EntityLink>
        }
        description="Player: the avatar sits inside the name's link"
      />
      <RowListItem
        title={
          <EntityLink
            href={here('tables-entity-link')}
            leading={
              <BeatmapCover
                alt=""
                sizes="56px"
                className="h-8 w-14 rounded-md"
              />
            }
          >
            Hotohashiru [Extra]
          </EntityLink>
        }
        description="Beatmap: the cover sits inside the same link"
      />
      <RowListItem
        title={
          <EntityLink href={here('tables-entity-link')}>
            Corsace Open 2025
          </EntityLink>
        }
        description="Tournament: no image, the name alone"
      />
    </RowList>
  );
}

// Reports and the View button ------------------------------------------------

type ReportRow = {
  id: number;
  type: string;
  entity: string;
  reason: string;
  status: ReportStatus;
  created: string;
  unread: boolean;
  additionalInformation: string | null;
};

const REPORTS: ReportRow[] = [
  {
    id: 1204,
    type: 'Match',
    entity: 'CO25: (Lunar Lobster) vs (Team Rocket)',
    reason: 'Incorrect match result',
    status: ReportStatus.Pending,
    created: '2025-10-12T18:42:00Z',
    unread: true,
    additionalInformation: 'Game 4 was replayed after a disconnect.',
  },
  {
    id: 1187,
    type: 'Tournament',
    entity: 'Break The Meta Cup',
    reason: 'Incorrect tournament details',
    status: ReportStatus.Approved,
    created: '2025-10-03T09:15:00Z',
    unread: false,
    additionalInformation:
      'The forum post lists a 10,000+ rank restriction, not open rank.',
  },
  {
    id: 1162,
    type: 'Score',
    entity: "lifeline's score",
    reason: 'Invalid score',
    status: ReportStatus.Rejected,
    created: '2025-09-28T21:03:00Z',
    unread: false,
    additionalInformation: null,
  },
];

/**
 * The View button and its report dialog, in the one dialog layout. As the
 * dialog's trigger, the button gets focus back when the dialog closes.
 */
function ReportView({ report }: { report: ReportRow }) {
  return (
    <DialogTemplate
      trigger={<ViewButton subject={`report #${formatId(report.id)}`} />}
      title="Report details"
      description={`${report.type} · ${report.entity}`}
    >
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
        <dt>
          <Eyebrow>Status</Eyebrow>
        </dt>
        <dd>
          <ReportStatusBadge status={report.status} size="sm" />
        </dd>
        <dt>
          <Eyebrow>Entity</Eyebrow>
        </dt>
        <dd>{report.entity}</dd>
        <dt>
          <Eyebrow>Submitted</Eyebrow>
        </dt>
        <dd>
          <Timestamp date={report.created} />
        </dd>
        <dt>
          <Eyebrow>Reason</Eyebrow>
        </dt>
        <dd>{report.reason}</dd>
        <dt>
          <Eyebrow>Additional information</Eyebrow>
        </dt>
        <dd>
          {report.additionalInformation ??
            'No additional information was provided.'}
        </dd>
      </dl>
    </DialogTemplate>
  );
}

function ReportsDemo() {
  return (
    <Panel>
      <SectionHeader icon={Flag} title="My reports" meta="3 reports" />
      <DataTable
        aria-label="My reports"
        phoneRows={
          <PhoneRowList aria-label="My reports">
            {REPORTS.map((report) => (
              <PhoneRow
                key={report.id}
                // The View button belongs to the name's line.
                align="start"
                title={
                  <>
                    {report.unread ? (
                      <NotificationDot label="Unread admin update" />
                    ) : null}
                    <EntityLink href={here('tables-view-button')}>
                      {report.entity}
                    </EntityLink>
                  </>
                }
                description={
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ReportStatusBadge status={report.status} size="sm" />
                    <span className="truncate">{report.reason}</span>
                  </span>
                }
                value={<ReportView report={report} />}
              />
            ))}
          </PhoneRowList>
        }
      >
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead className="w-8">
              <span className="sr-only">Unread</span>
            </DataTableHead>
            <DataTableHead>Entity</DataTableHead>
            <DataTableHead>Reason</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead showFrom="lg">Submitted</DataTableHead>
            <DataTableHead align="end">
              <span className="sr-only">Actions</span>
            </DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {REPORTS.map((report) => (
            <DataTableRow key={report.id}>
              <DataTableCell empty={false}>
                {report.unread ? (
                  <NotificationDot label="Unread admin update" />
                ) : null}
              </DataTableCell>
              <DataTableCell className="max-w-56">
                <span className="block text-xs text-muted-foreground">
                  {report.type}
                </span>
                <EntityLink href={here('tables-view-button')}>
                  {report.entity}
                </EntityLink>
              </DataTableCell>
              <DataTableCell>{report.reason}</DataTableCell>
              <DataTableCell>
                <ReportStatusBadge status={report.status} size="sm" />
              </DataTableCell>
              <DataTableCell muted showFrom="lg">
                <DateText date={report.created} />
              </DataTableCell>
              <DataTableCell align="end">
                <ReportView report={report} />
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </Panel>
  );
}

// Phone rows -------------------------------------------------------------------

const PHONE_TOURNAMENTS = [
  {
    id: 1,
    name: 'Corsace Open 2025',
    format: 'osu! · 4v4 · Open rank',
    matches: 412,
  },
  {
    id: 2,
    name: 'Break The Meta Cup',
    format: 'osu! · 1v1 · 10,000+',
    matches: 96,
  },
  {
    id: 3,
    name: 'Taiko Classic 2025',
    format: 'taiko · 2v2 · Open rank',
    matches: null,
  },
];

function PhoneRowsDemo() {
  return (
    <div className="flex max-w-sm flex-col gap-4">
      <Panel>
        <SectionHeader icon={ListOrdered} title="Global leaderboard" />
        <PhoneRowList as="ol" aria-label="Global leaderboard">
          {LEADERBOARD.slice(0, 4).map((row) => (
            <PhoneRow
              key={row.id}
              rank={formatRank(row.rank)}
              leading={<PlayerAvatar name={row.name} size={32} />}
              leadingHref={here('tables-phone-rows')}
              title={<PlayerName row={row} avatar={false} />}
              description={playerSummary(row)}
              valueAdornment={
                <TierMark tier={row.tier} subTier={row.subTier} size={22} />
              }
              value={formatRating(row.rating)}
            />
          ))}
        </PhoneRowList>
      </Panel>
      <Panel>
        <SectionHeader icon={Trophy} title="Tournaments" />
        <PhoneRowList aria-label="Tournaments">
          {PHONE_TOURNAMENTS.map((tournament) => (
            <PhoneRow
              key={tournament.id}
              href={here('tables-phone-rows')}
              linkLabel={`View ${tournament.name}`}
              title={
                <span className="truncate" data-row-title>
                  {tournament.name}
                </span>
              }
              description={tournament.format}
              value={
                tournament.matches === null
                  ? null
                  : formatCount(tournament.matches)
              }
              valueDescription={
                tournament.matches === null ? undefined : 'matches'
              }
            />
          ))}
        </PhoneRowList>
      </Panel>
    </div>
  );
}

// Paging -------------------------------------------------------------------------

const RESULTS = [
  { name: 'Corsace Open 2025', format: 'osu! · 4v4 · Open rank' },
  { name: 'osu! World Cup 2025', format: 'osu! · 4v4 · Open rank' },
  { name: 'Break The Meta Cup', format: 'osu! · 1v1 · 10,000+' },
];
const TOURNAMENT_COUNT = 1284;
/** The tournament list loads 30 tournaments at a time. */
const TOURNAMENT_PAGE_SIZE = 30;

function PaginationDemo() {
  const [page, setPage] = useState(1);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <SectionHeader
          icon={Trophy}
          title="Tournaments"
          meta={formatCountOf(TOURNAMENT_COUNT, 'tournament')}
        />
        <RowList>
          {RESULTS.map((result) => (
            <RowListItem
              key={result.name}
              title={
                <EntityLink href={here('tables-pagination')}>
                  {result.name}
                </EntityLink>
              }
              description={result.format}
            />
          ))}
        </RowList>
        <PaginationFooter
          page={page}
          pageSize={TOURNAMENT_PAGE_SIZE}
          totalCount={TOURNAMENT_COUNT}
          onPageChange={setPage}
          label="Tournament pages"
        />
      </Panel>
      <Panel>
        <PaginationFooter
          className="border-t-0"
          page={13}
          pageSize={TOURNAMENT_PAGE_SIZE}
          totalCount={TOURNAMENT_COUNT}
          getPageHref={(target) => `?page=${target}#tables-pagination`}
          label="Tournament pages"
        />
      </Panel>
      <Panel>
        <PaginationFooter
          className="border-t-0"
          page={43}
          pageSize={TOURNAMENT_PAGE_SIZE}
          totalCount={TOURNAMENT_COUNT}
          getPageHref={(target) => `?page=${target}#tables-pagination`}
          label="Tournament pages"
        />
      </Panel>
    </div>
  );
}

/** Older tournaments for the rest of the feed: name, matches, submitter. */
const OLDER_TOURNAMENTS = [
  ['osu! World Cup 2024', 131, 'lifeline'],
  ['Corsace Open 2024', 398, 'Accolibed'],
  ['Taiko World Cup 2024', 84, 'Raikouhou'],
  ['Mania 4K World Cup 2024', 158, 'distantmemory'],
  ['Catch the Beat World Cup 2024', 72, 'mrekk'],
  ['Taiko Classic 2024', 66, 'lifeline'],
  ['5 Digit United States Cup 2025', 143, 'distantmemory'],
  ['osu! World Cup 2023', 127, 'Accolibed'],
] as const;

/** Audit events as the audit logs word them: who, then what they did. */
const EVENTS = [
  'apricot verified tournament Corsace Open 2025',
  'apricot updated tournament Break The Meta Cup (Rank restriction)',
  'System pre-verified 412 matches in Corsace Open 2025',
  'lifeline submitted tournament Taiko Classic 2025',
  'apricot rejected match CO25: (Lunar Lobster) vs (Team Rocket) in Corsace Open 2025',
  'System pre-rejected 3 games in Break The Meta Cup',
  'apricot updated tournament Corsace Open 2025 (Abbreviation)',
  'System pre-verified 96 matches in Break The Meta Cup',
  'mrekk submitted tournament Break The Meta Cup',
  'apricot verified tournament osu! World Cup 2025',
  'System pre-verified 128 matches in osu! World Cup 2025',
  'distantmemory submitted tournament osu! World Cup 2025',
  ...OLDER_TOURNAMENTS.flatMap(([name, matches, submitter]) => [
    `apricot verified tournament ${name}`,
    `System pre-verified ${formatCount(matches)} matches in ${name}`,
    `${submitter} submitted tournament ${name}`,
  ]),
];
/** The audit logs load 30 events at a time. */
const EVENT_BATCH = 30;

function LoadMoreDemo() {
  return (
    <div className="flex flex-col gap-4">
      <AuditFeedDemo />
      <ShortFeedDemo />
    </div>
  );
}

/** A feed whose first batch holds everything: LoadMore renders nothing. */
function ShortFeedDemo() {
  const events = EVENTS.slice(0, 3);
  return (
    <div className="flex flex-col gap-1.5">
      <Panel>
        <SectionHeader icon={History} title="Audit history" />
        <RowList>
          {events.map((event) => (
            <RowListItem key={event} className="py-2.5 text-sm">
              {event}
            </RowListItem>
          ))}
        </RowList>
        <LoadMore
          hasMore={false}
          shownCount={events.length}
          totalCount={events.length}
          pageSize={EVENT_BATCH}
          onLoadMore={() => {}}
        />
      </Panel>
      <p className="text-xs text-muted-foreground">
        pageSize: the first batch held all 3 events, so there is no footer.
      </p>
    </div>
  );
}

function AuditFeedDemo() {
  const [shown, setShown] = useState(EVENT_BATCH);
  const [loading, setLoading] = useState(false);

  return (
    <Panel>
      <SectionHeader icon={ClipboardList} title="Audit logs" />
      {/* Gallery only: the feed scrolls in a box, so the button stays in view. */}
      <div
        role="region"
        aria-label="Audit events"
        tabIndex={0}
        className="max-h-80 overflow-y-auto focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <RowList>
          {EVENTS.slice(0, shown).map((event) => (
            <RowListItem key={event} className="py-2.5 text-sm">
              {event}
            </RowListItem>
          ))}
        </RowList>
      </div>
      <LoadMore
        hasMore={shown < EVENTS.length}
        loading={loading}
        shownCount={shown}
        totalCount={EVENTS.length}
        pageSize={EVENT_BATCH}
        onLoadMore={() => {
          setLoading(true);
          window.setTimeout(() => {
            setShown((count) => Math.min(EVENTS.length, count + EVENT_BATCH));
            setLoading(false);
          }, 600);
        }}
      />
    </Panel>
  );
}

// Show more -----------------------------------------------------------------

/** A player's tournaments, newest first, with the rating change from each. */
const PLAYER_TOURNAMENTS: {
  id: number;
  name: string;
  lobbySize: number;
  start: string;
  end: string;
  change: number;
}[] = [
  ['osu! World Cup 2025', 4, '2025-10-25', '2025-12-14', 41.2],
  ['Corsace Open 2025', 4, '2025-09-06', '2025-11-02', -12.6],
  ['Break The Meta Cup', 2, '2025-07-12', '2025-08-17', 18.9],
  ['Taiko Classic 2025', 1, '2025-06-07', '2025-07-06', 6.4],
  ['5 Digit United States Cup 2025', 2, '2025-04-19', '2025-05-25', -3.1],
  ['osu! World Cup 2024', 4, '2024-10-26', '2024-12-15', 27.5],
  ['Corsace Open 2024', 4, '2024-09-07', '2024-11-03', 9.8],
  ['Taiko World Cup 2024', 4, '2024-08-03', '2024-09-22', -7.7],
  ['Mania 4K World Cup 2024', 4, '2024-06-01', '2024-07-21', 14.2],
  ['Catch the Beat World Cup 2024', 4, '2024-04-13', '2024-06-02', 5.5],
  ['osu! World Cup 2023', 4, '2023-10-28', '2023-12-17', 22.1],
  ['Taiko Classic 2024', 1, '2024-02-03', '2024-03-03', -1.9],
].map(([name, lobbySize, start, end, change], index) => ({
  id: index + 1,
  name: name as string,
  lobbySize: lobbySize as number,
  start: start as string,
  end: end as string,
  change: change as number,
}));

/** The profile's tournament history shows five, then the rest 25 at a time. */
const INITIAL_TOURNAMENTS = 5;
const MORE_TOURNAMENTS = 25;

/**
 * A short list on a detail page, shown in part: the profile's tournament
 * history. It has no search or filters, so it grows in place with "Show
 * more" instead of paging.
 */
function ShowMoreDemo() {
  const [shown, setShown] = useState(INITIAL_TOURNAMENTS);

  return (
    <Panel>
      <SectionHeader
        icon={Trophy}
        title="Tournament history"
        meta={formatCountOf(PLAYER_TOURNAMENTS.length, 'tournament')}
      />
      <RowList>
        {PLAYER_TOURNAMENTS.slice(0, shown).map((tournament) => (
          <RowListItem
            key={tournament.id}
            title={
              <EntityLink href={here('tables-load-more-show-more')}>
                {tournament.name}
              </EntityLink>
            }
            description={
              <>
                {formatLobbySize(tournament.lobbySize)} ·{' '}
                <DateRangeText start={tournament.start} end={tournament.end} />
              </>
            }
            trailing={<RatingDelta value={tournament.change} />}
          />
        ))}
      </RowList>
      <LoadMore
        label="Show more"
        hasMore={shown < PLAYER_TOURNAMENTS.length}
        shownCount={shown}
        totalCount={PLAYER_TOURNAMENTS.length}
        pageSize={INITIAL_TOURNAMENTS}
        onLoadMore={() =>
          setShown((count) =>
            Math.min(count + MORE_TOURNAMENTS, PLAYER_TOURNAMENTS.length)
          )
        }
      />
    </Panel>
  );
}

// Audit history rows ------------------------------------------------------------

const APRICOT: AuditActionUser = {
  id: 12,
  playerId: null,
  osuId: null,
  username: 'apricot',
};
const HOBBES: AuditActionUser = {
  id: 31,
  playerId: null,
  osuId: null,
  username: 'Hobbes',
};

function auditEntry(
  entry: Pick<AuditEntry, 'id' | 'actionType' | 'changes' | 'created'> &
    Partial<AuditEntry>
): AuditEntry {
  return {
    entityType: AuditEntityType.Tournament,
    referenceIdLock: 401,
    referenceId: 401,
    actionUserId: entry.actionUser?.id ?? null,
    actionUser: null,
    referencedUsers: { '12': APRICOT, '31': HOBBES },
    ...entry,
  };
}

/** One tournament's history, newest first, as the audit history page lists it. */
const AUDIT_ENTRIES = {
  verified: auditEntry({
    id: 9004,
    actionType: AuditActionType.Updated,
    actionUser: APRICOT,
    created: '2026-10-14T15:42:07Z',
    changes: {
      verificationStatus: {
        originalValue: VerificationStatus.PreVerified,
        newValue: VerificationStatus.Verified,
      },
      verifiedByUserId: { originalValue: null, newValue: 12 },
    },
  }),
  preVerified: auditEntry({
    id: 9002,
    actionType: AuditActionType.Updated,
    created: '2026-10-09T03:15:44Z',
    changes: {
      verificationStatus: {
        originalValue: VerificationStatus.None,
        newValue: VerificationStatus.PreVerified,
      },
    },
  }),
  edited: auditEntry({
    id: 9001,
    actionType: AuditActionType.Updated,
    actionUser: HOBBES,
    created: '2026-10-08T21:05:12Z',
    changes: {
      rankRangeLowerBound: { originalValue: 1000, newValue: 1 },
      lobbySize: { originalValue: 4, newValue: 2 },
    },
  }),
};

const AUDIT_NOTE: AuditAdminNote = {
  id: 77,
  note: 'Checked the bracket against the forum post; the qualifier lobbies are left out on purpose.',
  created: '2026-10-12T09:30:00Z',
  updated: null,
  adminUser: APRICOT,
};

/**
 * The live audit history rows with static data: a verification (its one
 * status icon, details closed), an admin note, the automated check, an edit
 * whose changed fields open in place, and the submission read from the
 * tournament record. The rows take ids from their entries, so each themed
 * copy offsets them to keep the page's ids unique.
 */
function AuditRowsDemo({ idOffset }: { idOffset: number }) {
  const entry = (item: AuditEntry) => ({ ...item, id: item.id + idOffset });

  return (
    <Panel>
      <RowList aria-label="Audit history">
        <AuditEntryRow entry={entry(AUDIT_ENTRIES.verified)} />
        <AuditNoteItem note={{ ...AUDIT_NOTE, id: AUDIT_NOTE.id + idOffset }} />
        <AuditEntryRow entry={entry(AUDIT_ENTRIES.preVerified)} />
        <AuditEntryRow entry={entry(AUDIT_ENTRIES.edited)} />
        <AuditSubmissionRow
          submission={{ created: '2026-10-01T12:00:00Z', submittedBy: HOBBES }}
        />
      </RowList>
    </Panel>
  );
}

// Sticky header -----------------------------------------------------------------

/**
 * One player's rating adjustments, oldest first, as the profile's rating
 * history table lists them. Type names are the site's adjustment types.
 */
const RATING_ADJUSTMENTS: {
  date: string;
  type: 'Initial' | 'Match' | 'Decay';
  match: string | null;
  change: number;
}[] = [
  { date: '2024-11-09', type: 'Initial', match: null, change: 0 },
  {
    date: '2024-11-09',
    type: 'Match',
    match: 'OWC2024: (Chile) vs (Canada)',
    change: 18.6,
  },
  {
    date: '2024-11-16',
    type: 'Match',
    match: 'OWC2024: (Peru) vs (Canada)',
    change: -9.2,
  },
  { date: '2025-06-03', type: 'Decay', match: null, change: -14.5 },
  {
    date: '2025-09-13',
    type: 'Match',
    match: 'CO25: (Kiwi) vs (Maple)',
    change: 24.1,
  },
  {
    date: '2025-09-20',
    type: 'Match',
    match: 'CO25: (Orbit) vs (Maple)',
    change: 11.3,
  },
  {
    date: '2025-09-27',
    type: 'Match',
    match: 'CO25: (Comet) vs (Maple)',
    change: -6.8,
  },
  {
    date: '2025-11-08',
    type: 'Match',
    match: 'OWC2025: (Japan) vs (Canada)',
    change: 15.9,
  },
  {
    date: '2025-11-15',
    type: 'Match',
    match: 'OWC2025: (Brazil) vs (Canada)',
    change: -12.4,
  },
  {
    date: '2025-11-22',
    type: 'Match',
    match: 'OWC2025: (Chile) vs (Canada)',
    change: 9.7,
  },
];

/** Newest first, each with the rating it left the player at. */
const RATING_HISTORY = RATING_ADJUSTMENTS.reduce<
  ((typeof RATING_ADJUSTMENTS)[number] & { id: number; rating: number })[]
>((rows, adjustment, index) => {
  const before = rows[0]?.rating ?? 2400;
  return [
    { ...adjustment, id: index, rating: before + adjustment.change },
    ...rows,
  ];
}, []);

function StickyHeaderDemo() {
  return (
    <Panel>
      <SectionHeader icon={History} title="Rating history" />
      {/* Focusable so the box scrolls by keyboard. */}
      <div
        tabIndex={0}
        className="max-h-72 overflow-y-auto focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <DataTable aria-label="Rating history" stickyHeader="scroll-area" fixed>
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead className="w-26">Date</DataTableHead>
              <DataTableHead showFrom="sm">Match</DataTableHead>
              <DataTableHead showFrom="md" className="w-16">
                Type
              </DataTableHead>
              <DataTableHead numeric className="w-16">
                Rating
              </DataTableHead>
              <DataTableHead numeric className="w-20">
                Change
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {RATING_HISTORY.map((event) => (
              <DataTableRow key={event.id}>
                <DataTableCell muted>
                  <DateText date={event.date} />
                </DataTableCell>
                <DataTableCell showFrom="sm">
                  {event.match ? (
                    <EntityLink href={here('tables-sticky-header')}>
                      {event.match}
                    </EntityLink>
                  ) : null}
                </DataTableCell>
                <DataTableCell showFrom="md">{event.type}</DataTableCell>
                <DataTableCell numeric className="font-semibold">
                  {formatRating(event.rating)}
                </DataTableCell>
                <DataTableCell numeric>
                  {event.type === 'Initial' ? null : (
                    <RatingDelta value={event.change} />
                  )}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      </div>
    </Panel>
  );
}

const SCORES = [
  {
    id: 1,
    player: 'lifeline',
    score: 1204512,
    accuracy: 0.9854,
    played: '2025-10-04',
  },
  {
    id: 2,
    player: 'Raikouhou',
    score: 1187003,
    accuracy: null,
    played: '2025-09-27',
  },
  { id: 3, player: 'Yasui', score: 1011245, accuracy: 0.9612, played: null },
];

function MissingValueDemo() {
  return (
    <Panel>
      <DataTable aria-label="Leaderboard">
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead>Player</DataTableHead>
            <DataTableHead numeric>Score</DataTableHead>
            <DataTableHead numeric showFrom="sm">
              Accuracy
            </DataTableHead>
            <DataTableHead align="end">Played</DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {SCORES.map((score) => (
            <DataTableRow key={score.id}>
              <DataTableCell>
                <EntityLink
                  href={here('tables-missing-value')}
                  leading={<PlayerAvatar name={score.player} />}
                >
                  {score.player}
                </EntityLink>
              </DataTableCell>
              <DataTableCell numeric className="font-semibold">
                {formatCount(score.score)}
              </DataTableCell>
              <DataTableCell numeric muted showFrom="sm">
                {formatAccuracy(score.accuracy)}
              </DataTableCell>
              <DataTableCell align="end" muted>
                {score.played ? <DateText date={score.played} /> : null}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
      <p className="border-t px-4 py-3 text-sm">
        Peak rating: <MissingValue />
      </p>
    </Panel>
  );
}

export default function TablesSection() {
  return (
    <GallerySection
      id="tables"
      title="Tables, rows and paging"
      description="Table styles, rows on phones, pagination and row actions."
    >
      <Specimen
        id="tables-data-table"
        name="DataTable"
        importPath={`${KIT}/DataTable`}
        description="The one table style: muted 12px headers on a tinted strip, right-aligned numbers, no stripes, edge to edge in its panel. This one has sortable columns, numbered pages and phone rows below tablet width, where `phoneSort` puts a SortControl on the same sort state above the rows; only the names link, so rows get no hover tint."
        stacked
      >
        <LeaderboardDemo />
      </Specimen>

      <Specimen
        id="tables-sticky-header"
        name="Sticky header"
        importPath={`${KIT}/DataTable`}
        description='Long tables keep their header in view. On a page, stickyHeader pins it under the site header from tablet width; inside a scrolling box, such as a dialog, stickyHeader="scroll-area" pins it to the box. Scroll this one.'
      >
        <StickyHeaderDemo />
      </Specimen>

      <Specimen
        id="tables-sortable-header"
        name="SortableHeader"
        importPath={`${KIT}/SortableHeader`}
        stacked
        description="A column header that sorts. It shares its { key, direction } state with the toolbar's sort control; the sorted column shows its arrow, and numeric columns lead with the arrow so the label lines up with the numbers."
      >
        <SortableHeaderDemo />
      </Specimen>

      <Specimen
        id="tables-link-row"
        name="DataTableLinkRow and DataTableLinkCell"
        importPath={`${KIT}/DataTableLinkRow`}
        description="Only for tables whose rows already open as a whole: the beatmap list and pooled beatmaps. The row gets the hover tint and the name turns blue; a click anywhere follows the one link in the name cell. Below tablet width the rows become PhoneRows that link as a whole; the beatmap list's table and a pool show the list's cover rows instead (BeatmapListRows), so the audio preview, mapper and mods stay."
        stacked
      >
        <LinkRowDemo />
      </Specimen>

      <Specimen
        id="tables-entity-link"
        name="EntityLink"
        importPath={`${KIT}/EntityLink`}
        description="The name as a link, with its avatar or cover inside the same link: one link per destination. Use it wherever only the name opens the entity. The `inline` variant is for names inside a sentence, such as audit events; `wrap` keeps a long name whole outside table rows."
      >
        <EntityLinkDemo />
      </Specimen>

      <Specimen
        id="tables-view-button"
        name="ViewButton"
        importPath={`${KIT}/ViewButton`}
        description="A labelled View button that opens a report in a modal, on My reports and the admin queue. The row is not clickable; its entity link still works on its own. On phones the button is the row's value, set on the name's line with align `start`."
        stacked
      >
        <ReportsDemo />
      </Specimen>

      <Specimen
        id="tables-phone-rows"
        name="PhoneRowList and PhoneRow"
        importPath={`${KIT}/PhoneRow`}
        description="What a table becomes below tablet width: rank, a 32px avatar beside the name and flag and the muted line under them, and the key number on the right with the tier icon 4px to its left. Nothing scrolls sideways. Whole-row links only where the rows already open as a whole."
      >
        <PhoneRowsDemo />
      </Specimen>

      <Specimen
        id="tables-pagination"
        name="PaginationFooter"
        importPath={`${KIT}/PaginationFooter`}
        stacked
        description="Numbered pages in the panel's footer with a 1–30 of 1,284 readout, for every searchable list. A footer narrower than 36rem keeps only the arrows and the page count. Links for lists paged in the address, buttons for lists paged in state."
      >
        <PaginationDemo />
      </Specimen>

      <Specimen
        id="tables-load-more"
        name="LoadMore"
        importPath={`${KIT}/LoadMore`}
        description="The footer of an activity feed, such as the audit log, filtered or not: a count and a Load more button that appends the next batch, then a note once everything is showing. With `pageSize`, a feed whose first batch holds everything gets no footer at all. Searchable lists page instead."
      >
        <LoadMoreDemo />
      </Specimen>

      <Specimen
        id="tables-load-more-show-more"
        name="LoadMore, Show more"
        importPath={`${KIT}/LoadMore`}
        description={`The same footer with label="Show more", for a short list on a detail page that shows its first rows and the rest on request, such as a profile's tournament history (five, then 25 at a time). The count stays in the readout, never in the label.`}
      >
        <ShowMoreDemo />
      </Specimen>

      <Specimen
        id="tables-audit-rows"
        name="Audit history rows"
        importPath="@/components/audit/AuditEntryRow, @/components/audit/AuditNoteItem"
        description="The real rows of an entity's audit history, with static data. Each row is a sentence: the one status icon for a verification, who (System for automated checks), what, and the time in a feed's relative form. Changed fields open in place under the Details disclosure (IconButton `expanded`), as AuditFieldChange lines: open at first for an edit or an automated check, closed for an admin's verification, whose icon already says what changed."
      >
        {(theme) => <AuditRowsDemo idOffset={theme === 'dark' ? 100_000 : 0} />}
      </Specimen>

      <Specimen
        id="tables-missing-value"
        name="MissingValue"
        importPath={`${KIT}/MissingValue`}
        description="A muted em dash for a missing value, read as “No value”. Table cells and phone rows render it for null, empty and the formatters' dash; use it directly elsewhere."
      >
        <MissingValueDemo />
      </Specimen>
    </GallerySection>
  );
}
