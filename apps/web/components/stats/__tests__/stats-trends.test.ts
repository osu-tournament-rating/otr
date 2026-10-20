import { describe, expect, it } from 'bun:test';

import {
  TREND_MIN_TOURNAMENTS,
  formatDaysToVerify,
  getLazerShareBars,
  getTrendYears,
} from '@/components/stats/stats-data';

const ENOUGH = TREND_MIN_TOURNAMENTS;
const TOO_FEW = TREND_MIN_TOURNAMENTS - 1;

describe('getTrendYears', () => {
  it('starts at the first year with enough tournaments and fills the gaps after it', () => {
    const totals = new Map([
      [2016, TOO_FEW],
      [2018, ENOUGH],
      [2021, 1],
    ]);
    expect(getTrendYears(totals)).toEqual([2018, 2019, 2020, 2021]);
  });

  it('is empty when no year has enough', () => {
    expect(getTrendYears(new Map([[2024, TOO_FEW]]))).toEqual([]);
  });
});

describe('getLazerShareBars', () => {
  it('gives each trend year its lazer tournaments out of all of them', () => {
    expect(
      getLazerShareBars([
        { year: 2017, total: 2, lazer: 0 },
        { year: 2025, total: 40, lazer: 0 },
        { year: 2026, total: 20, lazer: 5 },
      ])
    ).toEqual([
      { key: '2025', label: '2025', values: { lazer: 0 }, total: 40 },
      { key: '2026', label: '2026', values: { lazer: 5 }, total: 20 },
    ]);
  });

  it('is null until a lazer tournament is verified', () => {
    expect(getLazerShareBars([{ year: 2025, total: 40, lazer: 0 }])).toBeNull();
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
