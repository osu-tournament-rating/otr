import { Counter, Histogram } from 'prom-client';
import { metricsRegistry } from './registry';

export const orpcProcedureCalls = new Counter({
  name: 'web_orpc_procedure_calls_total',
  help: 'oRPC procedure calls',
  // status is success, error, or rate_limited (a 429). code is the HTTP
  // status, so alerts can tell server errors from client ones. caller is
  // browser or internal (a server render) on /rpc, and api on the REST API.
  labelNames: [
    'procedure',
    'status',
    'code',
    'accessMethod',
    'caller',
  ] as const,
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

/**
 * API keys refused before the procedure ran: `rate_limited` by the key's own
 * limit, `disabled`, or `invalid`. These calls never reach the call counter.
 */
export const apiKeyRejections = new Counter({
  name: 'web_api_key_rejections_total',
  help: 'API keys refused before the procedure ran',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

// Each series starts at zero, so increase() counts the first refusal after a
// restart instead of treating it as where the series began.
for (const reason of ['rate_limited', 'disabled', 'invalid']) {
  apiKeyRejections.labels({ reason }).inc(0);
}
