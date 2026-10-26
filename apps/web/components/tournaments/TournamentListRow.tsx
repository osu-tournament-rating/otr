import {
  CalendarDays,
  ChevronRight,
  NotebookPen,
  Target,
  Users,
} from 'lucide-react';

import { DateRangeText } from '@/components/kit/format/DateRangeText';
import { RulesetName } from '@/components/kit/format/RulesetName';
import { RowListItem } from '@/components/kit/layout/RowList';
import { Badge } from '@/components/kit/status/Badge';
import { NotInRatings } from '@/components/kit/status/NotInRatings';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { formatDateRange } from '@/lib/kit/format/date';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatCountOf } from '@/lib/kit/format/number';
import { getRulesetLabel } from '@/lib/kit/format/ruleset';
import { getRejectionReasonTexts } from '@/lib/kit/status/reasons';
import {
  NOT_IN_RATINGS_YET_LABEL,
  getVerificationStatusName,
  isNotInRatingsYet,
} from '@/lib/kit/status/verification';
import { type TournamentListItem } from '@/lib/orpc/schema/tournament';

/**
 * The row grid, shared with the column labels and the loading rows. Phones
 * stack the name, the format and the dates; tablets put the format and the
 * dates on one line under the name; from `lg` the three are columns.
 */
export const TOURNAMENT_ROW_COLUMNS =
  'md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-6 lg:grid-cols-[minmax(0,1fr)_18rem_230px] lg:gap-5';

/** The name cell spans the tablet grid's two columns. */
export const TOURNAMENT_ROW_NAME_CELL = 'min-w-0 md:col-span-2 lg:col-span-1';

/**
 * The row link's accessible name. It replaces everything inside the row for
 * a screen reader, so it carries the row's words in the order they show
 * (name, abbreviation, "Not in ratings yet", lazer, format, dates), the
 * status icon's word before them and the admin note count after: "View
 * pre-verified tournament TimeFall Origins TF, not in ratings yet, osu!,
 * 4v4, Open rank, Jul 4 – 26, 2026". The visible words stay whole and in
 * order inside the name, so voice control finds the row by what it shows
 * (WCAG 2.5.3, label in name).
 */
export function getTournamentRowLabel(
  tournament: Pick<
    TournamentListItem,
    | 'name'
    | 'abbreviation'
    | 'verificationStatus'
    | 'isLazer'
    | 'adminNotes'
    | 'ruleset'
    | 'lobbySize'
    | 'rankRangeLowerBound'
    | 'startTime'
    | 'endTime'
  >
): string {
  const status = getVerificationStatusName(
    tournament.verificationStatus
  ).toLowerCase();
  const noteCount = tournament.adminNotes.length;

  return [
    `View ${status} tournament ${tournament.name} ${tournament.abbreviation}`.trim(),
    isNotInRatingsYet(tournament.verificationStatus) &&
      NOT_IN_RATINGS_YET_LABEL.toLowerCase(),
    tournament.isLazer && 'lazer',
    getRulesetLabel(tournament.ruleset),
    formatLobbySize(tournament.lobbySize),
    formatRankRange(tournament.rankRangeLowerBound),
    formatDateRange(tournament.startTime, tournament.endTime, { empty: '' }),
    noteCount > 0 && formatCountOf(noteCount, 'admin note'),
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * One tournament in the list. The whole row opens the tournament, as it
 * always has, so the name is plain text and the status icon's tooltip opens
 * on hover; "Not in ratings yet" says the undecided states in words.
 *
 * A tournament with admin notes shows a note icon after its abbreviation,
 * and the link's name says how many. The row is one link, so it holds no
 * preview a tap or keyboard could open; the notes open from the tournament
 * page.
 */
export default function TournamentListRow({
  tournament,
}: {
  tournament: TournamentListItem;
}) {
  const notInRatings = isNotInRatingsYet(tournament.verificationStatus);
  const noteCount = tournament.adminNotes.length;

  return (
    <RowListItem
      href={`/tournaments/${tournament.id}`}
      linkLabel={getTournamentRowLabel(tournament)}
      data-testid="tournament-list-item"
    >
      <div
        data-testid="tournament-card"
        className={`grid gap-2 ${TOURNAMENT_ROW_COLUMNS}`}
      >
        <div className={TOURNAMENT_ROW_NAME_CELL}>
          {/* Below `lg` a long name wraps rather than losing its end (often
              the year); the icon, abbreviation and note mark stay level with
              its first 24px line. From `lg` the column is wide: one line. */}
          <div className="flex min-w-0 items-start gap-2 lg:items-center">
            <span className="flex h-6 shrink-0 items-center">
              <VerificationStatusIcon
                status={tournament.verificationStatus}
                rejectionReasons={getRejectionReasonTexts(
                  'tournament',
                  tournament.rejectionReason
                )}
                reviewer={tournament.verifiedByUsername}
                pendingRating={tournament.pendingRating}
                tooltip="hover"
              />
            </span>
            <span
              data-row-title
              title={tournament.name}
              className="min-w-0 text-base font-medium break-words lg:truncate"
            >
              {tournament.name}
            </span>
            <span
              data-testid="tournament-abbreviation"
              className="flex h-6 shrink-0 items-center text-xs text-muted-foreground"
            >
              {tournament.abbreviation}
            </span>
            <span
              data-testid="tournament-admin-note-slot"
              className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center lg:mt-0"
            >
              {noteCount > 0 && (
                <NotebookPen
                  data-testid="tournament-admin-notes-marker"
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </span>
          </div>
          {(notInRatings || tournament.isLazer) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 pl-6">
              <NotInRatings status={tournament.verificationStatus} />
              {tournament.isLazer && (
                <Badge variant="outline" size="sm">
                  lazer
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-sm text-muted-foreground lg:pl-0">
          <RulesetName ruleset={tournament.ruleset} className="lg:w-24" />
          <span className="inline-flex shrink-0 items-center gap-1.5 lg:w-12">
            <Users className="size-4 shrink-0" aria-hidden="true" />
            {formatLobbySize(tournament.lobbySize)}
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Target className="size-4 shrink-0" aria-hidden="true" />
            {formatRankRange(tournament.rankRangeLowerBound)}
          </span>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-3 pl-6 text-sm text-muted-foreground md:justify-end md:pl-0">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
            <DateRangeText
              start={tournament.startTime}
              end={tournament.endTime}
            />
          </span>
          <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
        </div>
      </div>
    </RowListItem>
  );
}
