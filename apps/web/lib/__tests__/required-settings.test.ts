import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { register } from '@/instrumentation';

import { exitIfSettingsMissing } from '../required-settings';

const env = process.env as Record<string, string | undefined>;
const original = {
  DATABASE_URL: env.DATABASE_URL,
  NEXT_RUNTIME: env.NEXT_RUNTIME,
};

let exit: ReturnType<typeof spyOn<typeof process, 'exit'>>;
let logError: ReturnType<typeof spyOn<typeof console, 'error'>>;

beforeEach(() => {
  env.NEXT_RUNTIME = 'nodejs';
  // Stops register() where the process would have exited
  exit = spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exited with ${code}`);
  });
  logError = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  exit.mockRestore();
  logError.mockRestore();
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
});

describe('web server startup', () => {
  // Otherwise the database pool connects to PostgreSQL's defaults:
  // localhost:5432 as the operating system user (#1053)
  it.each([undefined, '', '   '])(
    'stops with a message naming DATABASE_URL when it is %p',
    async (value) => {
      if (value === undefined) {
        delete env.DATABASE_URL;
      } else {
        env.DATABASE_URL = value;
      }

      await expect(register()).rejects.toThrow('exited with 1');
      expect(logError).toHaveBeenCalledTimes(1);
      expect(String(logError.mock.calls[0]![0])).toContain(
        'DATABASE_URL is not configured'
      );
    }
  );

  it('carries on with a database URL', () => {
    exitIfSettingsMissing({
      DATABASE_URL: 'postgresql://postgres:password@localhost:5432/postgres',
    });

    expect(exit).not.toHaveBeenCalled();
  });
});
