import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { mapAppSessionToUser } from '@/lib/auth/session-utils';
import { loggedError } from '@/lib/log-lines.test-utils';

let logError: ReturnType<typeof spyOn<typeof console, 'error'>>;

beforeEach(() => {
  logError = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logError.mockRestore();
});

describe('mapAppSessionToUser', () => {
  // Every page maps the session, and one that fails shows the visitor as
  // signed out, so Grafana's error panels must count it (#1243)
  it('logs a session it cannot map as one structured error line', () => {
    const session = {
      dbPlayer: { id: 1, osuId: 2, username: 'player', country: null },
    };

    expect(mapAppSessionToUser(session)).toBeNull();

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]).toHaveLength(1);
    const line = String(logError.mock.calls[0]![0]);
    expect(line).toContain('level=error');
    expect(String(loggedError(line).message)).toContain('country');
  });
});
