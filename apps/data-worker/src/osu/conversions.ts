import {
  Mods,
  Ruleset,
  ScoringType,
  ScoreGrade,
  Team,
  TeamType,
} from '@otr/core/osu/enums';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

type ModLike =
  | string
  | { acronym?: string | null; settings?: Record<string, unknown> | null }
  | null
  | undefined;

/**
 * Acronyms to stable mod flags, for both stable and lazer scores. Two lazer
 * acronyms map onto stable flags: Daycore (DC) and lazer's Cinema (CN). Every
 * other lazer-only mod, such as Difficulty Adjust (DA), Classic (CL), Barrel
 * Roll (BR) or Ten Keys (10K), has no flag and is dropped here; it is kept in
 * the score's lazer mods instead (`normalizeLazerMods`).
 */
const MOD_MAP: Record<string, Mods> = {
  NF: Mods.NoFail,
  EZ: Mods.Easy,
  TD: Mods.TouchDevice,
  HD: Mods.Hidden,
  HR: Mods.HardRock,
  SD: Mods.SuddenDeath,
  DT: Mods.DoubleTime,
  RX: Mods.Relax,
  HT: Mods.HalfTime,
  // Daycore (lazer only): Half Time with lowered pitch.
  DC: Mods.HalfTime,
  NC: Mods.Nightcore,
  FL: Mods.Flashlight,
  AT: Mods.Autoplay,
  AP: Mods.Relax2,
  SO: Mods.SpunOut,
  PF: Mods.Perfect,
  '4K': Mods.Key4,
  '5K': Mods.Key5,
  '6K': Mods.Key6,
  '7K': Mods.Key7,
  '8K': Mods.Key8,
  FI: Mods.FadeIn,
  RD: Mods.Random,
  CM: Mods.Cinema,
  // Cinema (lazer's acronym; stable uses CM).
  CN: Mods.Cinema,
  TP: Mods.Target,
  '9K': Mods.Key9,
  CO: Mods.KeyCoop,
  '1K': Mods.Key1,
  '2K': Mods.Key2,
  '3K': Mods.Key3,
  MR: Mods.Mirror,
};

const SCORING_TYPE_MAP: Record<string, ScoringType> = {
  score: ScoringType.Score,
  accuracy: ScoringType.Accuracy,
  combo: ScoringType.Combo,
  scorev2: ScoringType.ScoreV2,
};

const TEAM_TYPE_MAP: Record<string, TeamType> = {
  'head-to-head': TeamType.HeadToHead,
  'tag-coop': TeamType.TagCoop,
  'team-vs': TeamType.TeamVs,
  'tag-team-vs': TeamType.TagTeamVs,
};

const TEAM_MAP: Record<string, Team> = {
  none: Team.NoTeam,
  blue: Team.Blue,
  red: Team.Red,
};

const SCORE_GRADE_MAP: Record<string, ScoreGrade> = {
  XH: ScoreGrade.SSH,
  X: ScoreGrade.SS,
  SH: ScoreGrade.SH,
  S: ScoreGrade.S,
  A: ScoreGrade.A,
  B: ScoreGrade.B,
  C: ScoreGrade.C,
  D: ScoreGrade.D,
  F: ScoreGrade.D,
};

const BEATMAP_RANK_STATUS_MAP: Record<string, number> = {
  graveyard: -2,
  wip: -1,
  pending: 0,
  ranked: 1,
  approved: 2,
  qualified: 3,
  loved: 4,
};

export const convertModsToFlags = (
  mods: ModLike[] | undefined | null
): Mods => {
  if (!mods || mods.length === 0) {
    return Mods.None;
  }

  return mods.reduce<Mods>((acc, mod) => {
    let acronym: string | null = null;

    if (typeof mod === 'string') {
      acronym = mod;
    } else if (mod && typeof mod.acronym === 'string') {
      acronym = mod.acronym;
    }

    if (!acronym) {
      return acc;
    }

    const upper = acronym.toUpperCase();
    const bit = MOD_MAP[upper];
    if (bit !== undefined) {
      return (acc | bit) as Mods;
    }
    return acc;
  }, Mods.None);
};

/**
 * A lazer mod list as stored: uppercase acronyms in API order, with settings
 * kept only when the player changed any. Lazer-only mods are kept too, since
 * `convertModsToFlags` has no bit for them.
 */
export const normalizeLazerMods = (
  mods: ModLike[] | undefined | null
): LazerMod[] => {
  const normalized: LazerMod[] = [];

  for (const mod of mods ?? []) {
    if (typeof mod === 'string') {
      if (mod) normalized.push({ acronym: mod.toUpperCase() });
      continue;
    }
    if (!mod || typeof mod.acronym !== 'string' || !mod.acronym) {
      continue;
    }

    const settings = mod.settings;
    normalized.push(
      settings && Object.keys(settings).length > 0
        ? { acronym: mod.acronym.toUpperCase(), settings }
        : { acronym: mod.acronym.toUpperCase() }
    );
  }

  return normalized;
};

export const convertScoringType = (value: string | undefined): ScoringType => {
  if (!value) {
    return ScoringType.Score;
  }

  const scoring = SCORING_TYPE_MAP[value];
  return scoring ?? ScoringType.Score;
};

export const convertTeamType = (value: string | undefined): TeamType => {
  if (!value) {
    return TeamType.HeadToHead;
  }

  const mapped = TEAM_TYPE_MAP[value];
  return mapped ?? TeamType.HeadToHead;
};

export const convertTeam = (value: string | undefined | null): Team => {
  if (!value) {
    return Team.NoTeam;
  }

  const mapped = TEAM_MAP[value];
  return mapped ?? Team.NoTeam;
};

export const convertScoreGrade = (
  value: string | undefined | null
): ScoreGrade => {
  if (!value) {
    return ScoreGrade.D;
  }

  const upper = value.toUpperCase();
  const mapped = SCORE_GRADE_MAP[upper];
  return mapped ?? ScoreGrade.D;
};

export const convertBeatmapRankStatus = (
  value: string | number | undefined | null
): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const mapped = BEATMAP_RANK_STATUS_MAP[value.toLowerCase()];
    if (mapped !== undefined) {
      return mapped;
    }
  }

  return 0;
};

export const convertRuleset = (
  value: number | string | undefined | null
): Ruleset => {
  if (typeof value === 'number') {
    switch (value) {
      case Ruleset.Osu:
      case Ruleset.Taiko:
      case Ruleset.Catch:
      case Ruleset.ManiaOther:
        return value;
      default:
        return Ruleset.Osu;
    }
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    switch (normalized) {
      case 'osu':
        return Ruleset.Osu;
      case 'taiko':
        return Ruleset.Taiko;
      case 'fruits':
      case 'catch':
        return Ruleset.Catch;
      case 'mania':
        return Ruleset.ManiaOther;
      default:
        return Ruleset.Osu;
    }
  }

  return Ruleset.Osu;
};

export const normalizeDate = (
  value: string | Date | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

export const calculateScoreWithMods = (
  rawScore: number,
  mods: Mods
): number => {
  if (!Number.isFinite(rawScore)) {
    return 0;
  }

  if ((mods & Mods.Easy) === Mods.Easy) {
    return Math.round(rawScore * 1.75);
  }

  return rawScore;
};
