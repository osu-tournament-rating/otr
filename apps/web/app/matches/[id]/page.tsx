import { Swords } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { z } from 'zod';

import GamesListClient from '@/components/games/GamesListClient';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { NotInRatings } from '@/components/kit/status/NotInRatings';
import MatchHero from '@/components/matches/MatchHero';
import MatchStatsView from '@/components/matches/MatchStatsView';
import MergedMatchStatus from '@/components/matches/MergedMatchStatus';
import { getMatchDisplayName } from '@/components/matches/matchName';
import { parseMatchTab } from '@/components/matches/matchTabs';
import { getCountryNames } from '@/lib/kit/format/country';
import { formatCountOf } from '@/lib/kit/format/number';
import { getMatchCached, getMatchMergeCached } from '@/lib/orpc/queries/match';
import {
  fetchOrpcOptional,
  fetchOrpcOrNotFound,
  parseParamsOrNotFound,
} from '@/lib/orpc/server-helpers';

import { GameFramesSkeleton } from './skeletons';

type PageProps = {
  params: Promise<{ id: number }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const matchPageParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const parsedParams = matchPageParamsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return { title: 'Match not found' };
  }

  const match = await fetchOrpcOptional(() =>
    getMatchCached(parsedParams.data.id)
  );

  if (match) {
    return { title: getMatchDisplayName(match) };
  }

  const merge = await fetchOrpcOptional(() =>
    getMatchMergeCached(parsedParams.data.id)
  );

  return { title: merge ? 'Match merged' : 'Match not found' };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = parseParamsOrNotFound(matchPageParamsSchema, await params);
  const tab = parseMatchTab((await searchParams).tab);
  const match = await fetchOrpcOptional(() => getMatchCached(id));

  if (!match) {
    const merge = await fetchOrpcOrNotFound(() => getMatchMergeCached(id));
    return <MergedMatchStatus merge={merge} />;
  }

  const games = match.games ?? [];
  const players = match.players ?? [];
  // Worked out here, so the score cards' flags never name a country with
  // the browser's own region names.
  const countryNames = getCountryNames(players.map((player) => player.country));

  return (
    <PageFrame>
      <MatchHero match={match} tab={tab} />
      <NotInRatings
        status={match.verificationStatus}
        variant="notice"
        subject="match"
      />

      {tab === 'games' ? (
        <Panel>
          <SectionHeader
            icon={Swords}
            title="Games"
            meta={formatCountOf(games.length, 'game')}
          />
          {games.length > 0 ? (
            <PanelBody>
              <Suspense fallback={<GameFramesSkeleton />}>
                <GamesListClient
                  games={games}
                  players={players}
                  countryNames={countryNames}
                />
              </Suspense>
            </PanelBody>
          ) : (
            <EmptyState icon={Swords} title="No games recorded" />
          )}
        </Panel>
      ) : (
        <MatchStatsView match={match} />
      )}
    </PageFrame>
  );
}
