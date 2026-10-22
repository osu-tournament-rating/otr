import { Ruleset } from '@otr/core/osu';
import { Trophy } from 'lucide-react';

import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { RatingDelta } from '@/components/kit/format/RatingDelta';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { TermTooltip } from '@/components/kit/layout/TermTooltip';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import { formatNumber, formatRank } from '@/lib/kit/format/number';
import { TournamentPlayerStats } from '@/lib/orpc/schema/tournament';

/** Players need this many matches to count as a top performer. */
const MIN_MATCHES = 3;

const playerHref = (
  player: TournamentPlayerStats['player'],
  ruleset: Ruleset
) => `/players/${player.id}?ruleset=${ruleset}`;

/** The name, with a 24px avatar inside its link in the table. */
function PlayerLink({
  player,
  ruleset,
  avatar = true,
}: {
  player: TournamentPlayerStats['player'];
  ruleset: Ruleset;
  /** Off on phone rows, which show a 32px avatar beside the name and its line. */
  avatar?: boolean;
}) {
  return (
    <EntityLink
      href={playerHref(player, ruleset)}
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

const formatMatchCost = (value: number) => formatNumber(value, { decimals: 2 });
const formatAverage = (value: number) => formatNumber(value, { decimals: 1 });

/** How the weighted match cost below is calculated, in words. */
const MATCH_COST_HINT =
  'Average of all matches plus up to 50% depending on number of matches played';

/** The match cost label, which opens {@link MATCH_COST_HINT}. */
const matchCostLabel = (
  <TermTooltip hint={MATCH_COST_HINT}>Match cost</TermTooltip>
);

/** Matches played past which the match cost bonus stops growing. */
const FULL_BONUS_MATCHES = 6;

/**
 * A player's tournament match cost: their average match cost, raised by 10%
 * for each verified match they played past the first, up to 50% at six.
 * One strong match then cannot outrank a run through the whole bracket.
 */
const weightedMatchCost = (stats: TournamentPlayerStats) =>
  stats.averageMatchCost *
  (0.9 + 0.1 * Math.min(stats.matchesPlayed, FULL_BONUS_MATCHES));

/**
 * The three players with the best weighted match cost (3+ matches), each
 * with that match cost.
 */
export function selectTopPerformers(playerStats: TournamentPlayerStats[]) {
  return playerStats
    .filter((stats) => stats.matchesPlayed >= MIN_MATCHES)
    .map((stats) => ({ stats, matchCost: weightedMatchCost(stats) }))
    .sort((a, b) => b.matchCost - a.matchCost)
    .slice(0, 3);
}

/** The three players with the best weighted match cost (3+ matches). */
export default function TournamentTopPerformers({
  playerStats,
  ruleset,
}: {
  playerStats: TournamentPlayerStats[];
  ruleset: Ruleset;
}) {
  const topPerformers = selectTopPerformers(playerStats);

  return (
    <Panel>
      <SectionHeader icon={Trophy} title="Top performers" />
      {topPerformers.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Trophy}
          title="No qualifying players"
          description={`Players need at least ${MIN_MATCHES} matches to qualify.`}
        />
      ) : (
        <DataTable
          aria-label="Top performers"
          phoneRows={
            <PhoneRowList as="ol" aria-label="Top performers">
              {topPerformers.map(({ stats, matchCost }, index) => (
                <PhoneRow
                  key={stats.player.id}
                  rank={formatRank(index + 1)}
                  leading={
                    <OsuAvatar
                      osuId={stats.player.osuId}
                      username={stats.player.username}
                      size={32}
                    />
                  }
                  leadingHref={playerHref(stats.player, ruleset)}
                  title={
                    <PlayerLink
                      player={stats.player}
                      ruleset={ruleset}
                      avatar={false}
                    />
                  }
                  // One phone line holds only one figure beside the match
                  // cost; average games stays in the table.
                  description={`Avg. placement ${formatAverage(stats.averagePlacement)}`}
                  value={formatMatchCost(matchCost)}
                  valueDescription={matchCostLabel}
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead className="w-16">Rank</DataTableHead>
              <DataTableHead>Player</DataTableHead>
              <DataTableHead numeric>{matchCostLabel}</DataTableHead>
              <DataTableHead numeric>Avg. placement</DataTableHead>
              <DataTableHead numeric>Avg. games</DataTableHead>
              <DataTableHead numeric>Avg. rating change</DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {topPerformers.map(({ stats, matchCost }, index) => (
              <DataTableRow key={stats.player.id}>
                <DataTableCell className="font-medium tabular-nums">
                  {formatRank(index + 1)}
                </DataTableCell>
                <DataTableCell>
                  <PlayerLink player={stats.player} ruleset={ruleset} />
                </DataTableCell>
                <DataTableCell numeric>
                  {formatMatchCost(matchCost)}
                </DataTableCell>
                <DataTableCell numeric>
                  {formatAverage(stats.averagePlacement)}
                </DataTableCell>
                <DataTableCell numeric>
                  {formatAverage(stats.gamesPlayed / stats.matchesPlayed)}
                </DataTableCell>
                <DataTableCell numeric>
                  <RatingDelta value={stats.averageRatingDelta} />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </Panel>
  );
}
