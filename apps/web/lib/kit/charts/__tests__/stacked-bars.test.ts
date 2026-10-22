import { describe, expect, it } from 'bun:test';

import {
  type StackedBarSeries,
  getStackedBarRows,
  getStackedValueTicks,
} from '@/lib/kit/charts/stacked-bars';

const SERIES: StackedBarSeries[] = [
  { key: 'open', label: 'Open rank', color: 'var(--series-1)' },
  { key: 'restricted', label: 'Restricted', color: 'var(--series-2)' },
];

describe('getStackedBarRows', () => {
  it('stacks the counts as they are in count mode', () => {
    const [row] = getStackedBarRows(
      [{ key: '2024', label: '2024', values: { open: 30, restricted: 10 } }],
      SERIES,
      'count'
    );
    expect([row!.open, row!.restricted]).toEqual([30, 10]);
  });

  it('turns each count into a percentage of the column in share mode', () => {
    const [row] = getStackedBarRows(
      [{ key: '2024', label: '2024', values: { open: 30, restricted: 10 } }],
      SERIES,
      'share'
    );
    expect([row!.open, row!.restricted]).toEqual([75, 25]);
  });

  it('takes a share of the total it is given, beyond the series', () => {
    const [row] = getStackedBarRows(
      [{ key: '2024', label: '2024', values: { open: 5 }, total: 200 }],
      [SERIES[0]!],
      'share'
    );
    expect(row!.open).toBe(2.5);
  });

  it('plots zero for a column with nothing in it, and for a missing series', () => {
    const [row] = getStackedBarRows(
      [{ key: '2024', label: '2024', values: {} }],
      SERIES,
      'share'
    );
    expect([row!.open, row!.restricted]).toEqual([0, 0]);
  });
});

describe('getStackedValueTicks', () => {
  it('covers the tallest stack with whole counts', () => {
    const rows = getStackedBarRows(
      [
        { key: '2023', label: '2023', values: { open: 300, restricted: 113 } },
        { key: '2024', label: '2024', values: { open: 20, restricted: 5 } },
      ],
      SERIES,
      'count'
    );
    const ticks = getStackedValueTicks(rows, SERIES, 'count');

    expect(ticks.max).toBeGreaterThanOrEqual(413);
    expect(ticks.ticks.every(Number.isInteger)).toBe(true);
  });

  it('stops a share axis at 100% when the shares add up to a hair more', () => {
    const rows = getStackedBarRows(
      [
        {
          key: '2024',
          label: '2024',
          values: { open: 100.0000001, restricted: 0 },
          total: 100,
        },
      ],
      SERIES,
      'share'
    );
    expect(getStackedValueTicks(rows, SERIES, 'share').max).toBe(100);
  });
});
