'use client';

import { VerificationStatus } from '@otr/core/osu';
import { ChartColumn, Users } from 'lucide-react';
import { useMemo } from 'react';

import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  SortControl,
  type SortOption,
} from '@/components/kit/lists/SortControl';
import {
  DataTable,
  DataTableBody,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { SortableHeader } from '@/components/kit/tables/SortableHeader';
import { formatCountOf } from '@/lib/kit/format/number';
import { defineListParams, sortParam } from '@/lib/kit/lists/params';
import type { SortState } from '@/lib/kit/lists/sort';
import { useListState } from '@/lib/kit/lists/use-list-state';
import { sortRows } from '@/lib/kit/tables/sort';
import type { MatchDetail } from '@/lib/orpc/schema/match';

import MatchStatsHighlights from './MatchStatsHighlights';
import {
  PLAYER_STATS_COLUMN,
  PlayerStatsPhoneRow,
  PlayerStatsTableRow,
} from './MatchStatsPlayerRow';
import {
  PLAYER_PERFORMANCE_INFO,
  calculateHighlightStats,
  processMatchStatistics,
  type ProcessedPlayerStats,
} from './MatchStatsUtils';
import MatchTeamScoresChart from './MatchTeamScoresChart';

const PLAYER_SORT_KEYS = [
  'player',
  'record',
  'matchCost',
  'rating',
  'ratingChange',
  'score',
  'accuracy',
  'misses',
  'placement',
] as const;

type PlayerSortKey = (typeof PLAYER_SORT_KEYS)[number];

/**
 * The player table's sort, kept in the address as `sort` and `dir`. Every
 * row is on the client already, so a sort changes the address without
 * rendering the page again.
 */
const MATCH_STATS_PARAMS = defineListParams({
  sort: sortParam(PLAYER_SORT_KEYS, { key: 'matchCost', direction: 'desc' }),
});

// Ties sort by name, so a list sorted by record or placement stays put.
const nameCollator = new Intl.Collator('en-US', { sensitivity: 'base' });

function sortPlayers(
  players: readonly ProcessedPlayerStats[],
  sort: SortState<PlayerSortKey>,
  hasRecordedResult: boolean
) {
  const byName = [...players].sort((a, b) =>
    nameCollator.compare(a.username, b.username)
  );

  return sortRows(byName, sort, {
    player: (player) => player.username,
    record: (player) =>
      hasRecordedResult
        ? player.gamesWon - player.gamesLost
        : player.gamesPlayed,
    matchCost: (player) => player.matchCost,
    rating: (player) => player.ratingAfter,
    ratingChange: (player) => player.ratingDelta,
    score: (player) => player.averageScore,
    accuracy: (player) => player.averageAccuracy,
    misses: (player) => player.averageMisses,
    placement: (player) => player.averagePlacement,
  });
}

/**
 * The match's Stats tab: the headline numbers, the team score chart and the
 * player performance table. Only verified matches have statistics.
 */
export default function MatchStatsView({ match }: { match: MatchDetail }) {
  const isVerified = match.verificationStatus === VerificationStatus.Verified;
  const hasStats = isVerified && Boolean(match.playerMatchStats?.length);

  if (!hasStats) {
    return (
      <Panel data-testid="match-stats-summary">
        <SectionHeader icon={ChartColumn} title="Match statistics" />
        {isVerified ? (
          <EmptyState
            icon={ChartColumn}
            title="No match statistics yet"
            description="Match statistics show here from the Tuesday update after this match was verified."
          />
        ) : (
          // The status badge in the hero, and the "Not in ratings yet"
          // notice above, already say where the match stands.
          <EmptyState
            icon={ChartColumn}
            title="No match statistics"
            description="Match statistics are only available for verified matches."
          />
        )}
      </Panel>
    );
  }

  return <VerifiedMatchStats match={match} />;
}

function VerifiedMatchStats({ match }: { match: MatchDetail }) {
  const list = useListState(MATCH_STATS_PARAMS, { shallow: true });
  const sort = list.state.sort;
  const hasRecordedResult = Boolean(match.winRecord);
  const ruleset = match.tournament?.ruleset;

  const players = useMemo(
    () => processMatchStatistics(match, match.players ?? []),
    [match]
  );
  const highlights = useMemo(
    () => calculateHighlightStats(players, match),
    [players, match]
  );
  const sortedPlayers = useMemo(
    () => sortPlayers(players, sort, hasRecordedResult),
    [players, sort, hasRecordedResult]
  );

  const sortOptions: SortOption<PlayerSortKey>[] = [
    { value: 'player', label: 'Player', defaultDirection: 'asc' },
    {
      value: 'record',
      label: hasRecordedResult ? 'Record' : 'Games played',
      defaultDirection: 'desc',
    },
    { value: 'matchCost', label: 'Match cost', defaultDirection: 'desc' },
    { value: 'rating', label: 'Rating', defaultDirection: 'desc' },
    { value: 'ratingChange', label: 'Rating change', defaultDirection: 'desc' },
    { value: 'score', label: 'Score', defaultDirection: 'desc' },
    { value: 'accuracy', label: 'Accuracy', defaultDirection: 'desc' },
    { value: 'misses', label: 'Misses', defaultDirection: 'desc' },
    { value: 'placement', label: 'Placement', defaultDirection: 'desc' },
  ];
  const setSort = (next: SortState<PlayerSortKey>) =>
    list.setState({ sort: next });
  const headerProps = { sort, onSortChange: setSort };

  return (
    <>
      <Panel data-testid="match-stats-summary">
        <SectionHeader icon={ChartColumn} title="Match statistics" />
        <PanelBody>
          <MatchStatsHighlights stats={highlights} ruleset={ruleset} />
        </PanelBody>
      </Panel>

      <MatchTeamScoresChart games={match.games} />

      <Panel data-testid="player-stats-table">
        <SectionHeader
          icon={Users}
          title="Player performance"
          infoText={PLAYER_PERFORMANCE_INFO}
          meta={formatCountOf(players.length, 'player')}
        />
        <DataTable
          aria-label="Player performance statistics"
          phoneSort={
            <SortControl
              size="sm"
              label="Sort players by"
              value={sort}
              onValueChange={setSort}
              options={sortOptions}
            />
          }
          phoneRows={
            <PhoneRowList aria-label="Player performance statistics">
              {sortedPlayers.map((player) => (
                <PlayerStatsPhoneRow
                  key={player.playerId}
                  player={player}
                  showRecord={hasRecordedResult}
                  ruleset={ruleset}
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <SortableHeader
                sortKey="player"
                defaultDirection="asc"
                {...headerProps}
              >
                Player
              </SortableHeader>
              <SortableHeader sortKey="record" numeric {...headerProps}>
                {hasRecordedResult ? 'Record' : 'Games'}
              </SortableHeader>
              <SortableHeader
                sortKey="matchCost"
                numeric
                data-testid="match-cost-header"
                {...headerProps}
              >
                Match cost
              </SortableHeader>
              <SortableHeader
                sortKey="rating"
                numeric
                showFrom={PLAYER_STATS_COLUMN.rating}
                {...headerProps}
              >
                Rating
              </SortableHeader>
              <SortableHeader sortKey="ratingChange" numeric {...headerProps}>
                Change
              </SortableHeader>
              <SortableHeader
                sortKey="score"
                numeric
                showFrom={PLAYER_STATS_COLUMN.score}
                {...headerProps}
              >
                Score
              </SortableHeader>
              <SortableHeader sortKey="accuracy" numeric {...headerProps}>
                Accuracy
              </SortableHeader>
              <SortableHeader
                sortKey="misses"
                numeric
                showFrom={PLAYER_STATS_COLUMN.misses}
                {...headerProps}
              >
                Misses
              </SortableHeader>
              <SortableHeader
                sortKey="placement"
                numeric
                showFrom={PLAYER_STATS_COLUMN.placement}
                {...headerProps}
              >
                Placement
              </SortableHeader>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {sortedPlayers.map((player) => (
              <PlayerStatsTableRow
                key={player.playerId}
                player={player}
                showRecord={hasRecordedResult}
                ruleset={ruleset}
              />
            ))}
          </DataTableBody>
        </DataTable>
      </Panel>
    </>
  );
}
