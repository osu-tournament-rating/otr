/**
 * osu-web's mod badges, mirrored one to one: each mod's name, type and glyph
 * from osu-web's `database/mods.json`, and each type's badge colour from its
 * `mod.less`. The artwork lives in `public/icons/mods/`; see its README for
 * the osu-web commit this mirrors.
 */

import { Mods } from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

import { formatNumber } from '@/lib/kit/format/number';
import { getLazerModSpeed, MOD_ACRONYMS } from '@/lib/kit/format/mods';

export type ModType =
  | 'Automation'
  | 'Conversion'
  | 'DifficultyIncrease'
  | 'DifficultyReduction'
  | 'Fun'
  | 'System';

/**
 * The badge fill for each mod type, as osu-web's `@osu-colour-*-1`
 * variables (hue, 100% saturation, 70% lightness) and `@yellow` resolve.
 * osu-web uses the same colours on every background, so there is no light
 * or dark variant.
 */
export const MOD_TYPE_COLORS: Readonly<Record<ModType, string>> = {
  Automation: 'hsl(200, 100%, 70%)',
  Conversion: 'hsl(255, 100%, 70%)',
  DifficultyIncrease: 'hsl(360, 100%, 70%)',
  DifficultyReduction: 'hsl(90, 100%, 70%)',
  Fun: 'hsl(333, 100%, 70%)',
  System: '#ffcc22',
};

/**
 * The freemod badge's fill: osu-web's `@osu-colour-green-1`, the same 70%
 * lightness step as the type colours, in the one hue of that family no mod
 * type uses that isn't next to System's yellow.
 */
export const FREEMOD_COLOR = 'hsl(125, 100%, 70%)';

/**
 * The glyph colour on a badge: its fill 10% of the way from black, mixed in
 * linear sRGB as osu-web and osu!lazer do.
 */
export function getModGlyphColor(fill: string): string {
  return `color-mix(in srgb-linear, black, ${fill} 10%)`;
}

export interface ModBadge {
  name: string;
  type: ModType;
  /** The glyph's file, `mod-<glyph>.svg`. Without one, the badge shows its acronym. */
  glyph?: string;
  /** A fill other than the type's, for a badge that isn't a mod (freemod). */
  color?: string;
}

