import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { onRequestError } from '@/instrumentation';
import { loggedError } from '@/lib/log-lines.test-utils';

const env = process.env as Record<string, string | undefined>;
const originalRuntime = env.NEXT_RUNTIME;

let logError: ReturnType<typeof spyOn<typeof console, 'error'>>;

beforeEach(() => {
  env.NEXT_RUNTIME = 'nodejs';
  logError = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logError.mockRestore();
  if (originalRuntime === undefined) {
    delete env.NEXT_RUNTIME;
  } else {
    env.NEXT_RUNTIME = originalRuntime;
  }
});

describe('onRequestError', () => {
  // Grafana's error panels count only lines that carry a level, and Next.js
  // prints a render error as plain text across many lines (#1243)
  it('logs a request error as one structured line with its stack and route', async () => {
    const error = Object.assign(new Error('players could not load'), {
      digest: '2114958291',
    });

    await onRequestError(
      error,
      {
        path: '/players/search?q=Stage',
        method: 'GET',
        headers: { cookie: 'better-auth.session_token=secret' },
      },
      {
        routerKind: 'App Router',
        routePath: '/players/[id]',
        routeType: 'render',
        renderSource: 'react-server-components',
        revalidateReason: undefined,
      }
    );

    expect(logError).toHaveBeenCalledTimes(1);
    const line = String(logError.mock.calls[0]![0]);

    expect(line).toContain('level=error');
    expect(line).toContain(' route=/players/[id]');
    expect(line).toContain(' digest=2114958291');
    expect(loggedError(line)).toMatchObject({
      message: 'players could not load',
      stack: error.stack,
    });
    // The address can hold a visitor's search, and headers their session
    expect(line).not.toContain('Stage');
    expect(line).not.toContain('secret');
  });
});
