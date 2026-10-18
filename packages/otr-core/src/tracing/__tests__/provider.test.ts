import { afterEach, describe, expect, it } from 'bun:test';

import { resolveServiceName, shutdownTracing, startTracing } from '../provider';

describe('resolveServiceName', () => {
  const originalName = process.env.OTEL_SERVICE_NAME;

  afterEach(() => {
    if (originalName === undefined) {
      delete process.env.OTEL_SERVICE_NAME;
    } else {
      process.env.OTEL_SERVICE_NAME = originalName;
    }
  });

  it('uses OTEL_SERVICE_NAME when it is set', () => {
    process.env.OTEL_SERVICE_NAME = 'otr-web-preview';
    expect(resolveServiceName('otr-web')).toBe('otr-web-preview');
  });

  it.each(['', '   '])(
    'falls back to the service name when OTEL_SERVICE_NAME is %p',
    (name) => {
      process.env.OTEL_SERVICE_NAME = name;
      expect(resolveServiceName('otr-web')).toBe('otr-web');
    }
  );

  it('falls back to the service name when OTEL_SERVICE_NAME is unset', () => {
    delete process.env.OTEL_SERVICE_NAME;
    expect(resolveServiceName('otr-web')).toBe('otr-web');
  });
});

describe('startTracing', () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const signals = ['SIGTERM', 'SIGINT'] as const;
  const existing = new Map(signals.map((s) => [s, process.listeners(s)]));

  afterEach(async () => {
    await shutdownTracing();
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!existing.get(signal)!.includes(listener)) {
          process.removeListener(signal, listener);
        }
      }
    }
    if (originalEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    }
  });

  const added = (signal: (typeof signals)[number]) =>
    process.listenerCount(signal) - existing.get(signal)!.length;

  // The web server keeps answering requests after SIGTERM while it drains,
  // and flushes their spans itself when it exits.
  it.each([
    [true, 1],
    [false, 0],
  ])(
    'with flushOnSignal %p, adds %p flush per signal',
    (flushOnSignal, count) => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
      expect(
        startTracing({ serviceName: 'otr-test', flushOnSignal })
      ).not.toBeNull();
      expect(signals.map(added)).toEqual([count, count]);
    }
  );
});
