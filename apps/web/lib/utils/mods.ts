import { Mods } from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

import { getModAcronyms, NO_MOD_LABEL } from '@/lib/kit/format/mods';
import { ModsEnumHelper } from '../enum-helpers';

interface BeatmapModScoreCount {
  mods: number;
  scoreCount: number;
}

interface BeatmapModDistributionEntry {
  mods: Mods;
  label: string;
  scoreCount: number;
  percentage: number;
}

const BEATMAP_MOD_DISPLAY_THRESHOLD_PERCENTAGE = 1;
const BEATMAP_LIST_SECOND_MOD_GROUP_MIN_PERCENTAGE = 20;

/** Strips NF/SO and folds NC into DT, the display form of a mod combination. */
export function normalizeBeatmapDisplayMods(mods: number): Mods {
  let normalized = mods & ~Mods.NoFail & ~Mods.SpunOut;

  if (normalized & Mods.Nightcore) {
    normalized = (normalized | Mods.DoubleTime) & ~Mods.Nightcore;
  }

  return normalized as Mods;
}

/**
 * The beatmap pages' label for a combination: the kit's acronyms after the
 * display rules, run together (`HDHR`), or `NM`. Every key mod keeps its
 * name (`7K`), so mania scores never fold into No Mod.
 */
export function getBeatmapModLabel(mods: number): string {
  return (
    getModAcronyms(normalizeBeatmapDisplayMods(mods)).join('') || NO_MOD_LABEL
  );
}

/** Buckets grouped score counts by label and converts them to percentages. */
function aggregateModDistribution(
  rows: BeatmapModScoreCount[],
  categorize: (mods: number) => { mods: Mods; label: string }
): BeatmapModDistributionEntry[] {
  const distributionByLabel = new Map<
    string,
    Omit<BeatmapModDistributionEntry, 'percentage'>
  >();
  let totalScoreCount = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.scoreCount) || row.scoreCount <= 0) continue;

    const category = categorize(row.mods);
    const existing = distributionByLabel.get(category.label);

    distributionByLabel.set(category.label, {
      mods: existing?.mods ?? category.mods,
      label: category.label,
      scoreCount: (existing?.scoreCount ?? 0) + row.scoreCount,
    });
    totalScoreCount += row.scoreCount;
  }

  if (totalScoreCount === 0) return [];

  return Array.from(distributionByLabel.values())
    .map((entry) => ({
      ...entry,
      percentage: (entry.scoreCount / totalScoreCount) * 100,
    }))
    .sort(
      (left, right) =>
        right.scoreCount - left.scoreCount ||
        left.label.localeCompare(right.label)
    );
}

/** Aggregates grouped score counts using the beatmap chart's display rules. */
export function calculateBeatmapModDistribution(
  rows: BeatmapModScoreCount[]
): BeatmapModDistributionEntry[] {
  return aggregateModDistribution(rows, (rawMods) => {
    const mods = normalizeBeatmapDisplayMods(rawMods);
    return { mods, label: getBeatmapModLabel(mods) };
  });
}

/** Collapses a score's mods into the broad category used by the beatmap list. */
function getBeatmapListModCategory(mods: number): {
  mods: Mods;
  label: string;
} {
  const normalizedMods = normalizeBeatmapDisplayMods(mods);

  const hasDoubleTime = Boolean(normalizedMods & Mods.DoubleTime);
  const hasEasy = Boolean(normalizedMods & Mods.Easy);
  const hasHalfTime = Boolean(normalizedMods & Mods.HalfTime);
  const hasHardRock = Boolean(normalizedMods & Mods.HardRock);
  const hasFlashlight = Boolean(normalizedMods & Mods.Flashlight);

  if (hasDoubleTime) {
    return hasEasy
      ? { mods: Mods.DoubleTime | Mods.Easy, label: 'DTEZ' }
      : { mods: Mods.DoubleTime, label: 'DT' };
  }

  if (hasHalfTime) {
    return hasEasy || hasFlashlight
      ? { mods: Mods.None, label: 'Other' }
      : { mods: Mods.HalfTime, label: 'HT' };
  }

  const remainingBaseMods = [hasHardRock, hasEasy, hasFlashlight].filter(
    Boolean
  ).length;

  if (remainingBaseMods > 1) {
    return { mods: Mods.None, label: 'Other' };
  }
  if (hasHardRock) return { mods: Mods.HardRock, label: 'HR' };
  if (hasEasy) return { mods: Mods.Easy, label: 'EZ' };
  if (hasFlashlight) return { mods: Mods.Flashlight, label: 'FL' };

  if (normalizedMods === Mods.None) return { mods: Mods.None, label: 'NM' };
  if (normalizedMods === Mods.Hidden) {
    return { mods: Mods.Hidden, label: 'HD' };
  }

  return { mods: Mods.None, label: 'Other' };
}

