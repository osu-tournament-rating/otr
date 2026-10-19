import type { Metadata } from 'next';
import { VerificationStatus } from '@otr/core/osu';
import { z } from 'zod';

import { PageFrame } from '@/components/kit/layout/PageFrame';
import { NotInRatings } from '@/components/kit/status/NotInRatings';
import TournamentBeatmapsAdminView from '@/components/tournaments/TournamentBeatmapsAdminView';
import TournamentHero, {
  type TournamentHeroData,
} from '@/components/tournaments/TournamentHero';
import TournamentMatchesAdminView from '@/components/tournaments/TournamentMatchesAdminView';
import TournamentPlayerStatsView from '@/components/tournaments/TournamentPlayerStatsView';
import TournamentRatingsView from '@/components/tournaments/TournamentRatingsView';
import TournamentStatsPanel from '@/components/tournaments/TournamentStatsPanel';
import type { MatchRow } from '@/components/tournaments/matchRow';
import {
  DEFAULT_TOURNAMENT_TAB,
  TOURNAMENT_TABS,
} from '@/components/tournaments/tabs';
import { isDeletedTournamentBeatmap } from '@/lib/beatmaps/presentation';
import { parseHeroTab } from '@/lib/kit/layout/hero-tabs';
import { getTournamentCached } from '@/lib/orpc/queries/tournament';
import type {
  TournamentDetail,
  TournamentMatch,
} from '@/lib/orpc/schema/tournament';
import {
  fetchOrpcOptional,
  fetchOrpcOrNotFound,
  parseParamsOrNotFound,
} from '@/lib/orpc/server-helpers';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const tournamentPageParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const parsedParams = tournamentPageParamsSchema.safeParse(await params);

  if (!parsedParams.success) {
    return { title: 'Tournament not found' };
  }

  const tournament = await fetchOrpcOptional(() =>
    getTournamentCached(parsedParams.data.id)
  );

  if (!tournament) {
    return { title: 'Tournament not found' };
  }

  return { title: tournament.name };
}

function toMatchRows(matches: TournamentMatch[]): MatchRow[] {
  return matches.map((match) => ({
    id: match.id,
    name: match.name,
    status: {
      verificationStatus: match.verificationStatus,
      warningFlags: match.warningFlags,
      rejectionReason: match.rejectionReason,
      verifiedByUsername: match.verifiedByUsername,
    },
    startDate: match.startTime ? new Date(match.startTime).toISOString() : null,
    winRecord: match.winRecord,
    games: (match.games ?? []).map((game) => ({
      id: game.id,
      verificationStatus: game.verificationStatus,
      warningFlags: game.warningFlags,
      startTime: game.startTime,
      rejectionReason: game.rejectionReason,
      adminNotes: (game.adminNotes ?? []).map((note) => ({
        note: note.note,
        adminUsername: note.adminUser?.player?.username ?? 'Unknown',
        created: note.created,
      })),
    })),
    matchAdminNotes: (match.adminNotes ?? []).map((note) => ({
      note: note.note,
      adminUsername: note.adminUser?.player?.username ?? 'Unknown',
      created: note.created,
    })),
  }));
}

/** The fields the hero needs, so the client gets no matches or pool. */
function toHeroData(tournament: TournamentDetail): TournamentHeroData {
  return {
    id: tournament.id,
    name: tournament.name,
    abbreviation: tournament.abbreviation,
    forumUrl: tournament.forumUrl,
    rankRangeLowerBound: tournament.rankRangeLowerBound,
    lobbySize: tournament.lobbySize,
    ruleset: tournament.ruleset,
    verificationStatus: tournament.verificationStatus,
    rejectionReason: tournament.rejectionReason,
    startTime: tournament.startTime,
    endTime: tournament.endTime,
    isLazer: tournament.isLazer,
    adminNotes: tournament.adminNotes ?? [],
    verifiedByUsername: tournament.verifiedByUsername,
    submittedByUsername: tournament.submittedByUsername,
  };
}

export default async function Page({ params, searchParams }: PageProps) {
  const { id } = parseParamsOrNotFound(
    tournamentPageParamsSchema,
    await params
  );
  const tab = parseHeroTab(
    (await searchParams).tab,
    TOURNAMENT_TABS,
    DEFAULT_TOURNAMENT_TAB
  );

  const tournament: TournamentDetail = await fetchOrpcOrNotFound(() =>
    getTournamentCached(id)
  );
  const matches = tournament.matches ?? [];
  const beatmaps = tournament.pooledBeatmaps ?? [];
  const playerStats = tournament.playerTournamentStats ?? [];
  const visibleBeatmapCount = beatmaps.filter(
    (beatmap) => !isDeletedTournamentBeatmap(beatmap)
  ).length;

  return (
    <PageFrame>
      <TournamentHero
        tournament={toHeroData(tournament)}
        tab={tab}
        counts={{
          matches: matches.length,
          beatmaps: visibleBeatmapCount,
        }}
        // Player stats arrive with the Tuesday update that rates it.
        pendingRating={
          tournament.verificationStatus === VerificationStatus.Verified &&
          playerStats.length === 0
        }
      />

      <NotInRatings status={tournament.verificationStatus} variant="notice" />

      {tab === 'matches' && (
        <div data-testid="tab-content-matches" className="flex flex-col gap-4">
          <TournamentMatchesAdminView
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            matches={toMatchRows(matches)}
            isLazer={tournament.isLazer}
          />
        </div>
      )}

      {tab === 'beatmaps' && (
        <div data-testid="tab-content-beatmaps" className="flex flex-col gap-4">
          <TournamentBeatmapsAdminView
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            beatmaps={beatmaps}
            tournamentGames={matches.flatMap((match) => match.games ?? [])}
          />
        </div>
      )}

      {tab === 'ratings' && (
        <div data-testid="tab-content-ratings" className="flex flex-col gap-4">
          <TournamentRatingsView
            playerStats={playerStats}
            verificationStatus={tournament.verificationStatus}
          />
        </div>
      )}

      {tab === 'stats' && (
        <div data-testid="tab-content-stats" className="flex flex-col gap-4">
          <TournamentStatsPanel tournament={tournament} />
          <TournamentPlayerStatsView
            playerStats={playerStats}
            ruleset={tournament.ruleset}
            verificationStatus={tournament.verificationStatus}
          />
        </div>
      )}
    </PageFrame>
  );
}
