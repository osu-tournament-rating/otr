import {
  ChartBarBig,
  ChartLine,
  ChartNoAxesColumnIncreasing,
  ChartPie,
  Swords,
  Users,
} from 'lucide-react';

import {
  PanelSkeleton,
  SectionHeaderSkeleton,
  SkeletonText,
  StatTileGridSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { DetailHero } from '@/components/kit/layout/DetailHero';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PanelBody } from '@/components/kit/layout/Panel';
import {
  PlayerBeatmapsSkeleton,
  PlayerTournamentsSkeleton,
} from '@/components/player/PlayerSectionSkeletons';
import {
  MOD_DISTRIBUTION_INFO,
  MOD_PERFORMANCE_INFO,
} from '@/components/player/section-info';
import { RATED_RULESETS } from '@/lib/kit/format/ruleset';
import type { KitIcon } from '@/lib/kit/layout/icon';

const STAT_LABELS = [
  'Rating',
  'Percentile',
  'Global rank',
  'Country rank',
  'Tournaments',
  'Matches',
] as const;

// The chart panels below the rating history, in page order. The mod charts
// grow with the number of mods; this is a typical player's.
const CHART_PANELS: readonly {
  icon: KitIcon;
  title: string;
  /** The loaded header's info text, for the panels that have one. */
  info?: string;
  plot: string;
}[] = [
  {
    icon: ChartBarBig,
    title: 'Mod performance',
    info: MOD_PERFORMANCE_INFO,
    plot: 'h-44',
  },
  {
    icon: ChartPie,
    title: 'Mod distribution',
    info: MOD_DISTRIBUTION_INFO,
    plot: 'h-72 md:h-44',
  },
  {
    icon: Users,
    title: 'Frequent teammates',
    plot: 'h-72',
  },
  {
    icon: Swords,
    title: 'Frequent opponents',
    plot: 'h-72',
  },
];

export default function PlayerLoading() {
  return (
    <PageFrame role="status" aria-label="Loading player">
      <DetailHero
        leading={<SkeletonText className="block size-16 rounded-full" />}
        title={<SkeletonText className="h-7 w-44" />}
        meta={<SkeletonText className="h-4 w-28" />}
        actions={<SkeletonText className="block size-8" />}
      >
        <div className="flex flex-wrap gap-1.5 px-4 py-3 sm:px-6">
          {RATED_RULESETS.map((ruleset) => (
            <SkeletonText key={ruleset} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </DetailHero>

      <PanelSkeleton>
        <SectionHeaderSkeleton
          icon={ChartNoAxesColumnIncreasing}
          title="Rating"
          meta={false}
        />
        <PanelBody className="flex flex-col gap-4">
          <StatTileGridSkeleton
            labels={STAT_LABELS}
            columns={3}
            className="lg:grid-cols-6"
          />
          {/* The tier progress strip. */}
          <SkeletonText className="block h-15 w-full" />
        </PanelBody>
      </PanelSkeleton>

      <PanelSkeleton>
        {/* The peak rating meta: a tier icon, "Peak rating" and the rating. */}
        <SectionHeaderSkeleton
          icon={ChartLine}
          title="Rating history"
          meta="w-28"
        />
        {/* The two control groups (the view switches, then the decay chip
            and time range) wrap onto two rows on phones, as the loaded ones
            do; then the total change line and the 288px chart. */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <SkeletonText className="block h-8 w-56" />
          <SkeletonText className="block h-8 w-56" />
        </div>
        <p className="px-4 pt-3 text-sm">
          <SkeletonText className="w-36" />
        </p>
        <PanelBody>
          <SkeletonText className="block h-72 w-full rounded-lg" />
        </PanelBody>
      </PanelSkeleton>

      <div className="grid gap-4 md:grid-cols-2">
        {CHART_PANELS.map((panel) => (
          <PanelSkeleton key={panel.title}>
            <SectionHeaderSkeleton
              icon={panel.icon}
              title={panel.title}
              infoText={panel.info}
              meta={false}
            />
            <PanelBody>
              <SkeletonText
                className={`block w-full rounded-lg ${panel.plot}`}
              />
            </PanelBody>
          </PanelSkeleton>
        ))}
      </div>

      <PlayerTournamentsSkeleton />
      <PlayerBeatmapsSkeleton />
    </PageFrame>
  );
}
