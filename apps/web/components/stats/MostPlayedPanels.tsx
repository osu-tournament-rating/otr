'use client';

import {
  MOST_PLAYED_MIN_TOURNAMENTS,
  RECENT_MONTHS,
} from '@otr/core/platform-stats/constants';
import type { Ruleset } from '@otr/core/osu';
import Link from 'next/link';
import type { ReactNode } from 'react';

import StarRatingPill from '@/components/beatmaps/StarRatingPill';
import { Button } from '@/components/kit/controls/Button';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import {
  BEATMAP_LIST_PARAMS,
  beatmapListHref,
} from '@/lib/beatmaps/list-params';
import { formatCountOf } from '@/lib/kit/format/number';
import { getDefaultListState } from '@/lib/kit/lists/params';
import type { MostPlayedBeatmapData } from '@/lib/orpc/schema/statsPage';

import { STATS_PANELS, type StatsPanelCopy } from './chart-panels';
import { NotCalculatedYet } from './NotCalculatedYet';
import { useRulesetStats } from './ruleset-stats';

const IN_WINDOW = `in the last ${RECENT_MONTHS} months`;

/**
 * The beatmap list in one ruleset, sorted by the tournaments that played
 * each beatmap, optionally searched.
 */
function beatmapsByTournamentsHref(ruleset: Ruleset, q = ''): string {
  return beatmapListHref(
    {
      ...getDefaultListState(BEATMAP_LIST_PARAMS),
      q,
      ruleset: [ruleset],
      sort: { key: 'tournamentCount', direction: 'desc' },
    },
    1
  );
}

/** The figure a row ranks by, over the second figure, right-aligned. */
function RankedFigures({ main, sub }: { main: string; sub: string }) {
  return (
    <span className="flex flex-col items-end">
      <span className="font-semibold whitespace-nowrap tabular-nums">
        {main}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {sub}
      </span>
    </span>
  );
}

/**
 * A ranked list of the last 12 months. Its meta counts everything played,
 * so the rows shown read as the top of a larger set.
 */
function MostPlayedPanel<TItem>({
  copy,
  testId,
  data,
  noun,
  emptyTitle,
  emptyAction,
  renderRow,
}: {
  copy: StatsPanelCopy;
  testId: string;
  data: { total: number; items: readonly TItem[] } | null;
  /** What `total` counts, in the singular, such as `beatmap`. */
  noun: string;
  emptyTitle: string;
  emptyAction?: ReactNode;
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
        <EmptyState
          size="compact"
          icon={copy.icon}
          title={emptyTitle}
          action={emptyAction}
        />
      ) : (
        <RowList aria-label={copy.title}>{data.items.map(renderRow)}</RowList>
      )}
    </Panel>
  );
}

/** `Title [Difficulty]`, or the difficulty alone when no title is known. */
function beatmapName(beatmap: MostPlayedBeatmapData) {
  return beatmap.title
    ? `${beatmap.title} [${beatmap.diffName}]`
    : `[${beatmap.diffName}]`;
}

/** The beatmaps the most verified tournaments in the page's ruleset played lately. */
export function MostPlayedBeatmapsPanel() {
  const { ruleset, stats } = useRulesetStats();
  const data = stats?.mostPlayedBeatmaps ?? null;

  return (
    <MostPlayedPanel
      copy={STATS_PANELS.mostPlayedBeatmaps}
      testId="most-played-beatmaps"
      data={data && { total: data.total, items: data.beatmaps }}
      noun="beatmap"
      emptyTitle={`No beatmap was played in ${MOST_PLAYED_MIN_TOURNAMENTS}+ tournaments ${IN_WINDOW}`}
      emptyAction={
        <Button asChild variant="outline" size="sm">
          <Link href={beatmapsByTournamentsHref(ruleset)} prefetch={false}>
            Most played of all time
          </Link>
        </Button>
      }
      renderRow={(beatmap) => {
        const name = beatmapName(beatmap);
        return (
          <RowListItem
            key={beatmap.osuId}
            title={
              <EntityLink
                href={`/beatmaps/${beatmap.osuId}`}
                title={beatmap.artist ? `${beatmap.artist} - ${name}` : name}
              >
                {name}
              </EntityLink>
            }
            description={
              <span className="flex min-w-0 items-center gap-2">
                {beatmap.starRating > 0 ? (
                  <StarRatingPill starRating={beatmap.starRating} />
                ) : null}
                <span className="truncate">{beatmap.artist ?? ''}</span>
              </span>
            }
            trailing={
              <RankedFigures
                main={formatCountOf(beatmap.tournaments, 'tournament')}
                sub={formatCountOf(beatmap.games, 'game')}
              />
            }
          />
        );
      }}
    />
  );
}

/** The mappers whose beatmaps the most tournaments played lately. */
export function MostPlayedMappersPanel() {
  const { stats } = useRulesetStats();
  const data = stats?.mostPlayedMappers ?? null;

  return (
    <MostPlayedPanel
      copy={STATS_PANELS.mostPlayedMappers}
      testId="most-played-mappers"
      data={data && { total: data.total, items: data.mappers }}
      noun="mapper"
      emptyTitle={`No mapper was played in ${MOST_PLAYED_MIN_TOURNAMENTS}+ tournaments ${IN_WINDOW}`}
      renderRow={(mapper) => (
        <RowListItem
          key={mapper.playerId}
          leading={
            <OsuAvatar
              osuId={mapper.osuId}
              username={mapper.username}
              size={32}
            />
          }
          title={
            <EntityLink
              href={`/players/${mapper.playerId}`}
              title={mapper.username}
            >
              {mapper.username}
            </EntityLink>
          }
          trailing={
            <RankedFigures
              main={formatCountOf(mapper.tournaments, 'tournament')}
              sub={formatCountOf(mapper.beatmaps, 'beatmap')}
            />
          }
        />
      )}
    />
  );
}

/** The artists whose songs the most tournaments played lately. */
export function MostPlayedArtistsPanel() {
  const { ruleset, stats } = useRulesetStats();
  const data = stats?.mostPlayedArtists ?? null;

  return (
    <MostPlayedPanel
      copy={STATS_PANELS.mostPlayedArtists}
      testId="most-played-artists"
      data={data && { total: data.total, items: data.artists }}
      noun="artist"
      emptyTitle={`No artist was played in ${MOST_PLAYED_MIN_TOURNAMENTS}+ tournaments ${IN_WINDOW}`}
      renderRow={(artist) => (
        <RowListItem
          key={artist.artist}
          title={
            <EntityLink
              href={beatmapsByTournamentsHref(ruleset, artist.artist)}
              title={artist.artist}
            >
              {artist.artist}
            </EntityLink>
          }
          trailing={
            <RankedFigures
              main={formatCountOf(artist.tournaments, 'tournament')}
              sub={formatCountOf(artist.beatmaps, 'beatmap')}
            />
          }
        />
      )}
    />
  );
}
