import { expect } from 'bun:test';

/**
 * A quoted field's value in a structured log line, read the way Grafana's
 * logfmt parser reads it. Fails the test when the field is missing or left
 * unquoted, since logfmt would then split it.
 */
export const quotedLogField = (line: string, key: string): string => {
  const value = line.match(new RegExp(` ${key}=("(?:[^"\\\\]|\\\\.)*")`))?.[1];
  expect(value).toBeDefined();
  return JSON.parse(value!) as string;
};

/** The error a log line carries in its `error` field. */
export const loggedError = (line: string): Record<string, unknown> =>
  JSON.parse(quotedLogField(line, 'error')) as Record<string, unknown>;
