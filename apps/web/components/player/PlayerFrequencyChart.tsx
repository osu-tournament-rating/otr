'use client';

import type { Ruleset } from '@otr/core/osu';
import Image from 'next/image';
import Link from 'next/link';
import { type ComponentProps, useCallback, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { ChartTooltipContent } from '@/components/kit/charts/ChartTooltip';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import {
  CHART_BAR_RADIUS,
  CHART_CURSOR,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import { formatCountTick } from '@/lib/kit/charts/format';
import { getNiceTicks } from '@/lib/kit/charts/ticks';
import type { KitIcon } from '@/lib/kit/layout/icon';
import type { PlayerFrequency } from '@/lib/orpc/schema/playerStats';
import { cn } from '@/lib/utils';

const DESKTOP_DISPLAY_LIMIT = 10;
const PHONE_DISPLAY_LIMIT = 7;
const AVATAR_SIZE = 32;
// Room around a tick avatar so its focus ring isn't clipped.
const TICK_FOCUS_RING = 3;
// Recharts puts a tick 6px (its tick size) plus the tick margin below the
// axis line; the avatar's top sits there.
const TICK_SIZE = 6;
const TICK_MARGIN = 4;
// Tall enough for the avatar and its focus ring, so the chart's edge never
// cuts off the bottom of either.
const X_AXIS_HEIGHT = TICK_SIZE + TICK_MARGIN + AVATAR_SIZE + TICK_FOCUS_RING;
const BAR_SIZE = 28;
const AVATAR_BASE_URL = 'https://a.ppy.sh';

interface ChartDataEntry {
  username: string;
  frequency: number;
  playerId: number;
  osuId: number;
}

/**
 * The players someone meets most, as bars with each player's avatar under
 * theirs, linking to that profile in the ruleset the page shows. Teammates
 * and opponents are neutral series, never a good or bad color: teammates
 * take the first categorical slot and opponents `OPPONENT_COLOR`.
 */
export default function PlayerFrequencyChart({
  className,
  data,
  title,
  icon,
  emptyTitle,
  color,
  ruleset,
}: {
  className?: string;
  data: PlayerFrequency[];
  title: string;
  icon: KitIcon;
  emptyTitle: string;
  /** The series color, `seriesColor(0)` or `OPPONENT_COLOR`. */
  color: string;
  /**
   * The ruleset the profile shows, so a player's link opens the same one
   * even when the address has no `?ruleset=` (the player's own default).
   */
  ruleset: Ruleset;
}) {
  const isPhone = useMediaQuery('(max-width: 767px)');
  const [failedAvatars, setFailedAvatars] = useState<Set<number>>(
    () => new Set()
  );

  const chartData = useMemo<ChartDataEntry[]>(
    () =>
      data
        .map((item) => ({
          username: item.player.username,
          frequency: item.frequency,
          playerId: item.player.id,
          osuId: item.player.osuId,
        }))
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, isPhone ? PHONE_DISPLAY_LIMIT : DESKTOP_DISPLAY_LIMIT),
    [data, isPhone]
  );

  const handleAvatarError = useCallback((osuId: number) => {
    setFailedAvatars((prev) => new Set(prev).add(osuId));
  }, []);

  // Some osu! avatars are fully transparent; those get the fallback disc too.
  const handleAvatarLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>, osuId: number) => {
      const img = event.currentTarget;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      try {
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] > 10) return;
        }
        handleAvatarError(osuId);
      } catch {
        // A cross-origin image can't be read; leave it as it is.
      }
    },
    [handleAvatarError]
  );

  // Link by o!TR ID: a numeric key is tried as an o!TR ID before an osu! ID.
  const profileHref = useCallback(
    (playerId: number) => `/players/${playerId}?ruleset=${ruleset}`,
    [ruleset]
  );

  const AvatarTick = useCallback(
    (props: { x?: number; y?: number; payload?: { value: string } }) => {
      const { x, y, payload } = props;
      const player = chartData.find(
        (entry) => entry.username === payload?.value
      );

      if (!player || x === undefined || y === undefined) {
        return <g />;
      }

      const showFallback = failedAvatars.has(player.osuId);

      return (
        <g transform={`translate(${x},${y})`}>
          <foreignObject
            x={-AVATAR_SIZE / 2 - TICK_FOCUS_RING}
            y={-TICK_FOCUS_RING}
            width={AVATAR_SIZE + TICK_FOCUS_RING * 2}
            height={AVATAR_SIZE + TICK_FOCUS_RING * 2}
          >
            <Link
              href={profileHref(player.playerId)}
              className="flex rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              style={{ margin: TICK_FOCUS_RING }}
              aria-label={player.username}
              title={player.username}
            >
              {showFallback ? (
                <span
                  className="block rounded-full bg-accent"
                  style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
                />
              ) : (
                <Image
                  src={`${AVATAR_BASE_URL}/${player.osuId}`}
                  alt=""
                  width={AVATAR_SIZE}
                  height={AVATAR_SIZE}
                  className="rounded-full"
                  style={{ imageRendering: 'crisp-edges' }}
                  onLoad={(event) => handleAvatarLoad(event, player.osuId)}
                  onError={() => handleAvatarError(player.osuId)}
                />
              )}
            </Link>
          </foreignObject>
        </g>
      );
    },
    [chartData, failedAvatars, profileHref, handleAvatarError, handleAvatarLoad]
  );

  if (chartData.length === 0) {
    return (
      <Panel className={className}>
        <SectionHeader icon={icon} title={title} />
        <EmptyState size="compact" icon={icon} title={emptyTitle} />
      </Panel>
    );
  }

  const yTicks = getNiceTicks(
    0,
    Math.max(...chartData.map((entry) => entry.frequency)),
    { integer: true }
  );

  return (
    <Panel className={cn('flex flex-col', className)}>
      <SectionHeader icon={icon} title={title} />
      <PanelBody className="flex flex-1 flex-col justify-center">
        <ChartContainer config={{}} className="aspect-auto h-72 w-full">
          <BarChart data={chartData} margin={CHART_MARGIN}>
            <CartesianGrid {...chartGridProps} />
            <XAxis
              {...chartAxisProps}
              dataKey="username"
              tick={AvatarTick as ComponentProps<typeof XAxis>['tick']}
              tickSize={TICK_SIZE}
              tickMargin={TICK_MARGIN}
              interval={0}
              height={X_AXIS_HEIGHT}
            />
            <YAxis
              {...chartValueAxisProps}
              {...niceAxisProps(yTicks)}
              tickFormatter={formatCountTick}
            />
            <ChartTooltip
              cursor={CHART_CURSOR.bar}
              content={
                <ChartTooltipContent
                  nameFormatter={() => 'Matches'}
                  valueFormatter={formatCountTick}
                />
              }
            />
            <Bar
              dataKey="frequency"
              name="Matches"
              fill={color}
              radius={CHART_BAR_RADIUS}
              barSize={BAR_SIZE}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  );
}
