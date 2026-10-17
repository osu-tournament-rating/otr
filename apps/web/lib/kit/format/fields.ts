/**
 * The glossary: one user-facing name per field, used for labels, column
 * headers, filters, tooltips and audit diffs alike. `legacy` lists the names
 * the site used before, so a search for an old label finds its replacement.
 */

import { EMPTY_VALUE } from './empty';
import { formatCount } from './number';

export interface FieldName {
  /** Sentence case, the default everywhere. */
  label: string;
  /** For narrow table headers and tiles only. */
  short?: string;
  /** Names this one replaces. Never render these. */
  legacy?: readonly string[];
}

export const FIELD_NAMES = {
  // Players and ratings
  rating: { label: 'Rating', short: 'TR' },
  peakRating: { label: 'Peak rating', legacy: ['Highest rating'] },
  ratingChange: { label: 'Rating change', short: 'Change' },
  volatility: { label: 'Volatility' },
  percentile: { label: 'Percentile' },
  globalRank: {
    label: 'Global rank',
    short: 'Rank',
    legacy: ['Global', 'Global Rank'],
  },
  countryRank: { label: 'Country rank', short: 'Country' },
  osuRank: { label: 'osu! rank', legacy: ['osu! Global Rank'] },
  tier: { label: 'Tier' },
  matchCost: { label: 'Match cost', legacy: ['Match Cost'] },
  winRate: { label: 'Win rate', legacy: ['Win rate %'] },
  tournamentsPlayed: { label: 'Tournaments played', short: 'Tournaments' },
  matchesPlayed: { label: 'Matches', legacy: ['Matches played'] },
  gamesPlayed: { label: 'Games played', short: 'Games' },

  // Tournaments
  ruleset: { label: 'Ruleset', legacy: ['Game mode', 'Mode'] },
  rankRange: {
    label: 'Rank restriction',
    legacy: ['Rank range', 'Rank Range'],
  },
  lobbySize: {
    label: 'Lobby size',
    legacy: ['Team size', 'Team Size', 'Lobby Size'],
  },
  abbreviation: { label: 'Abbreviation' },
  forumUrl: {
    label: 'Forum post URL',
    legacy: ['Forum URL'],
  },
  dates: { label: 'Dates' },
  startTime: { label: 'Start time', legacy: ['Start Time'] },
  endTime: { label: 'End time', legacy: ['End Time'] },
  isLazer: { label: 'Lazer' },
  verificationStatus: {
    label: 'Verification status',
    short: 'Status',
    legacy: ['Verification Status'],
  },
  rejectionReason: {
    label: 'Rejection reason',
    legacy: ['Rejection Reason'],
  },
  warningFlags: { label: 'Warnings', legacy: ['Warning Flags'] },
  submittedBy: { label: 'Submitted by', legacy: ['Submitted By'] },
  verifiedBy: { label: 'Verified by', legacy: ['Verified By'] },
  created: { label: 'Created' },

  // Matches, games and scores
  osuId: { label: 'osu! ID' },
  scoringType: { label: 'Scoring type', legacy: ['Scoring Type'] },
  teamType: { label: 'Team type', legacy: ['Team Type'] },
  team: { label: 'Team' },
  mods: { label: 'Mods' },
  lazerMods: { label: 'Lazer mods' },
  score: { label: 'Score' },
  placement: { label: 'Placement' },
  accuracy: { label: 'Accuracy', short: 'Acc' },
  maxCombo: { label: 'Max combo', legacy: ['Max Combo'] },
  grade: { label: 'Grade' },

  // Beatmaps
  difficulty: { label: 'Difficulty' },
  mappers: { label: 'Mappers', legacy: ['Creators'] },
  starRating: {
    label: 'Star rating',
    short: 'SR',
    legacy: ['Star Rating'],
  },
  bpm: { label: 'BPM' },
  totalLength: { label: 'Length', legacy: ['Total Length', 'Total length'] },
  drainLength: {
    label: 'Drain length',
    short: 'Drain',
    legacy: ['Drain Length'],
  },
  circleSize: { label: 'Circle size', short: 'CS' },
  approachRate: { label: 'Approach rate', short: 'AR' },
  overallDifficulty: { label: 'Overall difficulty', short: 'OD' },
  hpDrain: { label: 'HP drain', short: 'HP' },
  keyCount: { label: 'Key count', short: 'Keys' },
  rankedStatus: { label: 'Ranked status', legacy: ['Ranked Status'] },
} as const satisfies Record<string, FieldName>;

export type FieldKey = keyof typeof FIELD_NAMES;

/** The glossary label for a field: `fieldLabel('lobbySize')` is `Lobby size`. */
export function fieldLabel(
  key: FieldKey,
  { short = false }: { short?: boolean } = {}
): string {
  const entry: FieldName = FIELD_NAMES[key];
  return short && entry.short ? entry.short : entry.label;
}

/** `rankRangeLowerBound` of 1 means anyone can play. */
export const OPEN_RANK_LABEL = 'Open rank';

/** A tournament's rank restriction: `Open rank`, or `10,000+` for a lower bound. */
export function formatRankRange(
  lowerBound: number | null | undefined,
  { empty = EMPTY_VALUE }: { empty?: string } = {}
): string {
  if (typeof lowerBound !== 'number' || !Number.isFinite(lowerBound)) {
    return empty;
  }
  if (lowerBound <= 1) return OPEN_RANK_LABEL;
  return `${formatCount(lowerBound)}+`;
}

/** A lobby size as players say it: `1v1`, `4v4`. */
export function formatLobbySize(
  size: number | null | undefined,
  { empty = EMPTY_VALUE }: { empty?: string } = {}
): string {
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    return empty;
  }
  return `${size}v${size}`;
}

/** Turns a raw field name into sentence case: `drainLength` reads `Drain length`. */
export function humanizeFieldName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