/** Aggregates score counts using only the beatmap list's broad mod buckets. */
export function calculateBeatmapListModDistribution(
  rows: BeatmapModScoreCount[]
): BeatmapModDistributionEntry[] {
  return aggregateModDistribution(rows, getBeatmapListModCategory);
}

export const BEATMAP_MOD_OTHER_LABEL = 'Other';

/** Moves every combination below the display threshold into a trailing "Other" slice. */
export function collapseBeatmapModDistribution(
  distribution: BeatmapModDistributionEntry[],
  minimumPercentage = BEATMAP_MOD_DISPLAY_THRESHOLD_PERCENTAGE
): BeatmapModDistributionEntry[] {
  const displayed: BeatmapModDistributionEntry[] = [];
  const collapsed: BeatmapModDistributionEntry[] = [];

  for (const entry of distribution) {
    (entry.percentage >= minimumPercentage ? displayed : collapsed).push(entry);
  }

  if (collapsed.length === 0) return displayed;

  return [
    ...displayed,
    {
      mods: Mods.None,
      label: BEATMAP_MOD_OTHER_LABEL,
      scoreCount: collapsed.reduce(
        (total, { scoreCount }) => total + scoreCount,
        0
      ),
      percentage: collapsed.reduce(
        (total, { percentage }) => total + percentage,
        0
      ),
    },
  ];
}

export function filterBeatmapModDistribution(
  distribution: BeatmapModDistributionEntry[],
  minimumPercentage = BEATMAP_MOD_DISPLAY_THRESHOLD_PERCENTAGE
): BeatmapModDistributionEntry[] {
  return distribution.filter(
    ({ percentage }) => percentage >= minimumPercentage
  );
}

/** The mod groups shown in the beatmap list: the leading one, plus a runner-up above 20%. */
export function selectBeatmapListModGroups<T extends { percentage: number }>(
  groups: readonly T[]
): T[] {
  const [primaryGroup, secondaryGroup] = groups;

  if (!primaryGroup) return [];
  if (
    !secondaryGroup ||
    secondaryGroup.percentage < BEATMAP_LIST_SECOND_MOD_GROUP_MIN_PERCENTAGE
  ) {
    return [primaryGroup];
  }

  return [primaryGroup, secondaryGroup];
}

// ScoreV2 multipliers for the common tournament mods.
const modMultipliers: Record<number, number> = {
  [Mods.HardRock]: 1.1,
  [Mods.Hidden]: 1.06,
  [Mods.DoubleTime]: 1.2,
  [Mods.Nightcore]: 1.2,
  [Mods.Flashlight]: 1.12,
  [Mods.HalfTime]: 1.0 / 3.0,
  [Mods.SpunOut]: 0.9,
};

/** Removes the mod multipliers from a raw score. */
export function normalizedScore(mods: Mods, score: number): number {
  if (score < 0) {
    return 0;
  }

  const flags = ModsEnumHelper.getFlags(mods);
  let multiplier = 1.0;

  for (const [modFlag, modMultiplier] of Object.entries(modMultipliers)) {
    if (flags.includes(Number(modFlag))) {
      multiplier *= modMultiplier;
    }
  }

  return Math.round(score / multiplier);
}

/**
 * The mods a game card's header shows. Outside freemod, the lobby's mods as
 * they are, with No Fail when every score has it. In freemod, the mods every
 * score shares when the scores agree apart from No Fail; otherwise FM and the
 * lobby's forced mods. Lazer games follow the same rules for their lazer
 * mods, which are null when the scores' lazer mods differ.
 */
