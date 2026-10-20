import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { auth } from '@/lib/auth/auth';
import { loggedError, quotedLogField } from '@/lib/log-lines.test-utils';

let logError: ReturnType<typeof spyOn<typeof console, 'error'>>;
let logInfo: ReturnType<typeof spyOn<typeof console, 'info'>>;

beforeEach(() => {
  logError = spyOn(console, 'error').mockImplementation(() => undefined);
  logInfo = spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  logError.mockRestore();
  logInfo.mockRestore();
});

const onlyLine = (spy: typeof logError) => {
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]).toHaveLength(1);
  return String(spy.mock.calls[0]![0]);
};

describe("Better Auth's logs", () => {
  // Grafana's error panels count only lines that carry a level, so sign-in
  // errors Better Auth printed as plain text never showed there (#1243)
  it('writes an error as one structured line with its stack', async () => {
    const { logger } = await auth.$context;
    const error = new Error('connection terminated');

    logger.error('Failed to create user', error);

    const line = onlyLine(logError);
    expect(line).toContain('level=error');
    expect(line).toContain('message="Failed to create user"');
    expect(loggedError(line)).toMatchObject({
      message: 'connection terminated',
      stack: error.stack,
    });
  });

  // An OAuth callback's query string carries its code and state, and other
  // arguments can be a provider's token response
  it('leaves out query strings and arguments that are not errors', async () => {
    const { logger } = await auth.$context;

    logger.warn('Invalid callbackURL: https://otr.example/auth?code=c0de#s', {
      access_token: 't0ken',
    });

    const line = onlyLine(logInfo);
    expect(line).toContain('level=warn');
    expect(quotedLogField(line, 'message')).toBe(
      'Invalid callbackURL: https://otr.example/auth'
    );
    expect(line).not.toContain('t0ken');
  });
});
