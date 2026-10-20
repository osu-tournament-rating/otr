import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { createLogger } from '../logger';

describe('createLogger', () => {
  const originalLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
  });

  it.each(['', '   '])('logs at info when LOG_LEVEL is %p', (level) => {
    process.env.LOG_LEVEL = level;
    const info = spyOn(console, 'info').mockImplementation(() => {});

    try {
      const logger = createLogger('test');
      logger.debug('hidden');
      logger.info('shown');

      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]?.[0])).toContain('message=shown');
    } finally {
      info.mockRestore();
    }
  });

  // Grafana reads each line with logfmt, so a stack that spills across lines,
  // or JSON left unquoted, can't be read back as one field
  it("writes an error's stack as one logfmt field on one line", () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});

    try {
      const thrown = new Error('lookup failed: "osu" said no');
      createLogger('test').error('request failed', { error: thrown });

      expect(error).toHaveBeenCalledTimes(1);
      const line = String(error.mock.calls[0]?.[0]);
      expect(line).not.toContain('\n');
      expect(line).toContain('level=error');

      const field = line.match(/ error=("(?:[^"\\]|\\.)*")/)?.[1];
      expect(field).toBeDefined();
      expect(JSON.parse(JSON.parse(field!))).toEqual({
        name: 'Error',
        message: thrown.message,
        stack: thrown.stack,
      });
    } finally {
      error.mockRestore();
    }
  });
});
