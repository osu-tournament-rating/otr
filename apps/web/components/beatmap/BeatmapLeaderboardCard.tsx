import { Medal } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type * as React from 'react';

import { NotEnoughData } from '@/components/beatmap/BeatmapSection';
import ModIconset from '@/components/icons/ModIconset';
import { DateText } from '@/components/kit/format/DateText';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import { ScoreGradeEnumHelper } from '@/lib/enum-helpers';
import {
  formatAccuracy,
  formatCount,
  formatCountOf,
  formatRank,
} from '@/lib/kit/format/number';
import type { BeatmapTopPerformer } from '@/lib/orpc/schema/beatmapStats';
import { cn } from '@/lib/utils';

type DisplayRank = {
  /** Rendered numeral, prefixed with `=` when the position is shared. */
  label: string;
  /** Competition position; ties share it. */
  position: number;
};

/**
 * Competition ranks in the site's rank format, with tie flags:
 * …, #6, =#7, =#7, =#7, #10, …
 */
function computeDisplayRanks(performers: BeatmapTopPerformer[]): DisplayRank[] {
  return performers.map((performer, index) => {
    let start = index;
    while (start > 0 && performers[start - 1].score === performer.score)
      start -= 1;
    const tied =
      (index > 0 && performers[index - 1].score === performer.score) ||
      (index + 1 < performers.length &&
        performers[index + 1].score === performer.score);
    return {
      label: `${tied ? '=' : ''}${formatRank(start + 1)}`,
      position: start + 1,
    };
  });
}

/** The podium reads heavier; colour is not needed for it. */
function rankClassName(rank: DisplayRank) {
  return rank.position === 1
    ? 'font-semibold text-foreground'
    : rank.position <= 3
      ? 'font-medium text-foreground'
      : 'text-muted-foreground';
}

const linkClassName =
  'rounded-sm transition-colors outline-none hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50';

const playerHref = (performer: BeatmapTopPerformer) =>
  `/players/${performer.player.id}`;

function PlayerAvatar({
  performer,
  size,
}: {
  performer: BeatmapTopPerformer;
  size: number;
}) {
  return (
    <OsuAvatar
      osuId={performer.player.osuId}
      username={performer.player.username}
      size={size}
    />
  );
}

/**
 * The player's name as a link. The table passes the avatar as `leading`, so
 * it sits inside the link; a phone row shows it in its own column instead.
 */
function PlayerLink({
  performer,
  leading,
}: {
  performer: BeatmapTopPerformer;
  leading?: React.ReactNode;
}) {
  const displayName = (performer.player.username ?? '').trim();

  return (
    <EntityLink
      href={playerHref(performer)}
      leading={leading}
      className={cn(!displayName && 'font-normal text-muted-foreground')}
    >
      {displayName || 'Unknown player'}
    </EntityLink>
  );
}

function ScoreLink({
  performer,
  testId,
  className,
}: {
  performer: BeatmapTopPerformer;
  testId?: string;
  className?: string;
}) {
  const displayName = (performer.player.username ?? '').trim();

  return (
    <Link
      href={`/matches/${performer.matchId}?scoreId=${performer.scoreId}`}
      prefetch={false}
      // Starts with the score it shows, so voice control finds the link by
      // what it says (WCAG 2.5.3, label in name).
      aria-label={`${formatCount(performer.score)}: view ${displayName || 'Unknown player'}'s recorded score`}
      data-testid={testId}
      className={cn(
        'inline-flex items-center justify-end gap-1.5 font-semibold tabular-nums',
        linkClassName,
        className
      )}
    >
      {formatCount(performer.score)}
      <GradeIcon grade={performer.grade} />
    </Link>
  );
}

