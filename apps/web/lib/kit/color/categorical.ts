import { themeColor, type ThemeColor } from './theme-color';

export interface CategoricalColor extends ThemeColor {
  /** 1-based slot in the fixed order. */
  slot: number;
  name: string;
}

function slot(index: number, name: string): CategoricalColor {
  return { ...themeColor(`--chart-${index}`), slot: index, name };
}

/**
 * The fixed categorical palette (`--chart-1` to `--chart-8`) for neutral
 * series, rank restriction buckets, teams and the five chart mods. The
 * order keeps neighbours apart for red-green colour blindness (checked with
 * the dataviz palette validator), so assign slots in order and never reorder
 * or cycle them. Slot 1 is the brand blue a single series uses.
 */
export const CATEGORICAL_PALETTE: readonly CategoricalColor[] = [
  slot(1, 'Blue'),
  slot(2, 'Orange'),
  slot(3, 'Aqua'),
  slot(4, 'Yellow'),
  slot(5, 'Magenta'),
  slot(6, 'Green'),
  slot(7, 'Violet'),
  slot(8, 'Red'),
];

/** The neutral a series past the eighth folds into, labelled "Other". */
export const CATEGORICAL_OTHER: ThemeColor = themeColor('--chart-other');

/**
 * The colour of the series at `index` (0-based). Colour follows the series,
 * not its rank, so pass a stable index. Anything past the eighth slot gets
 * the "Other" neutral rather than a repeat.
 */
export function seriesColor(index: number): string {
  return (CATEGORICAL_PALETTE[index] ?? CATEGORICAL_OTHER).css;
}
