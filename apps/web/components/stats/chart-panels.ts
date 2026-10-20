import {
  Calendar,
  ChartNoAxesColumn,
  CircleCheck,
  Gamepad2,
  LayoutGrid,
  ListChecks,
  Percent,
  Users,
} from 'lucide-react';

import type { KitIcon } from '@/lib/kit/layout/icon';
import { CHART_CONSTANTS } from '@/lib/utils/chart';

import { TREND_MIN_TOURNAMENTS } from './stats-data';

/**
 * The width of a rating bucket. The server groups ratings by this same
 * constant, so the chart reads it from the same place.
 */
export const RATING_BUCKET_SIZE = CHART_CONSTANTS.BUCKET_SIZE;

export interface StatsPanelCopy {
  icon: KitIcon;
  title: string;
  /** Help that says what the chart does not; never a restatement of the title. */
  infoText?: string;
}

/**
 * Each stats panel's header, shared by the panels and the loading screen so
 * the two match.
 */
export const STATS_PANELS = {
  verification: {
    icon: CircleCheck,
    title: 'Tournament verification status',
    infoText:
      'Not in ratings yet includes Pending, Pre-verified and Pre-rejected',
  },
  year: {
    icon: Calendar,
    title: 'Tournaments by year',
  },
  ruleset: {
    icon: Gamepad2,
    title: 'Tournaments by ruleset',
  },
  lobbySize: {
    icon: Users,
    title: 'Tournaments by lobby size',
  },
  // No info button: the legend and the tooltip explain the chart.
  ratingDistribution: {
    icon: ChartNoAxesColumn,
    title: 'Rating distribution',
  },
  overview: {
    icon: LayoutGrid,
    title: 'Overview',
    infoText: 'Counts only verified tournaments, matches, games and scores',
  },
  recentlyVerified: {
    icon: ListChecks,
    title: 'Recently verified tournaments',
  },
  lazerShare: {
    icon: Percent,
    title: 'Lazer share',
    infoText: `Tournaments played on osu!lazer, of each year's verified tournaments. Years before the first with ${TREND_MIN_TOURNAMENTS} verified tournaments are left out.`,
  },
} as const satisfies Record<string, StatsPanelCopy>;

/** The overview's tile labels, shared with the loading screen. */
export const OVERVIEW_LABELS = [
  'Tournaments',
  'Matches',
  'Scores',
  'Rated players',
] as const;

/** The verification panel's tile labels, shared with the loading screen. */
export const VERIFICATION_TILE_LABELS = ['Time to verify', 'Verified'] as const;

/** The heading over the panels that follow the page's ruleset. */
export const BY_RULESET_SECTION = {
  icon: Gamepad2,
  title: 'By ruleset',
} as const;
