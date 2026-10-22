/**
 * The rules behind `Heatmap`, a grid of cells shaded by their value, kept
 * pure so they are unit-tested.
 */

/** Shades a filled cell can take, faintest to fullest; an empty cell has none. */
export const HEATMAP_STEPS = 5;

/** A cell by its row and column, both 0-based. */
export interface HeatmapCell {
  row: number;
  column: number;
}

/**
 * A cell's shade: 0 for nothing (zero, negative or not a number), otherwise
 * 1 to `steps` by its share of `max`, the grid's largest value, rounded up,
 * so the largest cell takes the fullest shade and any value at all shows.
 */
export function getHeatmapLevel(
  value: number,
  max: number,
  steps = HEATMAP_STEPS
): number {
  if (!(value > 0)) return 0;
  return Math.min(steps, Math.ceil((value / max) * steps));
}

/**
 * How much of the series colour a shade mixes in, 0–100: the fullest shade
 * is the colour itself, and each step below it a fifth (for five steps)
 * less.
 */
export function getHeatmapStrength(
  level: number,
  steps = HEATMAP_STEPS
): number {
  if (level <= 0) return 0;
  return Math.round((Math.min(level, steps) / steps) * 100);
}

/** The largest value in the grid, 0 when it has none. */
export function getHeatmapMax(values: readonly (readonly number[])[]): number {
  let max = 0;
  for (const row of values) {
    for (const value of row) {
      if (value > max) max = value;
    }
  }
  return max;
}

/** The cell with the largest value, the first one on a tie; null when all are empty. */
export function getHeatmapPeak(
  values: readonly (readonly number[])[]
): HeatmapCell | null {
  let peak: HeatmapCell | null = null;
  let max = 0;
  for (const [row, rowValues] of values.entries()) {
    for (const [column, value] of rowValues.entries()) {
      if (value > max) {
        max = value;
        peak = { row, column };
      }
    }
  }
  return peak;
}

/**
 * Where a key moves the active cell in a grid of `rows` by `columns`, as
 * the ARIA grid pattern has it: arrows step one cell and stop at the edges,
 * Home and End go to the row's first and last cell, and with Ctrl to the
 * grid's. Null for any other key.
 */
export function moveHeatmapCell(
  cell: HeatmapCell,
  key: string,
  {
    rows,
    columns,
    ctrlKey = false,
  }: {
    rows: number;
    columns: number;
    ctrlKey?: boolean;
  }
): HeatmapCell | null {
  const clamp = (value: number, size: number) =>
    Math.min(size - 1, Math.max(0, value));

  switch (key) {
    case 'ArrowLeft':
      return { ...cell, column: clamp(cell.column - 1, columns) };
    case 'ArrowRight':
      return { ...cell, column: clamp(cell.column + 1, columns) };
    case 'ArrowUp':
      return { ...cell, row: clamp(cell.row - 1, rows) };
    case 'ArrowDown':
      return { ...cell, row: clamp(cell.row + 1, rows) };
    case 'Home':
      return ctrlKey ? { row: 0, column: 0 } : { ...cell, column: 0 };
    case 'End':
      return ctrlKey
        ? { row: rows - 1, column: columns - 1 }
        : { ...cell, column: columns - 1 };
    default:
      return null;
  }
}
