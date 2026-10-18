import { describe, expect, test } from 'bun:test';
import {
  parseAdditionalUserInputFromProviderProfile,
  parseUserInput,
} from 'better-auth/db';

import { auth } from '../auth';

// `parseUserInput` is the filter Better Auth's `/update-user` applies to the
// request body before writing the user row.
describe('auth user input', () => {
  test('rejects a client-supplied playerId on update', () => {
    expect(() =>
      parseUserInput(auth.options, { playerId: 1 }, 'update')
    ).toThrow('playerId is not allowed to be set');
  });

  // The OAuth callback filters the osu! profile through this before it
  // creates a new user. It drops playerId, which the user create hook fills
  // in, so it must not require one.
  test('creates a user from an osu! profile without a playerId', () => {
    expect(() =>
      parseAdditionalUserInputFromProviderProfile(
        auth.options,
        { playerId: 1 },
        'create'
      )
    ).not.toThrow();
  });
});
