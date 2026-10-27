import type { Mods } from '@otr/core/osu';

import {
  CHART_MODS,
  getBeatmapModLabel,
  normalizeBeatmapDisplayMods,
} from '@/lib/utils/mods';

import { CATEGORICAL_OTHER } from './categorical';
import { themeColor, type ThemeColor } from './theme-color';

export interface ModColor extends ThemeColor {
  /** The display label, such as `HD`. */
  label: string;
  /** The display combination this color stands for. */
  mods: Mods;
}

/**
 * The five mods charts color on their own, NM, HD, HR, DT and FL, take
 * `--chart-1` to `--chart-5` in that order. Every other mod or combination is
 * one "Other" group in `--chart-other` (`CATEGORICAL_OTHER`).
 */
export const MOD_PALETTE: readonly ModColor[] = CHART_MODS.map(
  (mods, index) => ({
    ...themeColor(`--chart-${index + 1}`),
    label: getBeatmapModLabel(mods),
    mods,
  })
);

/** Text on a solid mod fill. */
export const MOD_FILL_FOREGROUND = '#000000';

/**
 * The palette entry for a combination, after the display rules (NF and SO
 * dropped, NC shown as DT). Undefined for anything in "Other".
 */
export function getModPaletteEntry(mods: number): ModColor | undefined {
  const display = normalizeBeatmapDisplayMods(mods);
  return MOD_PALETTE.find((entry) => entry.mods === display);
}

/** CSS color for a mod combination; anything in "Other" gets its neutral. */
export function getModPaletteColor(mods: number): string {
  return (getModPaletteEntry(mods) ?? CATEGORICAL_OTHER).css;
}
