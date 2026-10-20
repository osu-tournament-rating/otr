import { afterEach, describe, expect, it } from 'bun:test';
import { ProxyTracerProvider, trace } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

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
  const variables = [
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_RESOURCE_ATTRIBUTES',
  ] as const;
  const original = new Map(variables.map((v) => [v, process.env[v]]));
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
    for (const [variable, value] of original) {
      if (value === undefined) {
        delete process.env[variable];
      } else {
        process.env[variable] = value;
      }
    }
  });

  const start = (options: { flushOnSignal?: boolean } = {}) => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:1';
    const provider = startTracing({ serviceName: 'otr-test', ...options });
    expect(provider).not.toBeNull();
    return provider!;
  };

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
      start({ flushOnSignal });
      expect(signals.map(added)).toEqual([count, count]);
    }
  );

  // The two web containers share a service name; service.instance.id from
  // OTEL_RESOURCE_ATTRIBUTES tells their spans apart.
  it('adds the attributes in OTEL_RESOURCE_ATTRIBUTES to every span', () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      'service.instance.id=otr-web-standby';
    const span = start()
      .getTracer('test')
      .startSpan('span') as unknown as ReadableSpan;
    expect(span.resource.attributes['service.instance.id']).toBe(
      'otr-web-standby'
    );
    expect(span.resource.attributes['service.name']).toBe('otr-test');
  });

  // Next.js records each request's address as http.target on its own server
  // span, and a query string can carry a search term or a call's whole input
  it.each([
    [
      '/rpc/search/query?data=%7B%22searchKey%22%3A%22Stage%22%7D',
      '/rpc/search/query',
    ],
    ['/players?q=Stage', '/players'],
    ['/players', '/players'],
  ])('records the request target %p as %p', (target, recorded) => {
    const span = start()
      .getTracer('test')
      .startSpan('GET', {
        attributes: { 'http.target': target },
      }) as unknown as ReadableSpan;
    expect(span.attributes['http.target']).toBe(recorded);
  });

  // Otherwise the API refuses the second registration as a duplicate, and
  // spans keep going to the provider that was shut down.
  it('registers a provider started after shutdown as the global one', async () => {
    start();
    await shutdownTracing();
    const restarted = start();
    expect(
      (trace.getTracerProvider() as ProxyTracerProvider).getDelegate()
    ).toBe(restarted);
  });
});
