import { Ruleset } from '@otr/core/osu';
import { ChartNoAxesColumnIncreasing } from 'lucide-react';
import { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';

import SectionErrorBoundary from '@/components/error/SectionErrorBoundary';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import PlayerBeatmapsList from '@/components/player/PlayerBeatmapsList';
import PlayerHero from '@/components/player/PlayerHero';
import PlayerModCountChart from '@/components/player/PlayerModCountChart';
import PlayerModStatsChart from '@/components/player/PlayerModStatsChart';
import PlayerOpponentsChart from '@/components/player/PlayerOpponentsChart';
import PlayerRatingChart from '@/components/player/PlayerRatingChart';
import PlayerRatingStats from '@/components/player/PlayerRatingStats';
import {
  PlayerBeatmapsSkeleton,
  PlayerTournamentsSkeleton,
} from '@/components/player/PlayerSectionSkeletons';
import PlayerTeammatesChart from '@/components/player/PlayerTeammatesChart';
import PlayerTournamentsList from '@/components/player/PlayerTournamentsList';
import { resolvePlayerIdFromKey } from '@/lib/db/player-resolve';
import { getPlayerBeatmapsCached } from '@/lib/orpc/queries/playerBeatmaps';
import { getPlayerStatsCached } from '@/lib/orpc/queries/playerStats';
import { getPlayerTournamentHistoryCached } from '@/lib/orpc/queries/playerTournaments';
import type {
  PlayerRatingAdjustment,
  PlayerStats,
} from '@/lib/orpc/schema/playerStats';
import {
  fetchOrpcOptional,
  parseParamsOrNotFound,
} from '@/lib/orpc/server-helpers';

const INITIAL_BEATMAPS_LIMIT = 3;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const playerPageParamsSchema = z.object({
  id: z.string().min(1),
});

// Junk filter params fall back to the defaults instead of failing the page.
const playerPageFilterSchema = z.object({
  ruleset: z.coerce.number().pipe(z.enum(Ruleset)).optional().catch(undefined),
  dateMin: z.coerce.date().optional().catch(undefined),
  dateMax: z.coerce.date().optional().catch(undefined),
});

type PlayerPageFilter = z.infer<typeof playerPageFilterSchema>;

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const parsedParams = playerPageParamsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return {
      title: 'Player not found',
    };
  }

  const decodedId = decodeURIComponent(parsedParams.data.id);
  const playerData = await getPlayerData(decodedId, {});

  if (!playerData) {
    return {
      title: 'Player not found',
    };
  }

  return {
    title: playerData.playerInfo.username,
  };
}

/**
 * Resolves undefined only when the player does not exist. Every other failure
 * throws, so it reaches the error screen rather than the not-found page.
 */
async function getPlayerData(
  key: string,
  filter: PlayerPageFilter
): Promise<PlayerStats | undefined> {
  const decodedKey = decodeURIComponent(key);
  const playerId = (await resolvePlayerIdFromKey(decodedKey)) ?? 0;

  if (playerId <= 0) {
    return undefined;
  }

  return fetchOrpcOptional(() =>
    getPlayerStatsCached(
      playerId,
      filter.dateMin,
      filter.dateMax,
      filter.ruleset
    )
  );
}

async function PlayerTournaments({
  playerId,
  filter,
  adjustments,
}: {
  playerId: number;
  filter: PlayerPageFilter;
  adjustments: PlayerRatingAdjustment[];
}) {
  const tournaments = await getPlayerTournamentHistoryCached(
    playerId,
    filter.dateMin,
    filter.dateMax,
    filter.ruleset
  );

  return (
    <PlayerTournamentsList
      tournaments={tournaments}
      adjustments={adjustments}
    />
  );
}

async function PlayerBeatmaps({
  playerId,
  ruleset,
}: {
  playerId: number;
  ruleset: Ruleset;
}) {
  const { beatmaps, totalCount } = await getPlayerBeatmapsCached(
    playerId,
    ruleset,
    INITIAL_BEATMAPS_LIMIT,
    0
  );

  return (
    <PlayerBeatmapsList
      playerId={playerId}
      ruleset={ruleset}
      initialBeatmaps={beatmaps}
      totalCount={totalCount}
    />
  );
}

export default async function PlayerPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const { id } = parseParamsOrNotFound(
    playerPageParamsSchema,
    await props.params
  );
  const filter = playerPageFilterSchema.parse(searchParams);

  const decodedId = decodeURIComponent(id);
  const playerData = await getPlayerData(decodedId, filter);

  if (!playerData) {
    return notFound();
  }

  const canonicalPlayerId = playerData.playerInfo.id;

  // Canonicalize the URL onto the o!TR ID
  if (canonicalPlayerId && canonicalPlayerId.toString() !== decodedId) {
    const queryString = new URLSearchParams(
      Object.entries(searchParams).reduce(
        (acc, [key, value]) => {
          if (value !== undefined) {
            acc[key] = Array.isArray(value) ? value[0] : value;
          }
          return acc;
        },
        {} as Record<string, string>
      )
    ).toString();

    const redirectUrl = `/players/${playerData.playerInfo.id}${
      queryString ? `?${queryString}` : ''
    }`;

    redirect(redirectUrl);
  }

  // The stats resolve a missing or invalid ruleset to the player's default
  const currentRuleset = playerData.ruleset;

  const chartHighestRating = playerData.rating?.adjustments?.length
    ? playerData.rating.adjustments.reduce(
        (max, adjustment) => Math.max(max, adjustment.ratingAfter),
        playerData.rating.adjustments[0].ratingAfter
      )
    : (playerData.matchStats?.highestRating ?? undefined);

  return (
    <PageFrame>
      <PlayerHero player={playerData.playerInfo} ruleset={currentRuleset} />

      {playerData.rating ? (
        <>
          <PlayerRatingStats rating={playerData.rating} />
          <PlayerRatingChart
            adjustments={playerData.rating.adjustments}
            highestRating={chartHighestRating ?? undefined}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <PlayerModStatsChart modStats={playerData.modStats} />
            <PlayerModCountChart modStats={playerData.modStats} />
            <PlayerTeammatesChart
              teammates={playerData.frequentTeammates}
              ruleset={currentRuleset}
            />
            <PlayerOpponentsChart
              opponents={playerData.frequentOpponents}
              ruleset={currentRuleset}
            />
          </div>
        </>
      ) : (
        <Panel>
          <SectionHeader icon={ChartNoAxesColumnIncreasing} title="Rating" />
          <EmptyState
            icon={ChartNoAxesColumnIncreasing}
            title="No rating data"
            titleAs="h3"
            description="This player has no rating data for the selected ruleset."
          />
        </Panel>
      )}

      <SectionErrorBoundary title="Tournament history could not load">
        <Suspense
          fallback={
            <PlayerTournamentsSkeleton label="Loading tournament history" />
          }
        >
          <PlayerTournaments
            playerId={canonicalPlayerId}
            filter={{ ...filter, ruleset: currentRuleset }}
            adjustments={playerData.rating?.adjustments ?? []}
          />
        </Suspense>
      </SectionErrorBoundary>

      <SectionErrorBoundary title="Pooled beatmaps could not load">
        <Suspense
          fallback={<PlayerBeatmapsSkeleton label="Loading pooled beatmaps" />}
        >
          <PlayerBeatmaps
            playerId={canonicalPlayerId}
            ruleset={currentRuleset}
          />
        </Suspense>
      </SectionErrorBoundary>
    </PageFrame>
  );
}
