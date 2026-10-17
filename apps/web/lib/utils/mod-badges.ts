/**
 * osu-web's mod badges, mirrored one to one: each mod's name, type and glyph
 * from osu-web's `database/mods.json`, and each type's badge colour from its
 * `mod.less`. The artwork lives in `public/icons/mods/`; see its README for
 * the osu-web commit this mirrors.
 */

import { Mods } from '@otr/core/osu';

import { ModsEnumHelper } from '@/lib/enum-helpers';

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
 * The glyph colour on a badge: the type colour 10% of the way from black,
 * mixed in linear sRGB as osu-web and osu!lazer do.
 */
export function getModGlyphColor(type: ModType): string {
  return `color-mix(in srgb-linear, black, ${MOD_TYPE_COLORS[type]} 10%)`;
}

export interface ModBadge {
  name: string;
  type: ModType;
  /** The glyph's file, `mod-<glyph>.svg`. Without one, the badge shows its acronym. */
  glyph?: string;
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
 * The badges a combination draws, in bit order, after FM when `freemod`.
 * Nightcore and Perfect stand for the Double Time and Sudden Death they
 * imply, as in osu!, and mods without an acronym draw nothing.
 */
export function getModBadgeAcronyms(mods: number, freemod = false): string[] {
  let shown = mods;
  if (shown & Mods.Nightcore) shown &= ~Mods.DoubleTime;
  if (shown & Mods.Perfect) shown &= ~Mods.SuddenDeath;

  const acronyms = ModsEnumHelper.getMetadata(shown as Mods)
    .map(({ text }) => text)
    .filter((text) => text !== '');
  return freemod ? ['FM', ...acronyms] : acronyms;
}
