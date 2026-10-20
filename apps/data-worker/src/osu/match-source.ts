import type { LazerMod } from '@otr/core/osu/lazer-mods';

/** A player's name and country as an osu! match or room lists them. */
export interface PlayerMeta {
  username?: string;
  country?: string;
}

/** The osu! fields of a game, as stored. */
export interface FetchedGameFields {
  ruleset: number;
  scoringType: number;
  teamType: number;
  mods: number;
  /** Every required mod with its settings; null for a stable game. */
  lazerMods: LazerMod[] | null;
  startTime: string;
  endTime: string;
}

/** The osu! fields of a score, as stored. */
export interface FetchedScoreFields {
  rawScore: number;
  adjustedScore: number | null;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  pass: boolean;
  isPerfectCombo: boolean;
  legacyPerfect: boolean;
  grade: number;
  mods: number;
  /** Every mod with its settings; null for a stable score. */
  lazerMods: LazerMod[] | null;
  statComboBreak: number | null;
  statGreat: number | null;
  statOk: number | null;
  statMeh: number | null;
  statMiss: number | null;
  statGood: number | null;
  statPerfect: number | null;
  statSliderTailHit: number | null;
  statLargeTickHit: number | null;
  statLargeTickMiss: number | null;
  statSmallTickHit: number | null;
  statSmallTickMiss: number | null;
  statLargeBonus: number | null;
  statSmallBonus: number | null;
  statIgnoreHit: number | null;
  statIgnoreMiss: number | null;
  statLegacyComboIncrease: number | null;
  legacyTotalScore: number;
  team: number;
  ruleset: number;
}

export interface FetchedScore {
  osuUserId: number;
  fields: FetchedScoreFields;
}

export interface FetchedGame {
  /** The stable game ID, or the lazer playlist item ID. */
  osuId: number;
  osuBeatmapId: number;
  fields: FetchedGameFields;
  scores: FetchedScore[];
}

/** One osu! match or lazer room, read from the osu! API. */
export interface FetchedMatch {
  name: string | null;
  startTime: string | null;
  endTime: string | null;
  users: Map<number, PlayerMeta>;
  games: FetchedGame[];
  /**
   * The osu! IDs of every game the match lists, including lazer playlist
   * items that were never played. A match already holding any of them took
   * this one's games in a merge.
   */
  listedGameOsuIds: number[];
}

/**
 * The outcome of reading a match from osu!: the match, or why it can't be
 * stored. `invalid` is a room osu! serves but o!TR doesn't store, such as one
 * still in progress.
 */
export type FetchedMatchResult =
  | { status: 'success'; match: FetchedMatch }
  | { status: 'not_found' }
  | { status: 'unauthorized' }
  | { status: 'invalid'; reason: string };
