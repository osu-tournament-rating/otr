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

/**
 * Calls the `/rpc` gate refused, calls over a rate limit (`enforced` is false
 * while the limiter only observes), and calls a limit had no key for.
 */
export const rpcRejections = new Counter({
  name: 'web_rpc_rejections_total',
  help: 'oRPC calls refused by the /rpc gate or over a rate limit',
  labelNames: ['reason', 'bucket', 'caller', 'enforced'] as const,
  registers: [metricsRegistry],
});
