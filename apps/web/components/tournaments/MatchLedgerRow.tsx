'use client';

import { Team, VerificationStatus } from '@otr/core/osu';
import { NotebookPen } from 'lucide-react';
import Link from 'next/link';

import { Timestamp } from '@/components/kit/format/Timestamp';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import TapTooltip from '@/components/tap-tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { getTeamTextColor, getTeamTintClass } from '@/lib/kit/color/teams';
import { EMPTY_VALUE } from '@/lib/kit/format/empty';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import {
  getRejectionReasonTexts,
  getWarningTexts,
} from '@/lib/kit/status/reasons';
import { cn } from '@/lib/utils';

import { parseTeamNames, type MatchRow } from './matchRow';

/** Why a match shows no result: a rejected one never gets one. */
function getMissingResultText(status: VerificationStatus) {
  switch (status) {
    case VerificationStatus.Verified:
      return 'No result yet, awaiting stats';
    case VerificationStatus.Rejected:
      return 'No result, match rejected';
    default:
      return 'No result yet, awaiting verification';
  }
}

/**
 * The points each side won, tinted with the winning team's colour. Only a
 * missing result and a draw explain themselves on tap; a score says enough.
 */
function Scoreline({ match }: { match: MatchRow }) {
  const winRecord = match.winRecord;

  if (!winRecord) {
    const explanation = getMissingResultText(match.status.verificationStatus);

    return (
      <TapTooltip
        content={explanation}
        side="top"
        triggerAriaLabel={explanation}
        triggerClassName="w-14 shrink-0 text-center text-sm text-muted-foreground"
      >
        {EMPTY_VALUE}
      </TapTooltip>
    );
  }

  const winner =
    !winRecord.isTied &&
    (winRecord.winnerTeam === Team.Red || winRecord.winnerTeam === Team.Blue)
      ? winRecord.winnerTeam
      : null;
  const score = `${formatCount(winRecord.winnerPoints)}–${formatCount(winRecord.loserPoints)}`;
  const pill = (
    <span
      className={cn(
        'block rounded-md py-0.5 text-center text-sm font-semibold tabular-nums',
        winner === null
          ? 'bg-muted text-muted-foreground'
          : getTeamTintClass(winner)
      )}
      style={winner === null ? undefined : { color: getTeamTextColor(winner) }}
    >
      {score}
    </span>
  );

  if (!winRecord.isTied) {
    return <span className="w-14 shrink-0">{pill}</span>;
  }

  const explanation = 'Draw, some games may not be counted';

  return (
    <TapTooltip
      content={explanation}
      side="top"
      triggerAriaLabel={`Result ${score}. ${explanation}`}
      triggerClassName="w-14 shrink-0"
    >
      {pill}
    </TapTooltip>
  );
}

// Below `lg` the title has a phone's width beside the result: the names
// wrap instead of both truncating; from `lg` they share one line.
const TEAM_NAME_CLASSES = 'min-w-0 break-words lg:truncate';

/** The match name; with two teams, the winner first and the loser muted. */
function MatchTitle({ match }: { match: MatchRow }) {
  const name = match.name || `Match ${match.id}`;
  const teams = parseTeamNames(match.name);

  const content = (() => {
    if (!teams) return <span className={TEAM_NAME_CLASSES}>{name}</span>;

    const winRecord = match.winRecord;
    const decided =
      winRecord !== null &&
      !winRecord.isTied &&
      (winRecord.winnerTeam === Team.Red || winRecord.winnerTeam === Team.Blue);
    const blueWon = decided && winRecord.winnerTeam === Team.Blue;

    return (
      <>
        <span className={TEAM_NAME_CLASSES}>
          {blueWon ? teams.blue : teams.red}
        </span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
          vs
        </span>
        <span
          className={cn(
            TEAM_NAME_CLASSES,
            decided && 'font-normal text-muted-foreground'
          )}
        >
          {blueWon ? teams.red : teams.blue}
        </span>
      </>
    );
  })();

  return (
    <Link
      href={`/matches/${match.id}`}
      prefetch={false}
      title={name}
      className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 rounded-sm font-medium text-foreground transition-colors outline-none hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:flex-nowrap"
    >
      {content}
    </Link>
  );
}

