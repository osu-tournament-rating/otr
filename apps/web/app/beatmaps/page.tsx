import { Metadata } from 'next';
import { Music } from 'lucide-react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import BeatmapListContent from '@/components/beatmaps/list/BeatmapListContent';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import { Panel } from '@/components/kit/layout/Panel';
import { PaginationFooter } from '@/components/kit/tables/PaginationFooter';
import {
  BEATMAP_LIST_PAGE_SIZE,
  BEATMAP_LIST_PARAMS,
  beatmapListHref,
  toBeatmapListRequest,
} from '@/lib/beatmaps/list-params';
import { auth } from '@/lib/auth/auth';
import { db } from '@/lib/db';
import { getBrowsingRulesets } from '@/lib/db/ruleset-settings';
import { countActiveFilters, parseListState } from '@/lib/kit/lists/params';
import { orpc } from '@/lib/orpc/orpc';

export const metadata: Metadata = {
  title: 'Beatmaps',
  description: 'Browse tournament beatmaps and observed play data.',
};

export default async function Page(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const state = parseListState(BEATMAP_LIST_PARAMS, await props.searchParams);
  const session = await auth.api.getSession({ headers: await headers() });
  // An address without a ruleset shows the visitor's browsing ruleset, and
  // every ruleset when signed out. It is never written to the address, so a
  // shared link shows each visitor their own.
  const defaultRulesets = await getBrowsingRulesets(db, session?.dbPlayer?.id);
  const data = await orpc.beatmaps.list(
    toBeatmapListRequest(state, defaultRulesets)
  );

  const lastPage = Math.max(1, data.totalPages);
  if (state.page > lastPage) redirect(beatmapListHref(state, lastPage));

  const isFiltered =
    state.q !== '' ||
    (state.ruleset ?? defaultRulesets).length > 0 ||
    countActiveFilters(BEATMAP_LIST_PARAMS, state) > 0;

  return (
    <PageFrame>
      <PageHeader
        icon={Music}
        title="Beatmaps"
        description="Tournament maps and observed play data."
      />

      <Panel aria-label="Beatmap listing" data-testid="beatmap-results">
        <BeatmapListContent
          beatmaps={data.items}
          defaultRulesets={defaultRulesets}
          isFiltered={isFiltered}
          totalCount={data.totalCount}
        />
        <PaginationFooter
          data-testid="beatmap-pagination"
          label="Beatmap pages"
          page={state.page}
          pageSize={BEATMAP_LIST_PAGE_SIZE}
          totalCount={data.totalCount}
          getPageHref={(page) => beatmapListHref(state, page)}
        />
      </Panel>
    </PageFrame>
  );
}
