import { describe, expect, it } from 'bun:test';

import { formatDaysToVerify } from '@/components/stats/stats-data';

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
