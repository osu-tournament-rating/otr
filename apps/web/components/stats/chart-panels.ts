import {
  FIELD_SIZE,
  MOST_PLAYED_MIN_TOURNAMENTS,
  POOL_DIFFICULTY_MIN_TOURNAMENTS,
  UPSET_MIN_EARLIER_MATCHES,
} from '@otr/core/platform-stats/constants';
import {
  Blend,
  Calendar,
  CalendarClock,
  ChartNoAxesColumn,
  CircleCheck,
  Crosshair,
  Crown,
  Disc3,
  Gamepad2,
  Gauge,
  Globe,
  LayoutGrid,
  ListChecks,
  Medal,
  MicVocal,
  PenLine,
  Percent,
  Scale,
  Target,
  TrendingUp,
  Users,
  UsersRound,
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
    infoText: `Tournaments played on osu!lazer, of each year's verified tournaments. Starts in the first year the site had ${TREND_MIN_TOURNAMENTS} verified tournaments.`,
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
    infoText: `A tournament counts in the band its rank restriction starts at: 10k+ is for players ranked #10,000 and beyond. Starts in the first year the site had ${TREND_MIN_TOURNAMENTS} verified tournaments.`,
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
  strongestFields: {
    icon: Crown,
    title: 'Strongest fields',
    infoText: `Average rating of each tournament's ${FIELD_SIZE} highest-rated players going in`,
  },
  activePlayers: {
    icon: UsersRound,
    title: 'Active players by year',
    infoText: `Players of each year's verified matches. New players played their first in this ruleset that year. Starts in the first year the site had ${TREND_MIN_TOURNAMENTS} verified tournaments.`,
  },
  matchTimes: {
    icon: CalendarClock,
    title: 'When matches are played',
    infoText: 'Start times of every verified match, in UTC',
  },
  mostPlayedBeatmaps: {
    icon: Disc3,
    title: 'Most played beatmaps',
    infoText: `Only beatmaps played in ${MOST_PLAYED_MIN_TOURNAMENTS}+ tournaments`,
  },
  mostPlayedMappers: {
    icon: PenLine,
    title: 'Most played mappers',
    infoText: `A guest difficulty counts for its own mapper. Only mappers played in ${MOST_PLAYED_MIN_TOURNAMENTS}+ tournaments.`,
  },
  mostPlayedArtists: {
    icon: MicVocal,
    title: 'Most played artists',
    infoText: `Only artists played in ${MOST_PLAYED_MIN_TOURNAMENTS}+ tournaments`,
  },
  poolDifficulty: {
    icon: Gauge,
    title: 'Pool difficulty',
    infoText: `Star ratings of beatmaps played without mods, as osu! rated them. A year shows once it has ${POOL_DIFFICULTY_MIN_TOURNAMENTS} tournaments of a kind.`,
  },
  freemodMods: {
    icon: Blend,
    title: 'Mods on freemod maps',
    infoText:
      'A game counts as freemod when a player picked a mod besides No Fail, so one where nobody did reads as nomod',
  },
} as const satisfies Record<string, StatsPanelCopy>;

/** The pool difficulty chart's legend: two kinds of tournament, two measures. */
export const POOL_DIFFICULTY_LABELS = {
  open: 'Open rank',
  restricted: 'Rank-restricted',
  median: 'Median',
  p90: '90th percentile',
} as const;

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
