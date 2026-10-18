import {
  context,
  propagation,
  SpanKind,
  type Attributes,
} from '@opentelemetry/api';

import { withSpan } from './tracer';

const MESSAGING_SYSTEM = 'rabbitmq';
const JOBS_SYSTEM = 'otr_jobs';

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

/**
 * Continues the trace a job row carries, so the job shows up under whatever
 * enqueued it rather than as an unrelated root span.
 */
export function traceConsume<T>(
  queue: string,
  traceContext: Record<string, string> | undefined,
  run: () => Promise<T>,
  extraAttributes?: Attributes
): Promise<T> {
  const parent = propagation.extract(context.active(), traceContext ?? {});

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
