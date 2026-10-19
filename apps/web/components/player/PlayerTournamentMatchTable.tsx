import { DateText } from '@/components/kit/format/DateText';
import { RatingDelta } from '@/components/kit/format/RatingDelta';
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
import { formatDate } from '@/lib/kit/format/date';
import { formatRating } from '@/lib/kit/format/number';
import type { PlayerRatingAdjustment } from '@/lib/orpc/schema/playerStats';

const GAMES_INFO = 'Only games this player played in';

/** `2–1`, or null when the record is unknown. */
function formatGames(adjustment: PlayerRatingAdjustment): string | null {
  return adjustment.gamesWon != null && adjustment.gamesLost != null
    ? `${adjustment.gamesWon}–${adjustment.gamesLost}`
    : null;
}

function MatchName({ adjustment }: { adjustment: PlayerRatingAdjustment }) {
  return adjustment.match ? (
    <EntityLink
      href={`/matches/${adjustment.match.id}`}
      title={adjustment.match.name}
    >
      {adjustment.match.name}
    </EntityLink>
  ) : (
    <span className="text-muted-foreground">Match not found</span>
  );
}

/**
 * One tournament's matches for this player, newest first: the games record
 * and the rating before, after and the change. On phones each match becomes
 * a row that keeps the new rating and the change in view.
 */
export default function PlayerTournamentMatchTable({
  adjustments,
  tournamentName,
}: {
  adjustments: PlayerRatingAdjustment[];
  tournamentName: string;
}) {
  const sorted = [...adjustments].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const label = `Matches in ${tournamentName}`;

  return (
    <DataTable
      fixed
      aria-label={label}
      phoneRows={
        <PhoneRowList aria-label={label}>
          {sorted.map((adjustment, index) => {
            const games = formatGames(adjustment);

            return (
              <PhoneRow
                key={`${adjustment.match?.id}-${index}`}
                title={<MatchName adjustment={adjustment} />}
                description={[
                  formatDate(adjustment.timestamp),
                  games ? `Games ${games}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                value={formatRating(adjustment.ratingAfter)}
                valueDescription={
                  <RatingDelta value={adjustment.ratingDelta} />
                }
              />
            );
          })}
        </PhoneRowList>
      }
    >
      <DataTableHeader>
        <DataTableRow>
          <DataTableHead className="w-32">Date</DataTableHead>
          <DataTableHead>Match</DataTableHead>
          <DataTableHead
            numeric
            className="w-32"
            info={GAMES_INFO}
            infoLabel="About games won and lost"
          >
            Games (W–L)
          </DataTableHead>
          <DataTableHead numeric className="w-20">
            Before
          </DataTableHead>
          <DataTableHead numeric className="w-20">
            After
          </DataTableHead>
          <DataTableHead numeric className="w-24">
            Change
          </DataTableHead>
        </DataTableRow>
      </DataTableHeader>
      <DataTableBody>
        {sorted.map((adjustment, index) => (
          <DataTableRow key={`${adjustment.match?.id}-${index}`}>
            <DataTableCell muted>
              <DateText date={adjustment.timestamp} />
            </DataTableCell>
            <DataTableCell>
              <MatchName adjustment={adjustment} />
            </DataTableCell>
            <DataTableCell numeric>{formatGames(adjustment)}</DataTableCell>
            <DataTableCell numeric className="text-muted-foreground">
              {formatRating(adjustment.ratingBefore)}
            </DataTableCell>
            <DataTableCell numeric className="font-medium">
              {formatRating(adjustment.ratingAfter)}
            </DataTableCell>
            <DataTableCell numeric>
              <RatingDelta value={adjustment.ratingDelta} />
            </DataTableCell>
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  );
}
