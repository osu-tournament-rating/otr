import { Mods } from '@otr/core/osu';

import { normalizeBeatmapDisplayMods } from '@/lib/utils/mods';

import { CATEGORICAL_OTHER } from './categorical';
import { themeColor, type ThemeColor } from './theme-color';

export interface ModColor extends ThemeColor {
  /** The display label, such as `HDHR`. */
  label: string;
  /** The display combinations this colour stands for. */
  mods: readonly Mods[];
}

function mod(label: string, mods: readonly Mods[]): ModColor {
  return { ...themeColor(`--mod-${label.toLowerCase()}`), label, mods };
}

const KEY_MODS = [
  Mods.Key1,
  Mods.Key2,
  Mods.Key3,
  Mods.Key4,
  Mods.Key5,
  Mods.Key6,
  Mods.Key7,
  Mods.Key8,
  Mods.Key9,
] as const;

/**
 * Mod colors for chart marks, swatches and solid mod pills, one `--mod-*`
 * token in globals.css per entry. Each takes black text as a solid fill
 * (`MOD_FILL_FOREGROUND`).
 */
export const MOD_PALETTE: readonly ModColor[] = [
  mod('NM', [Mods.None]),
  mod('HD', [Mods.Hidden]),
  mod('HR', [Mods.HardRock]),
  mod('DT', [Mods.DoubleTime]),
  mod('HT', [Mods.HalfTime]),
  mod('EZ', [Mods.Easy]),
  mod('FL', [Mods.Flashlight]),
  mod('HDHR', [Mods.Hidden | Mods.HardRock]),
  mod('EZHD', [Mods.Easy | Mods.Hidden]),
  mod('EZDT', [Mods.Easy | Mods.DoubleTime]),
  mod('HDFL', [Mods.Hidden | Mods.Flashlight]),
  mod('HDDT', [Mods.Hidden | Mods.DoubleTime]),
  mod('SD', [Mods.SuddenDeath]),
  mod('TD', [Mods.TouchDevice]),
  mod('RX', [Mods.Relax, Mods.Autoplay, Mods.Relax2]),
  mod('MR', [Mods.Mirror]),
  mod('RD', [Mods.Random]),
  mod('KEY', KEY_MODS),
];

/** Text on a solid mod fill. */
export const MOD_FILL_FOREGROUND = '#000000';

const MOD_COLOR_BY_MODS = new Map<number, ModColor>(
  MOD_PALETTE.flatMap((entry) => entry.mods.map((mods) => [mods, entry]))
);

/**
 * The palette entry for a combination, after the display rules (NF and SO
 * dropped, NC shown as DT). Undefined for combinations without a colour.
 */
export function getModPaletteEntry(mods: number): ModColor | undefined {
  return MOD_COLOR_BY_MODS.get(normalizeBeatmapDisplayMods(mods));
}

/** CSS colour for a mod combination; rare combinations get the "Other" neutral. */
export function getModPaletteColor(mods: number): string {
  return (getModPaletteEntry(mods) ?? CATEGORICAL_OTHER).css;
}
