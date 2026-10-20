import { describe, expect, it } from 'bun:test';

import { COUNTRY_BAR_LIMIT, summarizeCountries } from '../shape';

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
