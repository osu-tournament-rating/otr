import { describe, expect, it } from 'bun:test';

import { describeFetchProgress, fetchedPercent } from '../progress';

const progress = (
  counts: Partial<{
    inFlight: number;
    fetched: number;
    notFound: number;
    failed: number;
  }>
) => {
  const { inFlight = 0, fetched = 0, notFound = 0, failed = 0 } = counts;
  return {
    total: inFlight + fetched + notFound + failed,
    inFlight,
    fetched,
    notFound,
    failed,
  };
};

describe('describeFetchProgress', () => {
  it('counts what is still fetching against the total', () => {
    expect(describeFetchProgress(progress({ inFlight: 12, fetched: 28 }))).toBe(
      '12 of 40 still fetching'
    );
    expect(describeFetchProgress(progress({ inFlight: 1, fetched: 3 }))).toBe(
      '1 of 4 still fetching'
    );
  });

  it('says when everything was fetched', () => {
    expect(describeFetchProgress(progress({ fetched: 1204 }))).toBe(
      'All 1,204 fetched'
    );
    expect(describeFetchProgress(progress({ fetched: 1 }))).toBe('1 fetched');
  });

  it('names what was not found or failed once nothing is left', () => {
    expect(
      describeFetchProgress(progress({ fetched: 38, notFound: 1, failed: 1 }))
    ).toBe('38 fetched · 1 not found · 1 failed');
    expect(describeFetchProgress(progress({ fetched: 3, failed: 2 }))).toBe(
      '3 fetched · 2 failed'
    );
  });

  it('has nothing to say about a tournament with none', () => {
    expect(describeFetchProgress(progress({}))).toBeNull();
  });
});

describe('fetchedPercent', () => {
  it('counts every item no longer in flight, whatever came of it', () => {
    expect(
      fetchedPercent(progress({ inFlight: 1, fetched: 2, failed: 1 }))
    ).toBe(75);
  });
});
