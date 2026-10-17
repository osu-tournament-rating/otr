/**
 * Mod bitflags as the acronyms players know: `HD, HR`. The beatmap pages'
 * display rules (dropping NF and SO, folding NC into DT) live in
 * `@/lib/utils/mods`; this is the faithful form, for audit values and data
 * views where every recorded flag matters. Lazer scores also keep their full
 * mod list, settings included; `formatLazerMods` writes that out.
 */

import { Mods } from '@otr/core/osu';
import type { LazerMod } from '@otr/core/osu/lazer-mods';

import { formatNumber } from './number';

/** One acronym per single-bit mod, in bit order. Composite masks are left out. */
export const MOD_ACRONYMS: ReadonlyArray<readonly [Mods, string]> = [
  [Mods.NoFail, 'NF'],
  [Mods.Easy, 'EZ'],
  [Mods.TouchDevice, 'TD'],
  [Mods.Hidden, 'HD'],
  [Mods.HardRock, 'HR'],
  [Mods.SuddenDeath, 'SD'],
  [Mods.DoubleTime, 'DT'],
  [Mods.Relax, 'RX'],
  [Mods.HalfTime, 'HT'],
  [Mods.Nightcore, 'NC'],
  [Mods.Flashlight, 'FL'],
  [Mods.Autoplay, 'AT'],
  [Mods.SpunOut, 'SO'],
  [Mods.Relax2, 'AP'],
  [Mods.Perfect, 'PF'],
  [Mods.Key4, '4K'],
  [Mods.Key5, '5K'],
  [Mods.Key6, '6K'],
  [Mods.Key7, '7K'],
  [Mods.Key8, '8K'],
  [Mods.FadeIn, 'FI'],
  [Mods.Random, 'RD'],
  [Mods.Cinema, 'CM'],
  [Mods.Target, 'TP'],
  [Mods.Key9, '9K'],
  [Mods.KeyCoop, 'CO'],
  [Mods.Key1, '1K'],
  [Mods.Key3, '3K'],
  [Mods.Key2, '2K'],
  [Mods.ScoreV2, 'V2'],
  [Mods.Mirror, 'MR'],
];

/** No mods at all. */
export const NO_MOD_LABEL = 'NM';

/** Every mod a freemod game allows, set together. */
export const FREEMOD_LABEL = 'Freemod';

/**
 * The acronyms set in `mods`, in bit order: `[HD, HR]`. Nightcore implies
 * Double Time and Perfect implies Sudden Death, so the implied flag is
 * dropped. A value carrying the whole freemod mask reads `Freemod` plus
 * whatever else is set.
 */
export function getModAcronyms(mods: number): string[] {
  let remaining = mods;
  const acronyms: string[] = [];

  if ((remaining & Mods.FreeModAllowed) === Mods.FreeModAllowed) {
    acronyms.push(FREEMOD_LABEL);
    remaining &= ~Mods.FreeModAllowed;
  }
  if (remaining & Mods.Nightcore) remaining &= ~Mods.DoubleTime;
  if (remaining & Mods.Perfect) remaining &= ~Mods.SuddenDeath;

  for (const [flag, acronym] of MOD_ACRONYMS) {
    if (remaining & flag) acronyms.push(acronym);
  }

  return acronyms;
}

/** `HD, HR`, or `NM` when no mod is set. */
export function formatMods(mods: number): string {
  if (!Number.isInteger(mods) || mods < 0) return String(mods);

  const acronyms = getModAcronyms(mods);
  return acronyms.length > 0 ? acronyms.join(', ') : NO_MOD_LABEL;
}

/**
 * A lazer mod's custom speed, such as 1.2 for `DT 1.2x`, or null when it
 * plays at its default rate.
 */
export function getLazerModSpeed(mod: LazerMod): number | null {
  const speed = mod.settings?.speed_change;
  return typeof speed === 'number' && Number.isFinite(speed) ? speed : null;
}

/** `DT 1.2x`: the acronym, then the speed when the player changed it. */
export function formatLazerMod(mod: LazerMod): string {
  const speed = getLazerModSpeed(mod);
  return speed === null
    ? mod.acronym
    : `${mod.acronym} ${formatNumber(speed, { maxDecimals: 2 })}x`;
}

/**
 * Lazer mods in the order they were played, lazer-only mods included:
 * `DT 1.2x, DA, BR`, or `NM` when there are none.
 */
export function formatLazerMods(mods: readonly LazerMod[]): string {
  return mods.length > 0 ? mods.map(formatLazerMod).join(', ') : NO_MOD_LABEL;
}
