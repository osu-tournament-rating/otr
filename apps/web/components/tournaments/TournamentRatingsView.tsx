'use client';

import type { VerificationStatus } from '@otr/core/osu';
import { Download, TrendingUp } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Button } from '@/components/kit/controls/Button';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { RatingDelta } from '@/components/kit/format/RatingDelta';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { SortableHeader } from '@/components/kit/tables/SortableHeader';
import { getTournamentStatsEmptyCopy } from '@/components/tournaments/statsEmptyCopy';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import {
  formatCount,
  formatCountOf,
  formatRating,
  formatRatingDelta,
} from '@/lib/kit/format/number';
import { defineListParams, sortParam } from '@/lib/kit/lists/params';
import type { SortState } from '@/lib/kit/lists/sort';
import { useListState } from '@/lib/kit/lists/use-list-state';
import { sortRows } from '@/lib/kit/tables/sort';
import type { TournamentPlayerStats } from '@/lib/orpc/schema/tournament';

export type RatingSortKey =
  'player' | 'matches' | 'games' | 'before' | 'after' | 'average' | 'total';

const RATING_SORT_KEYS: readonly RatingSortKey[] = [
  'player',
  'matches',
  'games',
  'before',
  'after',
  'average',
  'total',
];

/**
 * The columns as sort options, for phones, where the rows have no headers.
 * Each starts in its header's direction: names A to Z, numbers highest first.
 */
const RATING_SORT_OPTIONS: readonly SortOption<RatingSortKey>[] = [
  { value: 'player', label: 'Player', defaultDirection: 'asc' },
  { value: 'matches', label: 'Matches', defaultDirection: 'desc' },
  { value: 'games', label: 'Games', defaultDirection: 'desc' },
  { value: 'before', label: 'Rating before', defaultDirection: 'desc' },
  { value: 'after', label: 'Rating after', defaultDirection: 'desc' },
  { value: 'average', label: 'Avg. change', defaultDirection: 'desc' },
  { value: 'total', label: 'Total change', defaultDirection: 'desc' },
];

const DEFAULT_RATING_SORT: SortState<RatingSortKey> = {
  key: 'total',
  direction: 'desc',
};

/** The ratings table's sort, in the tournament page's address. */
const TOURNAMENT_RATING_PARAMS = defineListParams({
  sort: sortParam(RATING_SORT_KEYS, DEFAULT_RATING_SORT),
});

const totalChange = (row: TournamentPlayerStats) =>
  row.averageRatingDelta * row.matchesPlayed;

const SORT_VALUES = {
  player: (row: TournamentPlayerStats) => row.player.username,
  // Win–loss records: the wider positive margin first, then more wins.
  matches: (row: TournamentPlayerStats) =>
    (row.matchesWon - row.matchesLost) * 10_000 + row.matchesWon,
  games: (row: TournamentPlayerStats) =>
    (row.gamesWon - row.gamesLost) * 10_000 + row.gamesWon,
  before: (row: TournamentPlayerStats) => row.ratingBefore,
  after: (row: TournamentPlayerStats) => row.ratingAfter,
  average: (row: TournamentPlayerStats) => row.averageRatingDelta,
  total: totalChange,
} satisfies Record<RatingSortKey, (row: TournamentPlayerStats) => unknown>;

/** `7–1`, wins in green and losses in red, the numbers carrying the meaning. */
function WinLoss({ won, lost }: { won: number; lost: number }) {
  return (
    <span className="tabular-nums">
      <span className="text-success-foreground">{formatCount(won)}</span>
      <span className="text-muted-foreground">–</span>
      <span className="text-destructive">{formatCount(lost)}</span>
    </span>
  );
}

const playerHref = (player: TournamentPlayerStats['player']) =>
  `/players/${player.id}`;

/** The name, with a 24px avatar inside its link in the table. */
function PlayerLink({
  player,
  avatar = true,
}: {
  player: TournamentPlayerStats['player'];
  /** Off on phone rows, which show a 32px avatar beside the name and its line. */
  avatar?: boolean;
}) {
  return (
    <EntityLink
      href={playerHref(player)}
      leading={
        avatar ? (
          <OsuAvatar
            osuId={player.osuId}
            username={player.username}
            size={24}
          />
        ) : undefined
      }
    >
      {player.username}
    </EntityLink>
  );
}

const formatWinLoss = (won: number, lost: number) =>
  `${formatCount(won)}–${formatCount(lost)}`;

/**
 * The phone row's muted line: the columns the phone hides, led by the
 * sorted one, so the order on screen has a visible reason.
 */
export function getPhoneDescription(
  row: TournamentPlayerStats,
  sortKey: RatingSortKey
): string {
  const matches = `Matches ${formatWinLoss(row.matchesWon, row.matchesLost)}`;
  const ratings = `${formatRating(row.ratingBefore)} → ${formatRating(row.ratingAfter)}`;

  switch (sortKey) {
    case 'games':
      return [
        `Games ${formatWinLoss(row.gamesWon, row.gamesLost)}`,
        matches,
        ratings,
      ].join(' · ');
    case 'average':
      return [
        `Avg. change ${formatRatingDelta(row.averageRatingDelta)}`,
        matches,
        ratings,
      ].join(' · ');
    case 'before':
    case 'after':
      return [ratings, matches].join(' · ');
    default:
      return [matches, ratings].join(' · ');
  }
}