/** Every lazer mod osu-web draws a glyph for, by acronym. */
export const MOD_BADGES: Readonly<Record<string, ModBadge>> = {
  '10K': { name: 'Ten Keys', type: 'Conversion', glyph: 'ten-keys' },
  '1K': { name: 'One Key', type: 'Conversion', glyph: 'one-key' },
  '2K': { name: 'Two Keys', type: 'Conversion', glyph: 'two-keys' },
  '3K': { name: 'Three Keys', type: 'Conversion', glyph: 'three-keys' },
  '4K': { name: 'Four Keys', type: 'Conversion', glyph: 'four-keys' },
  '5K': { name: 'Five Keys', type: 'Conversion', glyph: 'five-keys' },
  '6K': { name: 'Six Keys', type: 'Conversion', glyph: 'six-keys' },
  '7K': { name: 'Seven Keys', type: 'Conversion', glyph: 'seven-keys' },
  '8K': { name: 'Eight Keys', type: 'Conversion', glyph: 'eight-keys' },
  '9K': { name: 'Nine Keys', type: 'Conversion', glyph: 'nine-keys' },
  AC: {
    name: 'Accuracy Challenge',
    type: 'DifficultyIncrease',
    glyph: 'accuracy-challenge',
  },
  AD: { name: 'Approach Different', type: 'Fun', glyph: 'approach-different' },
  AL: { name: 'Alternate', type: 'Conversion', glyph: 'alternate' },
  AP: { name: 'Autopilot', type: 'Automation', glyph: 'autopilot' },
  AS: { name: 'Adaptive Speed', type: 'Fun', glyph: 'adaptive-speed' },
  AT: { name: 'Autoplay', type: 'Automation', glyph: 'autoplay' },
  BL: { name: 'Blinds', type: 'DifficultyIncrease', glyph: 'blinds' },
  BM: { name: 'Bloom', type: 'Fun', glyph: 'bloom' },
  BR: { name: 'Barrel Roll', type: 'Fun', glyph: 'barrel-roll' },
  BU: { name: 'Bubbles', type: 'Fun', glyph: 'bubbles' },
  CL: { name: 'Classic', type: 'Conversion', glyph: 'classic' },
  CN: { name: 'Cinema', type: 'Automation', glyph: 'cinema' },
  CO: { name: 'Cover', type: 'DifficultyIncrease', glyph: 'cover' },
  CS: { name: 'Constant Speed', type: 'Conversion', glyph: 'constant-speed' },
  DA: {
    name: 'Difficulty Adjust',
    type: 'Conversion',
    glyph: 'difficulty-adjust',
  },
  DC: { name: 'Daycore', type: 'DifficultyReduction', glyph: 'daycore' },
  DF: { name: 'Deflate', type: 'Fun', glyph: 'deflate' },
  DP: { name: 'Depth', type: 'Fun', glyph: 'depth' },
  DS: { name: 'Dual Stages', type: 'Conversion', glyph: 'dual-stages' },
  DT: { name: 'Double Time', type: 'DifficultyIncrease', glyph: 'double-time' },
  EZ: { name: 'Easy', type: 'DifficultyReduction', glyph: 'easy' },
  FF: { name: 'Floating Fruits', type: 'Fun', glyph: 'floating-fruits' },
  FI: { name: 'Fade In', type: 'DifficultyIncrease', glyph: 'fade-in' },
  FL: { name: 'Flashlight', type: 'DifficultyIncrease', glyph: 'flashlight' },
  FR: { name: 'Freeze Frame', type: 'Fun', glyph: 'freeze-frame' },
  GR: { name: 'Grow', type: 'Fun', glyph: 'grow' },
  HD: { name: 'Hidden', type: 'DifficultyIncrease', glyph: 'hidden' },
  HO: { name: 'Hold Off', type: 'Conversion', glyph: 'hold-off' },
  HR: { name: 'Hard Rock', type: 'DifficultyIncrease', glyph: 'hard-rock' },
  HT: { name: 'Half Time', type: 'DifficultyReduction', glyph: 'half-time' },
  IN: { name: 'Invert', type: 'Conversion', glyph: 'invert' },
  MF: { name: 'Moving Fast', type: 'Fun', glyph: 'moving-fast' },
  MG: { name: 'Magnetised', type: 'Fun', glyph: 'magnetised' },
  MR: { name: 'Mirror', type: 'Conversion', glyph: 'mirror' },
  MU: { name: 'Muted', type: 'Fun', glyph: 'muted' },
  NC: { name: 'Nightcore', type: 'DifficultyIncrease', glyph: 'nightcore' },
  NF: { name: 'No Fail', type: 'DifficultyReduction', glyph: 'no-fail' },
  NR: { name: 'No Release', type: 'DifficultyReduction', glyph: 'no-release' },
  NS: { name: 'No Scope', type: 'Fun', glyph: 'no-scope' },
  PF: { name: 'Perfect', type: 'DifficultyIncrease', glyph: 'perfect' },
  RD: { name: 'Random', type: 'Conversion', glyph: 'random' },
  RP: { name: 'Repel', type: 'Fun', glyph: 'repel' },
  RX: { name: 'Relax', type: 'Automation', glyph: 'relax' },
  SD: {
    name: 'Sudden Death',
    type: 'DifficultyIncrease',
    glyph: 'sudden-death',
  },
  SG: { name: 'Single Tap', type: 'Conversion', glyph: 'single-tap' },
  SI: { name: 'Spin In', type: 'Fun', glyph: 'spin-in' },
  SO: { name: 'Spun Out', type: 'Automation', glyph: 'spun-out' },
  SR: {
    name: 'Simplified Rhythm',
    type: 'DifficultyReduction',
    glyph: 'simplified-rhythm',
  },
  ST: {
    name: 'Strict Tracking',
    type: 'DifficultyIncrease',
    glyph: 'strict-tracking',
  },
  SV2: { name: 'Score V2', type: 'System', glyph: 'score-v2' },
  SW: { name: 'Swap', type: 'Conversion', glyph: 'swap' },
  SY: { name: 'Synesthesia', type: 'Fun', glyph: 'synesthesia' },
  TC: { name: 'Traceable', type: 'DifficultyIncrease', glyph: 'traceable' },
  TD: { name: 'Touch Device', type: 'System', glyph: 'touch-device' },
  TP: { name: 'Target Practice', type: 'Conversion', glyph: 'target-practice' },
  TR: { name: 'Transform', type: 'Fun', glyph: 'transform' },
  WD: { name: 'Wind Down', type: 'Fun', glyph: 'wind-down' },
  WG: { name: 'Wiggle', type: 'Fun', glyph: 'wiggle' },
  WU: { name: 'Wind Up', type: 'Fun', glyph: 'wind-up' },
};

