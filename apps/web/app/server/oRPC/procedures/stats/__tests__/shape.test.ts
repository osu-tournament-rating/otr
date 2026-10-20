import { describe, expect, it } from 'bun:test';

import {
  COUNTRY_BAR_LIMIT,
  bandRankRestrictions,
  summarizeCountries,
  tabulateMatchStartTimes,
} from '../shape';

describe('summarizeCountries', () => {
  it('keeps the countries with the most players and totals every country', () => {
    const rows = Array.from({ length: COUNTRY_BAR_LIMIT + 2 }, (_, index) => ({
      country: `C${String(index).padStart(2, '0')}`,
      players: index + 1,
    }));

    const summary = summarizeCountries(rows);

    expect(summary.countries).toHaveLength(COUNTRY_BAR_LIMIT);
    expect(summary.countries[0]).toEqual({ country: 'C11', players: 12 });
    expect(summary.countries.at(-1)).toEqual({ country: 'C02', players: 3 });
    expect(summary.countryCount).toBe(COUNTRY_BAR_LIMIT + 2);
    // 1 + 2 + … + 12
    expect(summary.players).toBe(78);
  });

  it('orders countries with as many players by code', () => {
    const summary = summarizeCountries([
      { country: 'US', players: 4 },
      { country: 'KR', players: 4 },
    ]);
    expect(summary.countries.map((row) => row.country)).toEqual(['KR', 'US']);
  });
});

describe('bandRankRestrictions', () => {
  it('adds up each year in its bands, with every band present', () => {
    expect(
      bandRankRestrictions([
        { year: 2025, rankRangeLowerBound: 1, tournaments: 4 },
        { year: 2024, rankRangeLowerBound: 1, tournaments: 3 },
        { year: 2024, rankRangeLowerBound: 999, tournaments: 1 },
        { year: 2024, rankRangeLowerBound: 1_000, tournaments: 2 },
        { year: 2024, rankRangeLowerBound: 5_000, tournaments: 2 },
        { year: 2024, rankRangeLowerBound: 99_999, tournaments: 1 },
        { year: 2024, rankRangeLowerBound: 100_000, tournaments: 6 },
      ])
    ).toEqual([
      {
        year: 2024,
        bands: { open: 3, lt1k: 1, '1kPlus': 4, '10kPlus': 1, '100kPlus': 6 },
      },
      {
        year: 2025,
        bands: { open: 4, lt1k: 0, '1kPlus': 0, '10kPlus': 0, '100kPlus': 0 },
      },
    ]);
  });

  it('leaves out a lower bound below 1, which no band holds', () => {
    expect(
      bandRankRestrictions([
        { year: 2024, rankRangeLowerBound: 0, tournaments: 2 },
      ])
    ).toEqual([]);
  });
});

describe('tabulateMatchStartTimes', () => {
  it('places each count at its weekday and hour, Monday first, and totals them', () => {
    const { matches, weekdays } = tabulateMatchStartTimes([
      { weekday: 1, hour: 0, matches: 3 },
      { weekday: 7, hour: 23, matches: 5 },
    ]);

    expect(matches).toBe(8);
    expect(weekdays).toHaveLength(7);
    expect(weekdays.every((day) => day.length === 24)).toBe(true);
    expect(weekdays[0]?.[0]).toBe(3);
    expect(weekdays[6]?.[23]).toBe(5);
    expect(weekdays.flat().filter((value) => value > 0)).toHaveLength(2);
  });
});
