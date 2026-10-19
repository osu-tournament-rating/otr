import {
  ChartColumn,
  ChartLine,
  Crosshair,
  Gamepad2,
  Medal,
  Swords,
  TrendingUp,
  Users,
} from 'lucide-react';

import {
  ChartPlotSkeleton,
  PanelSkeleton,
  SectionHeaderSkeleton,
  SkeletonBlock,
  SkeletonText,
  TableSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { PanelBody } from '@/components/kit/layout/Panel';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { PLAYER_PERFORMANCE_INFO } from '@/components/matches/MatchStatsUtils';

/**
 * Game cards while the games list loads: the recessed frame with its cover
 * header, two score cards and the result line, at their loaded heights.
 */
export function GameFramesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-xl border bg-game-frame p-3"
        >
          <span
            data-slot="skeleton"
            className="block h-32 animate-pulse rounded-xl bg-accent"
          />
          <div className="flex flex-col gap-1 lg:flex-row">
            {[0, 1].map((card) => (
              <div
                key={card}
                className="flex h-[4.375rem] flex-col justify-center gap-2 rounded-lg border bg-score-card px-3 sm:h-[5.375rem] lg:flex-1"
              >
                <SkeletonText className="w-40" />
                <SkeletonText className="h-3 w-56 max-w-full" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex h-[2.875rem] items-center justify-center rounded-lg border">
            <SkeletonText className="h-5 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

// The headline tiles of a verified match, in the loaded order, and whether
// each has a line under its value (the winner, tier or player).
const HIGHLIGHT_TILES = [
  { icon: Swords, label: 'Match result', sub: true },
  { icon: Users, label: 'Players', sub: false },
  { icon: Gamepad2, label: 'Rated games', sub: false },
  { icon: TrendingUp, label: 'Average rating', sub: true },
  { icon: Medal, label: 'Top match cost', sub: true },
  { icon: Crosshair, label: 'Top accuracy', sub: true },
] as const;

// The player table's columns, as MatchStatsView draws them.
const PLAYER_COLUMNS = [
  { label: 'Player' },
  { label: 'Record', width: 'w-24', align: 'end' },
  { label: 'Match cost', width: 'w-28', align: 'end' },
  { label: 'Rating', width: 'w-36', align: 'end', showFrom: 'lg' },
  { label: 'Change', width: 'w-24', align: 'end' },
  { label: 'Score', width: 'w-24', align: 'end', showFrom: 'lg' },
  { label: 'Accuracy', width: 'w-24', align: 'end' },
  { label: 'Misses', width: 'w-20', align: 'end', showFrom: 'lg' },
  { label: 'Placement', width: 'w-24', align: 'end', showFrom: 'lg' },
] as const;

const PHONE_METRICS = [
  'Match cost',
  'Record',
  'Score',
  'Accuracy',
  'Misses',
  'Placement',
] as const;

/**
 * The player table on a phone while it loads: the sort strip, then rows
 * with the name, the team badge, the rating change and every metric's
 * label, at the loaded rows' height.
 */
function PlayerPhoneRowsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex items-center gap-3 border-b bg-muted px-4 py-2">
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          Sort by
        </span>
        <SkeletonBlock className="h-8 flex-1" />
        <SkeletonBlock className="size-8" />
      </div>
      <PhoneRowList>
        {Array.from({ length: 4 }, (_, index) => (
          <PhoneRow
            key={index}
            align="start"
            title={
              <span className="flex items-center gap-2">
                <SkeletonBlock className="size-6 rounded-full" />
                <SkeletonText className="w-28" />
              </span>
            }
            value={<SkeletonText className="w-12" />}
            valueDescription={<SkeletonText className="h-3 w-24" />}
          >
            {/* The team badge under the name. */}
            <SkeletonBlock className="mt-1 h-5 w-14 rounded-full" />
            <dl className="mt-2 grid grid-cols-[repeat(3,minmax(0,auto))] justify-between gap-x-3 gap-y-2">
              {PHONE_METRICS.map((label) => (
                <div key={label} className="min-w-0">
                  <dt className="truncate text-xs text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="text-sm">
                    <SkeletonText className="w-12" />
                  </dd>
                </div>
              ))}
            </dl>
          </PhoneRow>
        ))}
      </PhoneRowList>
    </div>
  );
}

/**
 * The Stats tab while it loads, as a verified match shows it: the headline
 * tiles, the team score chart and the player table.
 */
export function MatchStatsSkeleton() {
  return (
    <>
      <PanelSkeleton>
        <SectionHeaderSkeleton
          icon={ChartColumn}
          title="Match statistics"
          meta={false}
        />
        <PanelBody>
          <StatTileGrid columns={3}>
            {HIGHLIGHT_TILES.map((tile) => (
              <StatTile
                key={tile.label}
                icon={tile.icon}
                label={tile.label}
                value={<SkeletonText className="w-20" />}
                sub={
                  tile.sub ? <SkeletonText className="h-3 w-16" /> : undefined
                }
              />
            ))}
          </StatTileGrid>
        </PanelBody>
      </PanelSkeleton>

      <PanelSkeleton>
        <SectionHeaderSkeleton
          icon={ChartLine}
          title="Team score progression"
          meta="w-24"
        />
        <PanelBody className="flex flex-col gap-3">
          <SkeletonText className="h-4 w-40" />
          <ChartPlotSkeleton className="h-60 sm:h-72" />
        </PanelBody>
      </PanelSkeleton>

      <PanelSkeleton>
        <SectionHeaderSkeleton
          icon={Users}
          title="Player performance"
          infoText={PLAYER_PERFORMANCE_INFO}
          meta="w-16"
        />
        {/* Rows are as tall as a name with its team badge under it. */}
        <TableSkeleton
          columns={PLAYER_COLUMNS}
          rows={8}
          cellHeight="h-12"
          phoneRows={<PlayerPhoneRowsSkeleton />}
        />
      </PanelSkeleton>
    </>
  );
}
