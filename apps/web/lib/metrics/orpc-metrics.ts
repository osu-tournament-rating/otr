import { Counter, Histogram } from 'prom-client';
import { metricsRegistry } from './registry';

export const orpcProcedureCalls = new Counter({
  name: 'web_orpc_procedure_calls_total',
  help: 'oRPC procedure calls',
  // code is the HTTP status, so alerts can tell server errors from client ones.
  labelNames: ['procedure', 'status', 'code', 'accessMethod'] as const,
  registers: [metricsRegistry],
});

export const orpcProcedureDuration = new Histogram({
  name: 'web_orpc_procedure_duration_seconds',
  help: 'oRPC procedure duration',
  labelNames: ['procedure', 'accessMethod'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});
