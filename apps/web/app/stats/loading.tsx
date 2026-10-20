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
  STATS_PANELS,
  VERIFICATION_TILE_LABELS,
} from '@/components/stats/chart-panels';

import { StatsPageHeader } from './StatsPageHeader';

/** Each meta bar is as wide as the loaded count ("2,540 verified" is 80px). */
const CHART_PANELS = [
  { copy: STATS_PANELS.year, metaWidth: 'w-20' },
  { copy: STATS_PANELS.lazerShare, metaWidth: 'w-20' },
  { copy: STATS_PANELS.ruleset, metaWidth: 'w-20' },
  { copy: STATS_PANELS.lobbySize, metaWidth: 'w-20' },
];

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
        {CHART_PANELS.map(({ copy, metaWidth }) => (
          <PanelSkeleton key={copy.title}>
            <SectionHeaderSkeleton {...copy} meta={metaWidth} />
            <div className="p-4">
              <ChartPlotSkeleton className="h-60" />
            </div>
          </PanelSkeleton>
        ))}
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
      </PageSection>
    </PageFrame>
  );
}