/**
 * Key co-op's badge. osu!lazer plays it as Dual Stages; its legacy acronym,
 * CO, is lazer's Cover, so `toLazerAcronym` cannot map it.
 */
const KEY_COOP_ACRONYM = 'DS';

/**
 * The badges a combination draws, one per stored flag in bit order, in
 * lazer's acronyms, after FM when `freemod`. Nightcore and Perfect stand for
 * the Double Time and Sudden Death they imply, as in osu!.
 */
export function getModBadgeAcronyms(mods: number, freemod = false): string[] {
  let shown = mods;
  if (shown & Mods.Nightcore) shown &= ~Mods.DoubleTime;
  if (shown & Mods.Perfect) shown &= ~Mods.SuddenDeath;

  const acronyms = MOD_ACRONYMS.filter(([flag]) => shown & flag).map(
    ([flag, acronym]) =>
      flag === Mods.KeyCoop ? KEY_COOP_ACRONYM : toLazerAcronym(acronym)
  );
  return freemod ? ['FM', ...acronyms] : acronyms;
}

/** One badge to draw, with the custom speed of a rate mod such as DT 1.2x. */
export interface ModBadgeEntry {
  acronym: string;
  speed: number | null;
}

/**
 * The badges to draw. A lazer list, when there is one, is drawn instead of
 * the flags, in play order with its lazer-only mods and custom speeds, since
 * the flags hold neither.
 */
export function getModBadgeEntries(
  mods: number,
  lazerMods: readonly LazerMod[] | null | undefined,
  freemod = false
): ModBadgeEntry[] {
  if (!lazerMods) {
    return getModBadgeAcronyms(mods, freemod).map((acronym) => ({
      acronym,
      speed: null,
    }));
  }

  const entries = lazerMods.map((mod) => ({
    acronym: mod.acronym,
    speed: getLazerModSpeed(mod),
  }));
  return freemod ? [{ acronym: 'FM', speed: null }, ...entries] : entries;
}

/** A custom speed as osu! writes it: `1.2x`. */
export function formatModSpeed(speed: number): string {
  return `${formatNumber(speed, { maxDecimals: 2 })}x`;
}

/** A badge's full name with its custom speed: `Double Time 1.2x`. */
export function getModEntryName({ acronym, speed }: ModBadgeEntry): string {
  const name = getModName(acronym);
  return speed === null ? name : `${name} ${formatModSpeed(speed)}`;
}

/** A badge's width over its height: osu-web's badge shape is 100 by 70. */
export const MOD_BADGE_ASPECT = 10 / 7;

/**
 * How many badge-wide slots fit in a row `width` wide, for badges `height`
 * tall and `gap` apart.
 */
export function countModBadgeSlots(
  width: number,
  height: number,
  gap: number
): number {
  if (height <= 0) return 0;
  // The small allowance keeps a row that fits exactly from losing a slot to
  // rounding.
  const slots = (width + gap) / (height * MOD_BADGE_ASPECT + gap) + 1e-6;
  return Math.max(0, Math.floor(slots));
}

/**
 * How many of `total` badges a row with room for `slots` shows: all of them,
 * or one fewer than fit so a "+N" chip for the rest takes the last slot. A
 * chip would hide a lone badge in its own space, so one badge always shows.
 */
export function fitModBadges(
  total: number,
  slots: number
): { shown: number; hidden: number } {
  if (total <= Math.max(slots, 1)) return { shown: total, hidden: 0 };

  const shown = Math.max(0, slots - 1);
  return { shown, hidden: total - shown };
}

/** Legacy acronyms that lazer, and so osu-web, spells differently. */
const LAZER_ACRONYMS: Readonly<Record<string, string>> = {
  CM: 'CN',
  V2: 'SV2',
};

/** The lazer acronym for one of otr's legacy ones, which mostly match. */
export function toLazerAcronym(acronym: string): string {
  return LAZER_ACRONYMS[acronym] ?? acronym;
}

/** osu!'s name for the freemod setting, as its wiki writes it. */
export const FREEMOD_NAME = 'Free Mods';

/**
 * A badge's full name, for its tooltip and accessible name. Mod names are
 * proper names, so they keep osu!'s own Title Case ("Spun Out", "Seven
 * Keys"), from osu-web's mod list; FM is osu!'s "Free Mods".
 */
export function getModName(acronym: string): string {
  if (acronym === 'FM') return FREEMOD_NAME;

  return MOD_BADGES[toLazerAcronym(acronym)]?.name ?? acronym;
}
