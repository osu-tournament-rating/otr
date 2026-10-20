import { describe, expect, it } from 'bun:test';

import { allowanceRetryAfterSeconds } from '../api-allowance';

// 1,000 requests a minute refill one request every 60 ms. A call needs one
// free: while the allowance is full again within 59.94 s, at least one is.
describe('allowanceRetryAfterSeconds', () => {
  it.each([
    ['full', 0, 0],
    ['999 requests owed, one free', 59_940, 0],
    ['just over 999 owed', 59_941, 1],
    ['a full minute owed', 60_000, 1],
    // 2,000 lookups: 120 s owed, the next request free after 60.06 s
    ['2,000 lookups owed', 120_000, 61],
  ])('%s', (_label, msUntilFull, expected) => {
    expect(allowanceRetryAfterSeconds(msUntilFull)).toBe(expected);
  });
});
