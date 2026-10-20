import { describe, expect, it } from 'bun:test';

import { FilteringRequestSchema } from '../filtering';

const request = (count: number) => ({
  ruleset: 0,
  maxRating: 2000,
  osuPlayerIds: Array.from({ length: count }, (_, index) => index + 1),
});

describe('FilteringRequestSchema', () => {
  // The rule the filter page and the Registrant Filtering docs state
  it('accepts up to 1,000 osu! IDs and refuses more', () => {
    expect(FilteringRequestSchema.safeParse(request(1000)).success).toBe(true);
    expect(FilteringRequestSchema.safeParse(request(1001)).success).toBe(false);
  });
});
