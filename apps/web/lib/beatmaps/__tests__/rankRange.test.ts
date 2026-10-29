import { describe, expect, test } from 'bun:test';

import {
  RANK_RANGE_BUCKETS,
  RANK_RANGE_BUCKET_KEYS,
  bucketRankRanges,
  getRankRangeBucketKey,
} from '../rankRange';

describe('getRankRangeBucketKey', () => {
  const cases: Array<[number, ReturnType<typeof getRankRangeBucketKey>]> = [
    [1, 'open'],
    [2, 'lt1k'],
    [999, 'lt1k'],
    [1_000, '1kPlus'],
    [9_999, '1kPlus'],
    [10_000, '10kPlus'],
    [99_999, '10kPlus'],
    [100_000, '100kPlus'],
    [1_000_000, '100kPlus'],
  ];

  test.each(cases)('maps %p to %p', (bound, expected) => {
    expect(getRankRangeBucketKey(bound)).toBe(expected);
  });

  test('returns null for non-positive or non-finite bounds', () => {
    expect(getRankRangeBucketKey(0)).toBeNull();
    expect(getRankRangeBucketKey(-5)).toBeNull();
    expect(getRankRangeBucketKey(Number.NaN)).toBeNull();
    expect(getRankRangeBucketKey(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('RANK_RANGE_BUCKETS', () => {
  test('matches the key order and is contiguous', () => {
    expect(RANK_RANGE_BUCKETS.map((bucket) => bucket.key)).toEqual([
      ...RANK_RANGE_BUCKET_KEYS,
    ]);
    expect(RANK_RANGE_BUCKETS.at(-1)?.maxBound).toBeNull();

    for (let i = 0; i < RANK_RANGE_BUCKETS.length - 1; i++) {
      expect(RANK_RANGE_BUCKETS[i].maxBound).toBe(
        RANK_RANGE_BUCKETS[i + 1].minBound - 1
      );
    }
  });

  test('every bound resolves to the bucket that declares it', () => {
    for (const bucket of RANK_RANGE_BUCKETS) {
      expect(getRankRangeBucketKey(bucket.minBound)).toBe(bucket.key);
      if (bucket.maxBound != null) {
        expect(getRankRangeBucketKey(bucket.maxBound)).toBe(bucket.key);
      }
    }
  });
});

describe('bucket colours', () => {
  test('take categorical slots 1 to 5 in bucket order', () => {
    expect(RANK_RANGE_BUCKETS.map((bucket) => bucket.color)).toEqual([
      'var(--chart-1)',
      'var(--chart-2)',
      'var(--chart-3)',
      'var(--chart-4)',
      'var(--chart-5)',
    ]);
  });
});

describe('bucketRankRanges', () => {
  test('returns all five buckets in display order for no pools', () => {
    expect(bucketRankRanges([])).toEqual([
      { key: 'open', label: 'Open rank', count: 0 },
      { key: 'lt1k', label: '<1k', count: 0 },
      { key: '1kPlus', label: '1k+', count: 0 },
      { key: '10kPlus', label: '10k+', count: 0 },
      { key: '100kPlus', label: '100k+', count: 0 },
    ]);
  });

  test('counts boundary values into the expected buckets', () => {
    const buckets = bucketRankRanges([
      { rankRangeLowerBound: 1 },
      { rankRangeLowerBound: 2 },
      { rankRangeLowerBound: 999 },
      { rankRangeLowerBound: 1_000 },
      { rankRangeLowerBound: 9_999 },
      { rankRangeLowerBound: 10_000 },
      { rankRangeLowerBound: 99_999 },
      { rankRangeLowerBound: 100_000 },
    ]);

    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 2, 2, 2, 1]);
  });

  test('skips malformed bounds instead of misbucketing them', () => {
    const buckets = bucketRankRanges([
      { rankRangeLowerBound: 0 },
      { rankRangeLowerBound: Number.NaN },
      { rankRangeLowerBound: 1 },
    ]);

    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 0, 0, 0, 0]);
  });
});
