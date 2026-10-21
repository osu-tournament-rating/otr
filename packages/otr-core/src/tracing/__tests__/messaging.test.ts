import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

import { JobQueue } from '../../jobs/enums';
import { injectTraceContext, traceConsume, traceEnqueue } from '../messaging';
import { withSpan } from '../tracer';

describe('traceConsume', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register({ propagator: new W3CTraceContextPropagator() });
  });

  afterEach(async () => {
    await provider.shutdown();
    trace.disable();
    propagation.disable();
    context.disable();
  });

  const spanNamed = (name: string) => {
    const spans = exporter
      .getFinishedSpans()
      .filter((span) => span.name === name);
    expect(spans).toHaveLength(1);
    return spans[0]!;
  };

  const runJob = (traceContext: Record<string, string> | undefined) =>
    traceConsume(JobQueue.TournamentChecks, traceContext, () =>
      withSpan('UPDATE scores', {}, async () => undefined)
    );

  // Automated checks write one statement per score, so a submission whose
  // jobs all joined its trace grew past Tempo's 5 MB limit per trace
  it('starts a new trace for a job, linked to the trace that queued it (#1241)', async () => {
    const carrier = await traceEnqueue(JobQueue.TournamentChecks, async () =>
      injectTraceContext()
    );
    await runJob(carrier);

    const queued = spanNamed(`enqueue ${JobQueue.TournamentChecks}`);
    const job = spanNamed(`process ${JobQueue.TournamentChecks}`);

    expect(job.spanContext().traceId).not.toBe(queued.spanContext().traceId);
    expect(job.parentSpanContext).toBeUndefined();
    expect(job.links.map((link) => link.context)).toEqual([
      expect.objectContaining({
        traceId: queued.spanContext().traceId,
        spanId: queued.spanContext().spanId,
      }),
    ]);
    expect(spanNamed('UPDATE scores').parentSpanContext?.spanId).toBe(
      job.spanContext().spanId
    );
  });

  it('starts a trace with no link for a job queued outside any trace', async () => {
    await runJob(undefined);

    expect(spanNamed(`process ${JobQueue.TournamentChecks}`).links).toEqual([]);
  });
});
