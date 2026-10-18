import {
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Span,
  type SpanOptions,
  type Tracer,
} from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';

export const getTracer = (name = 'otr'): Tracer => trace.getTracer(name);

export function recordException(span: Span, error: unknown): void {
  span.recordException(
    error instanceof Error ? error : new Error(String(error))
  );
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Runs `fn` inside a span, recording any thrown error before rethrowing. */
export async function withSpan<T>(
  name: string,
  options: SpanOptions,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return getTracer().startActiveSpan(name, options, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      recordException(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Adds attributes to the span already in context, if any. */
export function setActiveSpanAttributes(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

export function activeTraceId(): string | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  return context && trace.isSpanContextValid(context)
    ? context.traceId
    : undefined;
}

/** Runs `fn` without recording spans, for background polling that would flood traces. */
export function withoutTracing<T>(fn: () => Promise<T>): Promise<T> {
  return context.with(suppressTracing(context.active()), fn);
}
