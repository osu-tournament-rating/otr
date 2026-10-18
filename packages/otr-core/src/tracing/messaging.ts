import {
  context,
  propagation,
  SpanKind,
  type Attributes,
} from '@opentelemetry/api';

import { withSpan } from './tracer';

const MESSAGING_SYSTEM = 'rabbitmq';
const JOBS_SYSTEM = 'otr_jobs';

export type MessageHeaders = Record<string, unknown>;

const queueAttributes = (queue: string, extra?: Attributes): Attributes => ({
  'messaging.system': MESSAGING_SYSTEM,
  'messaging.destination.name': queue,
  ...extra,
});

/** Serialises the active trace into AMQP headers so the consumer can continue it. */
export function injectTraceHeaders(
  headers: MessageHeaders = {}
): MessageHeaders {
  propagation.inject(context.active(), headers);
  return headers;
}

export function tracePublish<T>(
  queue: string,
  run: () => Promise<T>
): Promise<T> {
  return withSpan(
    `publish ${queue}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: queueAttributes(queue, {
        'messaging.operation.name': 'publish',
      }),
    },
    run
  );
}

/**
 * Continues the publisher's trace, so a queued job shows up under whatever
 * enqueued it rather than as an unrelated root span.
 */
// amqplib hands back long strings as Buffers, which the propagator can't read.
const asStrings = (headers: MessageHeaders): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );

/** Producer span around queueing jobs, whose rows carry its trace context. */
export function traceEnqueue<T>(
  queue: string,
  run: () => Promise<T>
): Promise<T> {
  return withSpan(
    `enqueue ${queue}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        'messaging.system': JOBS_SYSTEM,
        'messaging.destination.name': queue,
        'messaging.operation.name': 'publish',
      },
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

export function traceConsume<T>(
  queue: string,
  headers: MessageHeaders | undefined,
  run: () => Promise<T>,
  extraAttributes?: Attributes
): Promise<T> {
  const parent = propagation.extract(
    context.active(),
    headers ? asStrings(headers) : {}
  );

  return context.with(parent, () =>
    withSpan(
      `process ${queue}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: queueAttributes(queue, {
          'messaging.operation.name': 'process',
          ...extraAttributes,
        }),
      },
      run
    )
  );
}
