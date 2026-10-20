import { describe, expect, it } from 'bun:test';

import { allowanceRetryAfterSeconds } from '../api-allowance';

// A regular user's 60 requests a minute refill one request a second. A call
// needs one free: while the allowance is full again within 59 seconds, at
// least one is.
describe('allowanceRetryAfterSeconds', () => {
  it.each([
    ['full', 0, 0],
    ['59 requests owed, one free', 59_000, 0],
    ['just over 59 owed', 59_001, 1],
    ['a full minute owed', 60_000, 1],
    // 1,000 lookups: 1,000 s owed, the next request free after 941 s
    ['1,000 lookups owed', 1_000_000, 941],
  ])('%s', (_label, msUntilFull, expected) => {
    expect(allowanceRetryAfterSeconds(msUntilFull)).toBe(expected);
  });
});
