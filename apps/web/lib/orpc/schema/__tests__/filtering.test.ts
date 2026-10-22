import { describe, expect, it } from 'bun:test';

import { FilteringRequestSchema } from '../filtering';

const request = (count: number) => ({
  ruleset: 0,
  maxRating: 2000,
  osuPlayerIds: Array.from({ length: count }, (_, index) => index + 1),
});

describe('FilteringRequestSchema', () => {
  // An admin's limit, which the Registrant Filtering docs state; the filter
  // holds other users to 1,000
  it('accepts up to 5,000 osu! IDs and refuses more', () => {
    expect(FilteringRequestSchema.safeParse(request(5000)).success).toBe(true);
    expect(FilteringRequestSchema.safeParse(request(5001)).success).toBe(false);
  });
});
