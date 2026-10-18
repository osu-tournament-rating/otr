import { describe, expect, it } from 'bun:test';

import { ensureAdminSession } from '../adminGuard';

describe('ensureAdminSession', () => {
  it('returns the admin user for an admin', () => {
    expect(
      ensureAdminSession({ dbUser: { id: 7, scopes: ['admin'] } })
    ).toEqual({ adminUserId: 7, scopes: ['admin'] });
  });

  it('accepts a superadmin', () => {
    expect(
      ensureAdminSession({ dbUser: { id: 7, scopes: ['user', 'superadmin'] } })
    ).toEqual({ adminUserId: 7, scopes: ['user', 'superadmin'] });
  });

  it('refuses a signed-in user without an admin scope', () => {
    for (const scopes of [[], ['user'], ['whitelist'], null]) {
      expect(() => ensureAdminSession({ dbUser: { id: 7, scopes } })).toThrow(
        expect.objectContaining({
          code: 'FORBIDDEN',
          message: 'Admin privileges required',
        })
      );
    }
  });

  it('refuses a request without a session', () => {
    for (const session of [null, undefined]) {
      expect(() => ensureAdminSession(session)).toThrow(
        expect.objectContaining({
          code: 'UNAUTHORIZED',
          message: 'No active session',
        })
      );
    }
  });

  it('refuses a session without a user record', () => {
    for (const dbUser of [null, undefined]) {
      expect(() => ensureAdminSession({ dbUser })).toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' })
      );
    }
  });

  it('refuses an admin scope on a user record without an id', () => {
    expect(() =>
      ensureAdminSession({ dbUser: { id: 0, scopes: ['admin'] } })
    ).toThrow(
      expect.objectContaining({
        code: 'FORBIDDEN',
        message: 'Admin user record missing',
      })
    );
  });
});