function downloadCsv(rows: readonly TournamentPlayerStats[]) {
  const headers = [
    'Player',
    'Matches Won',
    'Matches Lost',
    'Games Won',
    'Games Lost',
    'Rating Before',
    'Rating After',
    'Average Change',
    'Total Change',
  ];

  const csvRows = rows.map((stat) => [
    stat.player.username,
    stat.matchesWon,
    stat.matchesLost,
    stat.gamesWon,
    stat.gamesLost,
    stat.ratingBefore.toFixed(1),
    stat.ratingAfter.toFixed(1),
    stat.averageRatingDelta.toFixed(1),
    totalChange(stat).toFixed(1),
  ]);

  const csvContent = [headers, ...csvRows]
    .map((row) => row.join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'tournament-ratings.csv';
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * The Ratings tab: every player's record and rating change in the
 * tournament, sortable by any column (the sort is kept in the address), as
 * rows on phones.
 */
export default function TournamentRatingsView({
  playerStats,
  verificationStatus,
}: {
  playerStats: TournamentPlayerStats[];
  /** Says why there are no rating changes yet. */
  verificationStatus: VerificationStatus;
}) {
  // Every row is on the client already: a sort only rewrites the address.
  const { state, setState } = useListState(TOURNAMENT_RATING_PARAMS, {
    shallow: true,
  });
  const sort = state.sort;
  const rows = useMemo(
    () => sortRows(playerStats, sort, SORT_VALUES),
    [playerStats, sort]
  );
  const onSortChange = useCallback(
    (next: SortState<RatingSortKey>) => setState({ sort: next }),
    [setState]
  );
  const headerProps = { sort, onSortChange } as const;

  return (
    <Panel>
      <SectionHeader
        icon={TrendingUp}
        title="Rating changes"
        meta={
          playerStats.length > 0
            ? formatCountOf(playerStats.length, 'player')
            : undefined
        }
        actions={
          playerStats.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              icon={Download}
              onClick={() => downloadCsv(rows)}
            >
              Download CSV
            </Button>
          ) : undefined
        }
      />

      {playerStats.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          {...getTournamentStatsEmptyCopy(verificationStatus, 'Rating changes')}
        />
      ) : (
        <DataTable
          aria-label="Rating changes"
          stickyHeader
          // The headers sort the table; phones get the same sort here.
          phoneSort={
            <SortControl
              size="sm"
              label="Sort rating changes by"
              options={RATING_SORT_OPTIONS}
              value={sort}
              onValueChange={onSortChange}
            />
          }
          phoneRows={
            <PhoneRowList aria-label="Rating changes">
              {rows.map((row) => (
                <PhoneRow
                  key={row.player.id}
                  leading={
                    <OsuAvatar
                      osuId={row.player.osuId}
                      username={row.player.username}
                      size={32}
                    />
                  }
                  leadingHref={playerHref(row.player)}
                  title={<PlayerLink player={row.player} avatar={false} />}
                  description={getPhoneDescription(row, sort.key)}
                  value={<RatingDelta value={totalChange(row)} />}
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <SortableHeader
                {...headerProps}
                sortKey="player"
                defaultDirection="asc"
              >
                Player
              </SortableHeader>
              <SortableHeader {...headerProps} sortKey="matches" numeric>
                Matches
              </SortableHeader>
              <SortableHeader
                {...headerProps}
                sortKey="games"
                numeric
                showFrom="lg"
              >
                Games
              </SortableHeader>
              <SortableHeader {...headerProps} sortKey="before" numeric>
                Before
              </SortableHeader>
              <SortableHeader {...headerProps} sortKey="after" numeric>
                After
              </SortableHeader>
              <SortableHeader {...headerProps} sortKey="average" numeric>
                Avg. change
              </SortableHeader>
              <SortableHeader {...headerProps} sortKey="total" numeric>
                Total change
              </SortableHeader>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {rows.map((row) => (
              <DataTableRow key={row.player.id}>
                <DataTableCell>
                  <PlayerLink player={row.player} />
                </DataTableCell>
                <DataTableCell numeric>
                  <WinLoss won={row.matchesWon} lost={row.matchesLost} />
                </DataTableCell>
                <DataTableCell numeric showFrom="lg">
                  <WinLoss won={row.gamesWon} lost={row.gamesLost} />
                </DataTableCell>
                <DataTableCell numeric>
                  {formatRating(row.ratingBefore)}
                </DataTableCell>
                <DataTableCell numeric>
                  {formatRating(row.ratingAfter)}
                </DataTableCell>
                <DataTableCell numeric>
                  <RatingDelta value={row.averageRatingDelta} />
                </DataTableCell>
                <DataTableCell numeric>
                  <RatingDelta value={totalChange(row)} />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </Panel>
  );
}
