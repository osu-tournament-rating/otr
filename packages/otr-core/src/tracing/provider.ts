import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
  propagation,
  trace,
} from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  defaultResource,
  detectResources,
  envDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';
import { optionalEnv } from '../utils/env';

export interface StartTracingOptions {
  /** Fallback when OTEL_SERVICE_NAME is unset. */
  serviceName: string;
  /**
   * Flush and stop on SIGTERM or SIGINT. Off for a process that keeps working
   * after the signal and calls shutdownTracing itself before it exits.
   */
  flushOnSignal?: boolean;
}

let provider: NodeTracerProvider | null = null;

const HTTP_TARGET = 'http.target';

/**
 * Next.js records each request's address, query string included, as
 * http.target on its own server span. A query string can carry a visitor's
 * search terms or a GET call's whole input, and user input never goes on a
 * span, so this keeps only the path.
 */
const dropRequestQueryStrings: SpanProcessor = {
  onStart(span: Span) {
    const target = span.attributes[HTTP_TARGET];
    const query = typeof target === 'string' ? target.indexOf('?') : -1;

    if (query !== -1) {
      span.setAttribute(HTTP_TARGET, (target as string).slice(0, query));
    }
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

const resolveEnvironment = (): string =>
  process.env.NODE_ENV === 'production' ? 'production' : 'development';

export const resolveServiceName = (fallback: string): string =>
  optionalEnv(process.env.OTEL_SERVICE_NAME) ?? fallback;

/**
 * Registers the global tracer provider. Tracing stays off until
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, so local runs and tests are unaffected.
 */
export function startTracing({
  serviceName,
  flushOnSignal = true,
}: StartTracingOptions): NodeTracerProvider | null {
  if (provider) {
    return provider;
  }

  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return null;
  }

  if (process.env.OTEL_LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  provider = new NodeTracerProvider({
    // OTEL_RESOURCE_ATTRIBUTES adds attributes such as service.instance.id,
    // which tells apart containers that run the same service.
    resource: defaultResource()
      .merge(detectResources({ detectors: [envDetector] }))
      .merge(
        resourceFromAttributes({
          [ATTR_SERVICE_NAME]: resolveServiceName(serviceName),
          [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: resolveEnvironment(),
        })
      ),
    spanProcessors: [
      dropRequestQueryStrings,
      new BatchSpanProcessor(new OTLPTraceExporter()),
    ],
  });

  provider.register({
    propagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  });

  if (flushOnSignal) {
    const flush = () => {
      void provider?.shutdown().catch(() => undefined);
    };

    process.once('SIGTERM', flush);
    process.once('SIGINT', flush);
  }

  return provider;
}

/**
 * Flushes and stops the provider, and unregisters the globals startTracing set,
 * so a later startTracing registers its own instead of being refused as a
 * duplicate.
 */
export async function shutdownTracing(): Promise<void> {
  await provider?.shutdown();
  provider = null;
  trace.disable();
  propagation.disable();
  context.disable();
}
