import { describe, expect, it } from 'bun:test';

import {
  TREND_MIN_TOURNAMENTS,
  formatDaysToVerify,
  getLazerShareBars,
  getRankRestrictionBars,
  getTrendStartYear,
  getTrendYears,
} from '@/components/stats/stats-data';

const ENOUGH = TREND_MIN_TOURNAMENTS;
const TOO_FEW = TREND_MIN_TOURNAMENTS - 1;

describe('getTrendStartYear', () => {
  it("is the first year the site's verified tournaments reach the minimum", () => {
    expect(
      getTrendStartYear({
        '2015': 1,
        '2017': TOO_FEW,
        '2018': ENOUGH,
        '2019': 3,
        '2020': ENOUGH * 5,
      })
    ).toBe(2018);
  });

  it('is null when no year reaches it', () => {
    expect(getTrendStartYear({ '2024': TOO_FEW })).toBeNull();
  });
});

describe('getTrendYears', () => {
  it('runs from the first year with data at or after the start, filling gaps, however few each year has', () => {
    const totals = new Map([
      [2016, 40],
      [2018, 0],
      [2019, 1],
      [2022, 2],
    ]);
    expect(getTrendYears(totals, 2018)).toEqual([2019, 2020, 2021, 2022]);
  });

  it('is empty without a start year or without data from it on', () => {
    expect(getTrendYears(new Map([[2024, 40]]), null)).toEqual([]);
    expect(getTrendYears(new Map([[2016, 40]]), 2018)).toEqual([]);
  });
});

describe('getLazerShareBars', () => {
  it('gives each trend year its lazer tournaments out of all of them', () => {
    expect(
      getLazerShareBars(
        [
          { year: 2017, total: 2, lazer: 1 },
          { year: 2025, total: 40, lazer: 0 },
          { year: 2026, total: 20, lazer: 5 },
        ],
        2025
      )
    ).toEqual([
      { key: '2025', label: '2025', values: { lazer: 0 }, total: 40 },
      { key: '2026', label: '2026', values: { lazer: 5 }, total: 20 },
    ]);
  });

  it('is null until a lazer tournament is verified', () => {
    expect(
      getLazerShareBars([{ year: 2025, total: 40, lazer: 0 }], 2025)
    ).toBeNull();
  });
});

describe('getRankRestrictionBars', () => {
  it('stacks each trend year by band, keeping a year with few tournaments', () => {
    const bands = (open: number, lt1k = 0) => ({
      open,
      lt1k,
      '1kPlus': 0,
      '10kPlus': 0,
      '100kPlus': 0,
    });

    const bars = getRankRestrictionBars(
      [
        { year: 2017, bands: bands(ENOUGH) },
        { year: 2018, bands: bands(0, 1) },
        { year: 2020, bands: bands(3) },
      ],
      2018
    );

    expect(bars.map((bar) => [bar.label, bar.values])).toEqual([
      ['2018', bands(0, 1)],
      ['2019', {}],
      ['2020', bands(3)],
    ]);
  });
});

describe('formatDaysToVerify', () => {
  it.each([
    [null, '—'],
    [0.4, 'Under a day'],
    [1.2, '1 day'],
    [4.5, '5 days'],
  ] as const)('writes %p as %p', (days, text) => {
    expect(formatDaysToVerify(days)).toBe(text);
  });
});
