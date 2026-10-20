import {
  ChartPlotSkeleton,
  LoadMoreSkeleton,
  PanelSkeleton,
  RowListSkeleton,
  RulesetSwitchSkeleton,
  SectionHeaderSkeleton,
  SkeletonText,
  StatTileGridSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageSection } from '@/components/kit/layout/PageSection';
import {
  BY_RULESET_SECTION,
  OVERVIEW_LABELS,
  RATING_GAP_TILE_LABELS,
  STATS_PANELS,
  type StatsPanelCopy,
  VERIFICATION_TILE_LABELS,
} from '@/components/stats/chart-panels';

import { StatsPageHeader } from './StatsPageHeader';

/** A chart panel: the real header, a meta bar as wide as the loaded count. */
function ChartPanelSkeleton({
  copy,
  metaWidth,
  plot = 'h-60',
  level,
}: {
  copy: StatsPanelCopy;
  metaWidth: string;
  plot?: string;
  level?: 3;
}) {
  return (
    <PanelSkeleton>
      <SectionHeaderSkeleton {...copy} meta={metaWidth} level={level} />
      <div className="p-4">
        <ChartPlotSkeleton className={plot} />
      </div>
    </PanelSkeleton>
  );
}

/** A ranked list panel: the real header, a meta bar, and its rows. */
function RecordListSkeleton({
  copy,
  rows,
  meta = false,
}: {
  copy: StatsPanelCopy;
  rows: number;
  /** Rows with a second muted line, such as a tiebreaker's beatmap. */
  meta?: boolean;
}) {
  return (
    <PanelSkeleton>
      <SectionHeaderSkeleton {...copy} meta="w-48" level={3} />
      <RowListSkeleton rows={rows} leading="none" meta={meta} />
    </PanelSkeleton>
  );
}

export default function StatsLoading() {
  return (
    <PageFrame role="status" aria-label="Loading statistics">
      <StatsPageHeader />
      <PanelSkeleton>
        <SectionHeaderSkeleton {...STATS_PANELS.overview} meta={false} />
        <div className="p-4">
          <StatTileGridSkeleton labels={OVERVIEW_LABELS} columns={4} sub />
        </div>
      </PanelSkeleton>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelSkeleton>
          <SectionHeaderSkeleton {...STATS_PANELS.verification} meta="w-28" />
          <div className="flex flex-col gap-3 p-4">
            <StatTileGridSkeleton
              labels={VERIFICATION_TILE_LABELS}
              columns={2}
              sub
            />
            <ChartPlotSkeleton className="h-48" />
          </div>
        </PanelSkeleton>
        <PanelSkeleton>
          <SectionHeaderSkeleton
            {...STATS_PANELS.recentlyVerified}
            meta={false}
          />
          <RowListSkeleton rows={5} leading="none" />
          <LoadMoreSkeleton />
        </PanelSkeleton>
        <ChartPanelSkeleton copy={STATS_PANELS.year} metaWidth="w-20" />
        <ChartPanelSkeleton copy={STATS_PANELS.lazerShare} metaWidth="w-20" />
        <ChartPanelSkeleton copy={STATS_PANELS.ruleset} metaWidth="w-20" />
        <ChartPanelSkeleton copy={STATS_PANELS.lobbySize} metaWidth="w-20" />
      </div>
      <PageSection {...BY_RULESET_SECTION} actions={<RulesetSwitchSkeleton />}>
        <PanelSkeleton>
          <SectionHeaderSkeleton
            {...STATS_PANELS.ratingDistribution}
            meta="w-22"
            level={3}
          />
          <div className="flex flex-col gap-3 p-4">
            {/* The legend: one line on desktop, two on tablets, four on
                phones. */}
            <div className="flex h-19 items-start sm:h-9 lg:h-4 lg:items-center">
              <SkeletonText className="h-3 w-full max-w-xl" />
            </div>
            <ChartPlotSkeleton className="h-72" />
          </div>
        </PanelSkeleton>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartPanelSkeleton
            copy={STATS_PANELS.playersByCountry}
            metaWidth="w-36"
            plot="h-72"
            level={3}
          />
          <ChartPanelSkeleton
            copy={STATS_PANELS.topPlayersByCountry}
            metaWidth="w-36"
            plot="h-72"
            level={3}
          />
        </div>
        <ChartPanelSkeleton
          copy={STATS_PANELS.rankRestrictions}
          metaWidth="w-28"
          plot="h-80"
          level={3}
        />
        <RecordListSkeleton copy={STATS_PANELS.strongestFields} rows={10} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PanelSkeleton>
            <SectionHeaderSkeleton
              {...STATS_PANELS.higherRatedWins}
              meta="w-28"
              level={3}
            />
            <div className="flex flex-col gap-3 p-4">
              <StatTileGridSkeleton
                labels={RATING_GAP_TILE_LABELS}
                columns={2}
              />
              <ChartPlotSkeleton className="h-60" />
            </div>
          </PanelSkeleton>
          <RecordListSkeleton copy={STATS_PANELS.biggestUpsets} rows={5} />
          <RecordListSkeleton copy={STATS_PANELS.closestGames} rows={5} meta />
          <RecordListSkeleton copy={STATS_PANELS.biggestComebacks} rows={5} />
        </div>
      </PageSection>
    </PageFrame>
  );
}
