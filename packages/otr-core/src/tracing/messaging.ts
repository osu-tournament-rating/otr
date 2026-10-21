import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  trace,
  type Attributes,
  type Link,
} from '@opentelemetry/api';

import { withSpan } from './tracer';

/** Background work runs from the Postgres jobs table, with no message broker. */
const MESSAGING_SYSTEM = 'otr_jobs';

const queueAttributes = (queue: string, extra?: Attributes): Attributes => ({
  'messaging.system': MESSAGING_SYSTEM,
  'messaging.destination.name': queue,
  ...extra,
});

/** Producer span around queueing jobs, whose rows carry its trace context. */
export function traceEnqueue<T>(
  queue: string,
  run: () => Promise<T>
): Promise<T> {
  return withSpan(
    `enqueue ${queue}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: queueAttributes(queue, {
        'messaging.operation.name': 'publish',
      }),
    },
    run
  );
}

/** The active trace as a carrier a job row stores for its consumer. */
export function injectTraceContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * Starts a new trace for a job, linked to the trace a job row carries. Joining
 * that trace instead let one tournament submission collect every span of its
 * fetches and automated checks, past Tempo's size limit per trace.
 */
export function traceConsume<T>(
  queue: string,
  traceContext: Record<string, string> | undefined,
  run: () => Promise<T>,
  extraAttributes?: Attributes
): Promise<T> {
  const queued = trace.getSpanContext(
    propagation.extract(ROOT_CONTEXT, traceContext ?? {})
  );
  const links: Link[] = queued ? [{ context: queued }] : [];

  return withSpan(
    `process ${queue}`,
    {
      kind: SpanKind.CONSUMER,
      root: true,
      links,
      attributes: queueAttributes(queue, {
        'messaging.operation.name': 'process',
        ...extraAttributes,
      }),
    },
    run
  );
}
