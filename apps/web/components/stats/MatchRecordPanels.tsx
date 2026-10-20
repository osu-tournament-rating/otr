'use client';

import { RECENT_MONTHS } from '@otr/core/platform-stats/constants';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { typeScale } from '@/components/kit/layout/Typography';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import {
  formatCount,
  formatCountOf,
  formatRating,
} from '@/lib/kit/format/number';
import type {
  ClosestGameData,
  MatchRecordData,
} from '@/lib/orpc/schema/statsPage';
import { cn } from '@/lib/utils';

import { STATS_PANELS, type StatsPanelCopy } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';
import { useRulesetStats } from './ruleset-stats';
import { getMatchSides } from './stats-data';

const IN_WINDOW = `in the last ${RECENT_MONTHS} months`;

/** A muted link in a row's detail line, such as the tournament. */
function DetailLink({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <EntityLink
      href={href}
      title={title}
      className="font-normal text-muted-foreground"
    >
      {children}
    </EntityLink>
  );
}

/** The two sides as one link to the match: the winner, then the loser muted. */
function MatchSidesLink({ match }: { match: MatchRecordData }) {
  const href = `/matches/${match.matchId}`;
  const sides = getMatchSides(match);

  if (!sides) {
    const name = match.matchName || `Match ${match.matchId}`;
    return (
      <EntityLink href={href} title={name}>
        {name}
      </EntityLink>
    );
  }

  return (
    <EntityLink href={href} title={`${sides.winner} vs ${sides.loser}`}>
      {sides.winner}
      <span className="font-normal text-muted-foreground">
        {' '}
        vs {sides.loser}
      </span>
    </EntityLink>
  );
}

/**
 * One listed match: its sides, its tournament, and on the right the score
 * with the figure the list ranks by under it.
 */
function MatchRecordRow({
  match,
  detail,
  children,
}: {
  match: MatchRecordData;
  /** The figure the list ranks by, such as `Trailed by 5 maps`. */
  detail: string;
  /** Lines under the tournament. */
  children?: ReactNode;
}) {
  return (
    <RowListItem
      title={<MatchSidesLink match={match} />}
      description={
        <DetailLink
          href={`/tournaments/${match.tournamentId}`}
          title={match.tournamentName}
        >
          {match.tournamentName}
        </DetailLink>
      }
      trailing={
        <span className="flex flex-col items-end">
          <span className="font-semibold tabular-nums">
            {formatCount(match.winnerScore)}–{formatCount(match.loserScore)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {detail}
          </span>
        </span>
      }
    >
      {children}
    </RowListItem>
  );
}

/**
 * A list of matches of the last 12 months, ranked by one figure. Its meta
 * counts every match that qualified, so the five shown read as the top of
 * a larger set.
 */
function MatchRecordPanel<TItem extends MatchRecordData>({
  copy,
  testId,
  data,
  noun,
  emptyTitle,
  renderRow,
}: {
  copy: StatsPanelCopy;
  testId: string;
  data: { total: number; items: readonly TItem[] } | null;
  /** What `total` counts, in the singular, such as `upset`. */
  noun: string;
  emptyTitle: string;
  renderRow: (item: TItem) => ReactNode;
}) {
  return (
    <Panel data-testid={testId}>
      <SectionHeader
        {...copy}
        level={3}
        meta={
          data && data.total > 0
            ? `${formatCountOf(data.total, noun)} ${IN_WINDOW}`
            : undefined
        }
      />
      {data === null ? (
        <NotCalculatedYet icon={copy.icon} />
      ) : data.items.length === 0 ? (
        <EmptyState size="compact" icon={copy.icon} title={emptyTitle} />
      ) : (
        <RowList aria-label={copy.title}>{data.items.map(renderRow)}</RowList>
      )}
    </Panel>
  );
}

/** Matches of the last 12 months the lower-rated side won, widest gap first. */
export function BiggestUpsetsPanel() {
  const { stats } = useRulesetStats();
  const data = stats?.biggestUpsets ?? null;

  return (
    <MatchRecordPanel
      copy={STATS_PANELS.biggestUpsets}
      testId="biggest-upsets"
      data={data && { total: data.total, items: data.matches }}
      noun="upset"
      emptyTitle={`No upsets ${IN_WINDOW}`}
      renderRow={(match) => (
        <MatchRecordRow
          key={match.matchId}
          match={match}
          detail={`Rated ${formatRating(match.winnerRating)} vs ${formatRating(match.loserRating)}`}
        />
      )}
    />
  );
}

/** `Title [Difficulty]`, or the difficulty alone when no title is known. */
function beatmapName(beatmap: NonNullable<ClosestGameData['beatmap']>) {
  return beatmap.title
    ? `${beatmap.title} [${beatmap.diffName}]`
    : `[${beatmap.diffName}]`;
}

/** Tiebreakers of the last 12 months won by the fewest points. */
export function ClosestGamesPanel() {
  const { stats } = useRulesetStats();
  const data = stats?.closestGames ?? null;

  return (
    <MatchRecordPanel
      copy={STATS_PANELS.closestGames}
      testId="closest-games"
      data={data && { total: data.total, items: data.games }}
      noun="tiebreaker"
      emptyTitle={`No tiebreakers ${IN_WINDOW}`}
      renderRow={(game) => (
        <MatchRecordRow
          key={game.matchId}
          match={game}
          detail={`Won by ${formatCount(game.margin)}`}
        >
          {game.beatmap ? (
            <div className={cn('mt-1.5 flex min-w-0', typeScale.bodyMuted)}>
              <DetailLink
                href={`/beatmaps/${game.beatmap.osuId}`}
                title={
                  game.beatmap.artist
                    ? `${game.beatmap.artist} - ${beatmapName(game.beatmap)}`
                    : beatmapName(game.beatmap)
                }
              >
                {beatmapName(game.beatmap)}
              </DetailLink>
            </div>
          ) : null}
        </MatchRecordRow>
      )}
    />
  );
}
