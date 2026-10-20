import { describe, expect, it } from 'bun:test';

import { formatHourRange } from '@/components/stats/stats-data';

describe('formatHourRange', () => {
  it('writes an hour of the UTC day, wrapping at midnight', () => {
    expect(formatHourRange(9)).toBe('09:00–10:00 UTC');
    expect(formatHourRange(23)).toBe('23:00–00:00 UTC');
  });
});
