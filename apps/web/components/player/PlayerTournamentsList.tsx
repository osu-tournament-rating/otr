'use client';

import { Trophy } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel } from '@/components/kit/layout/Panel';
import { RowList } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { LoadMore } from '@/components/kit/tables/LoadMore';
import { formatCountOf } from '@/lib/kit/format/number';
import type { PlayerRatingAdjustment } from '@/lib/orpc/schema/playerStats';
import type { PlayerTournamentHistoryItem } from '@/lib/orpc/schema/tournament';

import PlayerTournamentCard from './PlayerTournamentCard';

const INITIAL_COUNT = 5;
const LOAD_MORE_COUNT = 25;

/**
 * A player's tournaments as divided rows, five at first, with "Show more"
 * revealing the rest 25 at a time. Rows with a record expand their matches.
 */
export default function PlayerTournamentsList({
  tournaments,
  adjustments,
}: {
  tournaments: PlayerTournamentHistoryItem[];
  adjustments: PlayerRatingAdjustment[];
}) {
  const [displayCount, setDisplayCount] = useState(INITIAL_COUNT);
  const shownCount = Math.min(displayCount, tournaments.length);

  return (
    <Panel>
      <SectionHeader
        data-testid="tournament-history-title"
        icon={Trophy}
        title="Tournament history"
        meta={
          tournaments.length > 0
            ? formatCountOf(tournaments.length, 'tournament')
            : undefined
        }
      />
      {tournaments.length === 0 ? (
        <EmptyState icon={Trophy} title="No tournaments" titleAs="h3" />
      ) : (
        <>
          <RowList>
            {tournaments.slice(0, displayCount).map((tournament) => (
              <PlayerTournamentCard
                key={tournament.id}
                tournament={tournament}
                adjustments={adjustments}
              />
            ))}
          </RowList>
          <LoadMore
            label="Show more"
            hasMore={shownCount < tournaments.length}
            shownCount={shownCount}
            totalCount={tournaments.length}
            pageSize={INITIAL_COUNT}
            onLoadMore={() =>
              setDisplayCount((count) =>
                Math.min(count + LOAD_MORE_COUNT, tournaments.length)
              )
            }
          />
        </>
      )}
    </Panel>
  );
}