export function resolveGameDisplayMods(
  game: { isFreeMod: boolean; mods: Mods; lazerMods?: LazerMod[] | null },
  scores: { mods: number; lazerMods?: LazerMod[] | null }[]
): { mods: Mods; lazerMods: LazerMod[] | null; freemod: boolean } {
  if (!game.isFreeMod) {
    // A lobby that records no No Fail while every score has it was still
    // played with it; freemod detection ignores No Fail, so it is the lobby's.
    const everyNoFail =
      scores.length > 0 && scores.every((s) => s.mods & Mods.NoFail);
    return {
      mods: (everyNoFail ? game.mods | Mods.NoFail : game.mods) as Mods,
      lazerMods: game.lazerMods
        ? withNoFail(game.lazerMods, everyNoFail)
        : null,
      freemod: false,
    };
  }

  // No Fail alone doesn't make a freemod game's scores differ.
  const mask = ~Mods.NoFail;
  const uniqueCombos = new Set(scores.map((s) => s.mods & mask));

  if (uniqueCombos.size === 1) {
    const shared = scores.reduce((mods, s) => mods & s.mods, ~0);
    return {
      mods: shared as Mods,
      lazerMods: getSharedLazerMods(scores),
      freemod: false,
    };
  }

  const forced =
    (game.mods & Mods.FreeModAllowed) === Mods.FreeModAllowed
      ? game.mods & ~Mods.FreeModAllowed
      : game.mods;
  // A lazer game's own mods are its required ones, the lobby's forced mods.
  return {
    mods: forced as Mods,
    lazerMods: game.lazerMods ?? null,
    freemod: true,
  };
}

const isNoFail = (mod: LazerMod) => mod.acronym === 'NF';

/** `mods` with No Fail added when `noFail` and not already there. */
function withNoFail(mods: LazerMod[], noFail: boolean): LazerMod[] {
  return noFail && !mods.some(isNoFail) ? [...mods, { acronym: 'NF' }] : mods;
}

/**
 * The lazer mods every score played, when they agree apart from No Fail, with
 * No Fail when every score has it; null when they differ.
 */
function getSharedLazerMods(
  scores: { lazerMods?: LazerMod[] | null }[]
): LazerMod[] | null {
  const lists = scores.map((score) => score.lazerMods);
  if (lists.length === 0 || lists.some((list) => !list)) return null;

  const withoutNoFail = (lists as LazerMod[][]).map((list) =>
    list.filter((mod) => !isNoFail(mod))
  );
  const key = JSON.stringify(withoutNoFail[0]);
  if (!withoutNoFail.every((list) => JSON.stringify(list) === key)) {
    return null;
  }

  return withNoFail(
    withoutNoFail[0],
    (lists as LazerMod[][]).every((list) => list.some(isNoFail))
  );
}

/**
 * The mods a score card shows: those its game's header doesn't already show.
 * None when the score matches the header.
 */
export function getScoreDisplayMods(
  scoreMods: number,
  headerMods: number
): Mods {
  return (scoreMods & ~headerMods) as Mods;
}

/**
 * The lazer mods a score card shows: those the header doesn't already show
 * with the same settings. A score without lazer mods returns null, and one
 * whose header has none keeps its own.
 */
export function getScoreDisplayLazerMods(
  scoreLazerMods: LazerMod[] | null | undefined,
  headerLazerMods: LazerMod[] | null | undefined
): LazerMod[] | null {
  if (!scoreLazerMods) return null;
  if (!headerLazerMods) return scoreLazerMods;

  const shown = new Set(headerLazerMods.map(lazerModKey));
  return scoreLazerMods.filter((mod) => !shown.has(lazerModKey(mod)));
}

const lazerModKey = (mod: LazerMod) =>
  `${mod.acronym} ${JSON.stringify(mod.settings ?? {})}`;

/** Whether per-score mods diverge from a game that records no mods of its own. */
function hasModsVaryingFromGame(
  gameMods: number,
  scores: { mods: number }[]
): boolean {
  if (gameMods !== Mods.None) return false;
  const mask = ~Mods.NoFail;
  return scores.some((s) => (s.mods & mask) !== (gameMods & mask));
}

/** Freemod when the game carries the flag, or its scores' mods vary from its own. */
export function deriveGameIsFreeMod(
  gameMods: number,
  scores: { mods: number }[]
): boolean {
  return (
    (gameMods & Mods.FreeModAllowed) === Mods.FreeModAllowed ||
    hasModsVaryingFromGame(gameMods, scores)
  );
}