/** The admin notes on the match and its games, opened on tap. */
function Notes({ match }: { match: MatchRow }) {
  const notes = [
    ...match.matchAdminNotes,
    ...match.games.flatMap((game) => game.adminNotes),
  ];

  if (notes.length === 0) {
    return null;
  }

  return (
    <TapTooltip
      side="top"
      triggerAriaLabel={`${formatCountOf(notes.length, 'admin note')} on ${match.name || `match ${match.id}`}`}
      triggerClassName="inline-flex w-auto shrink-0 self-center"
      content={
        <ul className="max-w-xs space-y-1 text-xs">
          {notes.map((note, index) => (
            <li key={index}>
              {note.note}
              <span className="text-muted-foreground">
                {' '}
                — {note.adminUsername}
              </span>
            </li>
          ))}
        </ul>
      }
    >
      <NotebookPen
        className="size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
    </TapTooltip>
  );
}

function GamePips({ games }: { games: MatchRow['games'] }) {
  if (games.length === 0) {
    // Phones already say "0 games" on the line above; the column needs a mark.
    return <MissingValue label="No games" className="hidden lg:inline" />;
  }

  return (
    // 8px apart, so each 16px icon keeps a 24px tap area.
    <ul aria-label="Games" className="flex flex-wrap items-center gap-2">
      {games.map((game, index) => (
        <li key={game.id} className="inline-flex">
          <VerificationStatusIcon
            status={game.verificationStatus}
            warnings={getWarningTexts('game', game.warningFlags)}
            rejectionReasons={getRejectionReasonTexts(
              'game',
              game.rejectionReason
            )}
            context={`Game ${index + 1}`}
            tooltip="tap"
          />
        </li>
      ))}
    </ul>
  );
}

interface MatchLedgerRowProps {
  match: MatchRow;
  isSelected: boolean;
  onSelect?: (matchId: number, checked: boolean) => void;
}

/**
 * One match: its result, name, status, game statuses and start time. Only
 * the name links to the match, so the row has no hover tint. On phones the
 * games and time move to a second line.
 */
export default function MatchLedgerRow({
  match,
  isSelected,
  onSelect,
}: MatchLedgerRowProps) {
  const games = [...match.games].sort((a, b) => {
    const startA = a.startTime ? new Date(a.startTime).getTime() : 0;
    const startB = b.startTime ? new Date(b.startTime).getTime() : 0;
    return startA - startB;
  });

  return (
    <li
      data-testid="tournament-match-row"
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm lg:grid-cols-[auto_minmax(0,1fr)_auto_24rem_10rem]',
        isSelected && 'bg-primary/5'
      )}
    >
      <div className="flex items-center gap-3">
        {onSelect && (
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect(match.id, checked === true)}
            aria-label={`Select ${match.name || `match ${match.id}`}`}
          />
        )}
        <Scoreline match={match} />
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <MatchTitle match={match} />
        <Notes match={match} />
      </div>

      <VerificationStatusIcon
        status={match.status.verificationStatus}
        warnings={getWarningTexts('match', match.status.warningFlags)}
        rejectionReasons={getRejectionReasonTexts(
          'match',
          match.status.rejectionReason
        )}
        reviewer={match.status.verifiedByUsername ?? undefined}
        context={match.name || `Match ${match.id}`}
        tooltip="tap"
      />

      <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 lg:col-span-1 lg:col-start-auto lg:self-stretch lg:border-l lg:pl-3">
        <span className="text-xs text-muted-foreground lg:hidden">
          {match.startDate ? (
            <>
              <Timestamp date={match.startDate} />
              {' · '}
            </>
          ) : null}
          {formatCountOf(match.games.length, 'game')}
        </span>
        <GamePips games={games} />
      </div>

      <Timestamp
        date={match.startDate}
        className="hidden text-right text-xs text-muted-foreground lg:block"
      />
    </li>
  );
}
