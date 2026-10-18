'use client';

import { ChevronDown, Swords } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

import { Button } from '@/components/kit/controls/Button';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { DateRangeText } from '@/components/kit/format/DateRangeText';
import { RatingDelta } from '@/components/kit/format/RatingDelta';
import { RulesetName } from '@/components/kit/format/RulesetName';
import { RowListItem } from '@/components/kit/layout/RowList';
import { typeScale } from '@/components/kit/layout/Typography';
import { Badge } from '@/components/kit/status/Badge';
import { NotInRatings } from '@/components/kit/status/NotInRatings';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import { getRejectionReasonTexts } from '@/lib/kit/status/reasons';
import type { PlayerRatingAdjustment } from '@/lib/orpc/schema/playerStats';
import type { PlayerTournamentHistoryItem } from '@/lib/orpc/schema/tournament';
import { cn } from '@/lib/utils';

import PlayerTournamentMatchTable from './PlayerTournamentMatchTable';

/** A small label over a number, on the right of a tournament row. */
function RowStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-14 sm:text-right">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * One tournament in a player's history: its name, status and facts, the
 * player's match record and rating change, and a Matches button that
 * expands the tournament's matches in place. Without stats for the player
 * there is no record, so the row stops at its name, status and facts.
 */
export default function PlayerTournamentCard({
  tournament,
  adjustments,
}: {
  tournament: PlayerTournamentHistoryItem;
  adjustments: PlayerRatingAdjustment[];
}) {
  const [isMatchesVisible, setIsMatchesVisible] = useState(false);
  const matchesId = useId();

  const record =
    tournament.matchesWon !== null && tournament.matchesLost !== null
      ? { won: tournament.matchesWon, lost: tournament.matchesLost }
      : null;

  const tournamentAdjustments = adjustments.filter(
    (adjustment) => adjustment.match?.tournamentId === tournament.id
  );
  const totalRatingDelta = tournamentAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.ratingDelta,
    0
  );

  return (
    <RowListItem className="p-0" data-testid="player-tournament-row">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className={cn(typeScale.rowTitle, 'min-w-0')}>
              <EntityLink
                href={`/tournaments/${tournament.id}`}
                title={tournament.name}
              >
                {tournament.name}
              </EntityLink>
            </h3>
            {tournament.abbreviation ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {tournament.abbreviation}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <VerificationStatusIcon
              status={tournament.verificationStatus}
              rejectionReasons={getRejectionReasonTexts(
                'tournament',
                tournament.rejectionReason
              )}
              reviewer={tournament.verifiedByUsername}
              tooltip="tap"
            />
            <NotInRatings status={tournament.verificationStatus} />
            {tournament.isLazer ? (
              <Badge variant="outline" size="sm">
                lazer
              </Badge>
            ) : null}
            <RulesetName ruleset={tournament.ruleset} />
            <span>{formatLobbySize(tournament.lobbySize)}</span>
            <span>{formatRankRange(tournament.rankRangeLowerBound)}</span>
            <DateRangeText
              start={tournament.startTime}
              end={tournament.endTime}
            />
          </div>
        </div>

        {record ? (
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <dl className="flex items-center gap-4">
              {/* "Record", as the match pages call a won–lost pair; the
                  Matches button beside it opens the matches themselves. */}
              <RowStat label="Record">
                <span className="sr-only">{`${formatCountOf(record.won, 'win')} and ${formatCountOf(record.lost, 'loss', 'losses')}`}</span>
                <span aria-hidden="true">
                  {formatCount(record.won)}–{formatCount(record.lost)}
                </span>
              </RowStat>
              <RowStat label="Rating change">
                {tournamentAdjustments.length > 0 ? (
                  <RatingDelta value={totalRatingDelta} />
                ) : (
                  <MissingValue />
                )}
              </RowStat>
            </dl>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={isMatchesVisible}
              aria-controls={matchesId}
              aria-label={`Matches in ${tournament.name}`}
              onClick={() => setIsMatchesVisible((visible) => !visible)}
              className="gap-1"
            >
              Matches
              <ChevronDown
                aria-hidden
                className={cn(
                  'transition-transform',
                  isMatchesVisible && 'rotate-180'
                )}
              />
            </Button>
          </div>
        ) : null}
      </div>

      {/* Mounted with the Matches button for aria-controls; hidden keeps it
          out of the layout. */}
      {record ? (
        <div id={matchesId} hidden={!isMatchesVisible} className="border-t">
          {isMatchesVisible ? (
            tournamentAdjustments.length > 0 ? (
              <PlayerTournamentMatchTable
                adjustments={tournamentAdjustments}
                tournamentName={tournament.name}
              />
            ) : (
              <EmptyState
                size="compact"
                icon={Swords}
                title="No matches"
                titleAs="p"
              />
            )
          ) : null}
        </div>
      ) : null}
    </RowListItem>
  );
}
