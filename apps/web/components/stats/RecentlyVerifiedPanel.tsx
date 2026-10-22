'use client';

import useSWRInfinite from 'swr/infinite';

import SectionError from '@/components/error/SectionError';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { RelativeTime } from '@/components/kit/format/RelativeTime';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { Badge } from '@/components/kit/status/Badge';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { LoadMore } from '@/components/kit/tables/LoadMore';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { getRulesetLabel } from '@/lib/kit/format/ruleset';
import { orpc } from '@/lib/orpc/orpc';
import type {
  RecentlyVerifiedPageData,
  RecentlyVerifiedTournamentData,
} from '@/lib/orpc/schema/statsPage';

import { STATS_PANELS } from './chart-panels';

/** Tournaments each "Load more" adds. */
const LOAD_MORE_BATCH = 10;

type PageKey = readonly [
  'stats-recently-verified',
  RecentlyVerifiedPageData['nextCursor'],
];

function RecentlyVerifiedRow({
  tournament,
}: {
  tournament: RecentlyVerifiedTournamentData;
}) {
  return (
    <RowListItem
      data-testid="recently-verified-tournament"
      title={
        <EntityLink
          href={`/tournaments/${tournament.id}`}
          title={tournament.name}
        >
          {tournament.name}
        </EntityLink>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-1.5">
          {[
            getRulesetLabel(tournament.ruleset),
            formatLobbySize(tournament.lobbySize),
            formatRankRange(tournament.rankRangeLowerBound),
          ].join(' · ')}
          {tournament.isLazer ? (
            <Badge variant="outline" size="sm">
              lazer
            </Badge>
          ) : null}
        </span>
      }
      trailing={
        <RelativeTime
          date={tournament.verifiedAt}
          className="text-sm text-muted-foreground"
        />
      }
    />
  );
}

/**
 * Verified tournaments, most recently verified first: the server's first
 * page, then more on request.
 */
export default function RecentlyVerifiedPanel({
  firstPage,
}: {
  firstPage: RecentlyVerifiedPageData;
}) {
  const { data, error, mutate, size, setSize, isValidating } = useSWRInfinite(
    (
      index: number,
      previous: RecentlyVerifiedPageData | null
    ): PageKey | null => {
      if (index === 0) return ['stats-recently-verified', null];
      return previous?.nextCursor
        ? ['stats-recently-verified', previous.nextCursor]
        : null;
    },
    ([, cursor]: PageKey) =>
      cursor
        ? orpc.stats.recentlyVerified({ cursor, limit: LOAD_MORE_BATCH })
        : Promise.resolve(firstPage),
    {
      fallbackData: [firstPage],
      revalidateFirstPage: false,
      revalidateOnMount: false,
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
    }
  );

  const pages = data ?? [firstPage];
  const tournaments = pages.flatMap((page) => page.items);
  const hasMore = pages.at(-1)?.nextCursor != null;

  return (
    <Panel data-testid="recently-verified">
      <SectionHeader {...STATS_PANELS.recentlyVerified} />
      {tournaments.length === 0 ? (
        <EmptyState
          size="compact"
          icon={STATS_PANELS.recentlyVerified.icon}
          title="No verified tournaments yet"
        />
      ) : (
        <>
          <RowList aria-label="Recently verified tournaments">
            {tournaments.map((tournament) => (
              <RecentlyVerifiedRow
                key={tournament.id}
                tournament={tournament}
              />
            ))}
          </RowList>
          {/* A failed "Load more" keeps the tournaments already showing. */}
          {error ? (
            <div className="border-t px-4 py-4">
              <SectionError
                size="inline"
                title="More tournaments could not load"
                retrying={isValidating}
                onRetry={() => void mutate()}
                className="justify-center"
              />
            </div>
          ) : (
            <LoadMore
              hasMore={hasMore}
              loading={isValidating && size > pages.length}
              shownCount={tournaments.length}
              totalCount={firstPage.totalCount}
              pageSize={firstPage.items.length}
              onLoadMore={() => void setSize(size + 1)}
            />
          )}
        </>
      )}
    </Panel>
  );
}