/** The highest verified scores recorded on a beatmap, ranked. */
export default function BeatmapLeaderboardCard({
  performers,
  totalScoreCount,
}: {
  performers: BeatmapTopPerformer[];
  /** Every verified score on the beatmap, not just the ranked slice below. */
  totalScoreCount: number;
}) {
  const ranks = computeDisplayRanks(performers);

  return (
    <Panel data-testid="beatmap-leaderboard">
      <SectionHeader
        icon={Medal}
        title="Leaderboard"
        meta={
          performers.length < totalScoreCount
            ? `Top ${formatCount(performers.length)} of ${formatCountOf(totalScoreCount, 'score')}`
            : formatCountOf(totalScoreCount, 'score')
        }
      />

      {performers.length === 0 ? (
        <NotEnoughData />
      ) : (
        <DataTable
          fixed
          stickyHeader
          aria-label="Beatmap leaderboard"
          phoneRows={
            <PhoneRowList as="ol" aria-label="Beatmap leaderboard">
              {performers.map((performer, index) => (
                <PhoneRow
                  key={performer.scoreId}
                  rank={
                    <span className={rankClassName(ranks[index])}>
                      {ranks[index].label}
                    </span>
                  }
                  leading={<PlayerAvatar performer={performer} size={32} />}
                  leadingHref={playerHref(performer)}
                  title={<PlayerLink performer={performer} />}
                  description={
                    <span className="flex min-w-0 items-center gap-2">
                      <ModIconset
                        mods={performer.mods}
                        className="flex h-4 shrink-0 items-center"
                        iconClassName="h-4"
                      />
                      <span className="shrink-0 tabular-nums">
                        {performer.accuracy !== null
                          ? formatAccuracy(performer.accuracy)
                          : null}
                      </span>
                    </span>
                  }
                  value={<ScoreLink performer={performer} />}
                  valueDescription={<DateText date={performer.playedAt} />}
                >
                  {/* A line of its own, so the name gets the body's width. */}
                  <Link
                    href={`/tournaments/${performer.tournament.id}`}
                    prefetch={false}
                    className={cn(
                      'mt-0.5 block w-fit max-w-full truncate text-xs text-muted-foreground',
                      linkClassName
                    )}
                  >
                    {performer.tournament.name}
                  </Link>
                </PhoneRow>
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead className="w-16">Rank</DataTableHead>
              <DataTableHead>Player</DataTableHead>
              <DataTableHead className="w-36">Mods</DataTableHead>
              <DataTableHead numeric className="w-29">
                Score
              </DataTableHead>
              <DataTableHead numeric className="w-20">
                Accuracy
              </DataTableHead>
              <DataTableHead>Tournament</DataTableHead>
              <DataTableHead align="end" className="w-28">
                Played
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {performers.map((performer, index) => (
              <DataTableRow key={performer.scoreId}>
                <DataTableCell
                  className={cn('tabular-nums', rankClassName(ranks[index]))}
                >
                  {ranks[index].label}
                </DataTableCell>
                <DataTableCell>
                  <PlayerLink
                    performer={performer}
                    leading={<PlayerAvatar performer={performer} size={24} />}
                  />
                </DataTableCell>
                <DataTableCell empty={false}>
                  <div
                    data-testid="beatmap-top-play-mods"
                    className="flex h-5 items-center"
                  >
                    <ModIconset
                      mods={performer.mods}
                      className="flex h-full items-center"
                      iconClassName="h-5"
                    />
                  </div>
                </DataTableCell>
                <DataTableCell numeric>
                  <ScoreLink
                    performer={performer}
                    testId="beatmap-top-play-score"
                    // Fills the cell, so every score lines up on the right.
                    className="flex"
                  />
                </DataTableCell>
                <DataTableCell
                  numeric
                  muted
                  data-testid="beatmap-top-play-accuracy"
                >
                  {performer.accuracy !== null
                    ? formatAccuracy(performer.accuracy)
                    : null}
                </DataTableCell>
                <DataTableCell>
                  <Link
                    href={`/tournaments/${performer.tournament.id}`}
                    prefetch={false}
                    title={performer.tournament.name}
                    data-testid="beatmap-top-play-tournament"
                    className={cn('block truncate text-xs', linkClassName)}
                  >
                    {performer.tournament.name}
                  </Link>
                </DataTableCell>
                <DataTableCell
                  align="end"
                  muted
                  data-testid="beatmap-top-play-date"
                >
                  <DateText date={performer.playedAt} />
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </Panel>
  );
}

function GradeIcon({ grade }: { grade: BeatmapTopPerformer['grade'] }) {
  if (grade === undefined) {
    return <MissingValue label="Grade unavailable" />;
  }

  const gradeName = ScoreGradeEnumHelper.getMetadata(grade).text;

  return (
    <Image
      src={`/icons/grades/${gradeName}.svg`}
      alt={`Grade ${gradeName}`}
      width={24}
      height={24}
      className="size-5"
    />
  );
}
