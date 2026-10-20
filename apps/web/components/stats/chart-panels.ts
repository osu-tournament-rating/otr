import { UPSET_MIN_EARLIER_MATCHES } from '@otr/core/platform-stats/constants';
import {
  Calendar,
  ChartNoAxesColumn,
  CircleCheck,
  Crosshair,
  Gamepad2,
  Globe,
  LayoutGrid,
  ListChecks,
  Medal,
  Percent,
  Scale,
  Target,
  TrendingUp,
  Users,
  Zap,
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
  playersByCountry: {
    icon: Globe,
    title: 'Players by country',
  },
  topPlayersByCountry: {
    icon: Medal,
    title: 'Top 100 by country',
  },
  rankRestrictions: {
    icon: Target,
    title: 'Rank restrictions by year',
    infoText: `A tournament counts in the band its rank restriction starts at: 10k+ is for players ranked #10,000 and beyond. Years before the first with ${TREND_MIN_TOURNAMENTS} verified tournaments are left out.`,
  },
  higherRatedWins: {
    icon: Scale,
    title: 'Win rate by rating gap',
    infoText:
      "Rates each side by its players' average rating going into the match",
  },
  biggestUpsets: {
    icon: Zap,
    title: 'Biggest upsets',
    infoText: `Only matches where every player had ${UPSET_MIN_EARLIER_MATCHES}+ earlier rated matches`,
  },
  closestGames: {
    icon: Crosshair,
    title: 'Closest games',
    infoText: 'Tiebreakers only: the last map of a match won by one map',
  },
  // No info button: each row says how far the winners trailed.
  biggestComebacks: {
    icon: TrendingUp,
    title: 'Biggest comebacks',
  },
} as const satisfies Record<string, StatsPanelCopy>;

/** The rating gap panel's tile labels, shared with the loading screen. */
export const RATING_GAP_TILE_LABELS = [
  'Higher-rated side wins',
  'Median rating gap',
] as const;

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
