import type { Ruleset } from '@otr/core/osu';
import { Trophy, Upload } from 'lucide-react';
import { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect, unstable_rethrow } from 'next/navigation';

import {
  TOURNAMENT_LIST_PARAMS,
  TOURNAMENT_PAGE_SIZE,
  legacyTournamentListHref,
  resolveTournamentRulesets,
  toTournamentListRequest,
  tournamentListHref,
  type TournamentListState,
} from '@/app/tournaments/list-params';
import { Button } from '@/components/kit/controls/Button';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import { Panel } from '@/components/kit/layout/Panel';
import { PaginationFooter } from '@/components/kit/tables/PaginationFooter';
import TournamentList from '@/components/tournaments/list/TournamentList';
import TournamentListError from '@/components/tournaments/list/TournamentListError';
import TournamentListToolbar from '@/components/tournaments/list/TournamentListToolbar';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';
import { getBrowsingRuleset } from '@/lib/db/ruleset-settings';
import { formatCountOf } from '@/lib/kit/format/number';
import {
  clearListFilters,
  countActiveFilters,
  parseListState,
} from '@/lib/kit/lists/params';
import { orpc } from '@/lib/orpc/orpc';
import type { TournamentListPageResponse } from '@/lib/orpc/schema/tournament';
import type { PageSearchParams } from '@/lib/types';
import { logger } from '@/lib/logger';

export const metadata: Metadata = {
  title: 'Tournaments',
  description: 'Browse tournament submissions and their verification status.',
};

async function fetchTournaments(
  state: TournamentListState,
  defaultRulesets: readonly Ruleset[]
): Promise<TournamentListPageResponse | null> {
  try {
    return await orpc.tournaments.listPage(
      toTournamentListRequest(state, defaultRulesets)
    );
  } catch (error) {
    // Next's own control-flow errors (dynamic rendering, redirects) pass.
    unstable_rethrow(error);
    logger.error('Tournament list could not load', { error });
    return null;
  }
}

function TournamentResults({
  state,
  defaultRulesets,
  data,
}: {
  state: TournamentListState;
  defaultRulesets: readonly Ruleset[];
  data: TournamentListPageResponse | null;
}) {
  if (!data) {
    return <TournamentListError />;
  }

  if (data.items.length === 0) {
    const filtered = countActiveFilters(TOURNAMENT_LIST_PARAMS, state) > 0;
    const narrowed =
      filtered ||
      state.q !== '' ||
      resolveTournamentRulesets(state, defaultRulesets).length > 0;

    return (
      <EmptyState
        data-testid="tournament-empty-state"
        title={narrowed ? 'No tournaments match' : 'No tournaments yet'}
        description={
          narrowed
            ? 'Try a different name, ruleset, or fewer filters.'
            : 'No tournament submissions are available right now.'
        }
        clearFilters={
          filtered
            ? {
                href: tournamentListHref(
                  clearListFilters(TOURNAMENT_LIST_PARAMS, state)
                ),
              }
            : undefined
        }
      />
    );
  }

  return (
    <>
      <TournamentList tournaments={data.items} />
      <PaginationFooter
        data-testid="tournament-pagination"
        page={state.page}
        pageSize={TOURNAMENT_PAGE_SIZE}
        totalCount={data.totalCount}
        getPageHref={(page) => tournamentListHref({ ...state, page })}
        label="Tournament pages"
      />
    </>
  );
}

export default async function Page({ searchParams }: PageSearchParams) {
  const raw = await searchParams;
  const legacyHref = legacyTournamentListHref(raw);
  if (legacyHref) redirect(legacyHref);

  const state = parseListState(TOURNAMENT_LIST_PARAMS, raw);
  const sessionRequest = auth.api.getSession({ headers: await headers() });
  // An address without a ruleset shows the visitor's browsing ruleset, and
  // every ruleset when signed out. It is never written to the address, so a
  // shared link shows each visitor their own.
  const defaultRulesetsRequest = sessionRequest
    .then((session) => getBrowsingRuleset(db, session?.dbPlayer?.id))
    .then((ruleset): Ruleset[] => (ruleset === null ? [] : [ruleset]));
  const [session, defaultRulesets, data] = await Promise.all([
    sessionRequest,
    defaultRulesetsRequest,
    // Only an address without a ruleset waits for the visitor's.
    state.ruleset === undefined
      ? defaultRulesetsRequest.then((rulesets) =>
          fetchTournaments(state, rulesets)
        )
      : fetchTournaments(state, []),
  ]);

  // A page past the end, such as an old link after filtering, shows the last.
  if (data && data.totalPages > 0 && state.page > data.totalPages) {
    redirect(tournamentListHref({ ...state, page: data.totalPages }));
  }

  return (
    <PageFrame>
      <PageHeader
        icon={Trophy}
        title="Tournaments"
        description="Browse tournament submissions and their review status. Only verified data is included in ratings."
        actions={
          session ? (
            <Button asChild icon={Upload}>
              <Link href="/tournaments/submit">Submit</Link>
            </Button>
          ) : null
        }
      />

      <Panel aria-label="Tournament archive" data-testid="tournament-results">
        <TournamentListToolbar
          defaultRulesets={defaultRulesets}
          count={
            data
              ? formatCountOf(data.totalCount, 'tournament', 'tournaments')
              : undefined
          }
        />
        <TournamentResults
          state={state}
          defaultRulesets={defaultRulesets}
          data={data}
        />
      </Panel>
    </PageFrame>
  );
}
