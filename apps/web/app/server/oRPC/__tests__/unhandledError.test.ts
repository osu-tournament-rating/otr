import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { call, ORPCError } from '@orpc/server';

import { loggedError } from '@/lib/log-lines.test-utils';

import { publicProcedure } from '../procedures/base';

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

describe('a procedure that throws an unexpected error', () => {
  // Grafana's error panels count only lines that carry a level, and the
  // stack printed as plain text arrived as dozens of loose lines (#1243)
  it('logs the error as one structured line with its stack', async () => {
    const thrown = new Error('pool exhausted');
    const probe = publicProcedure.handler(() => {
      throw thrown;
    });

    const error = await call(probe, undefined, {
      path: ['probe'],
      context: { headers: new Headers() },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ORPCError);
    expect(logError).toHaveBeenCalledTimes(1);
    const line = String(logError.mock.calls[0]![0]);
    expect(line).toContain('level=error');
    expect(line).toContain(' procedure=probe');

    expect(loggedError(line)).toMatchObject({
      message: 'pool exhausted',
      stack: thrown.stack,
    });
  });
});
