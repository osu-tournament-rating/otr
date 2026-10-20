/**
 * The rules behind `StackedBarChart`, several series per category stacked
 * in one column, kept pure so they are unit-tested.
 */
import { getNiceTicks, type NiceTicks } from './ticks';

/** One series in a stack, bottom first. */
export interface StackedBarSeries {
  /** Stable key, the field of each datum's `values` it reads. */
  key: string;
  label: string;
  /** A palette colour (`var(--…)`): the categorical slot of its fixed index. */
  color: string;
}

/** One column: a category and each series' count in it. */
export interface StackedBarDatum {
  /** Stable key, such as the year. */
  key: string;
  /** The category as people read it: `2024`. */
  label: string;
  /** A count per series key; a missing series counts zero. */
  values: Readonly<Record<string, number>>;
  /**
   * What a share is out of, when it is more than the series add up to, such
   * as every tournament for a lazer share. Defaults to their sum.
   */
  total?: number;
}

/**
 * `count` stacks the counts. `share` stacks each count as a percentage of
 * the column's total, so a full stack reaches 100%.
 */
export type StackedBarMode = 'count' | 'share';

/** A datum as the chart draws it: each series' plotted value by key. */
export interface StackedBarRow {
  key: string;
  label: string;
  datum: StackedBarDatum;
  [seriesKey: string]: unknown;
}

function countOf(datum: StackedBarDatum, key: string): number {
  const value = datum.values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The column's total: `total`, or the sum of its series. */
export function getStackedTotal(
  datum: StackedBarDatum,
  series: readonly StackedBarSeries[]
): number {
  if (typeof datum.total === 'number' && Number.isFinite(datum.total)) {
    return datum.total;
  }
  return series.reduce((sum, item) => sum + countOf(datum, item.key), 0);
}

/**
 * Each column's plotted values: the counts, or in `share` mode each count's
 * percentage (0–100) of the column's total. A column with a total of zero
 * plots zero rather than dividing by it.
 */
export function getStackedBarRows(
  data: readonly StackedBarDatum[],
  series: readonly StackedBarSeries[],
  mode: StackedBarMode
): StackedBarRow[] {
  return data.map((datum) => {
    const total = getStackedTotal(datum, series);
    const row: StackedBarRow = { key: datum.key, label: datum.label, datum };

    for (const item of series) {
      const count = countOf(datum, item.key);
      row[item.key] =
        mode === 'count' ? count : total > 0 ? (count / total) * 100 : 0;
    }

    return row;
  });
}

/**
 * Ticks for the value axis, from zero to the tallest stack. A share axis
 * never passes 100%, even when the shares add up to a hair more.
 */
export function getStackedValueTicks(
  rows: readonly StackedBarRow[],
  series: readonly StackedBarSeries[],
  mode: StackedBarMode
): NiceTicks {
  const tallest = Math.max(
    0,
    ...rows.map((row) =>
      series.reduce((sum, item) => sum + Number(row[item.key] ?? 0), 0)
    )
  );

  return mode === 'count'
    ? getNiceTicks(0, tallest, { integer: true })
    : getNiceTicks(0, Math.min(100, tallest));
}
