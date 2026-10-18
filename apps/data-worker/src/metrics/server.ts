import { optionalEnv } from '@otr/core';
import { metricsRegistry } from './registry';

export const resolveMetricsPort = (value: string | undefined): number =>
  Number(optionalEnv(value) ?? 9091);

const METRICS_PORT = resolveMetricsPort(process.env.METRICS_PORT);

export const handleMetricsRequest = async (
  req: Request,
  isHealthy: () => boolean
): Promise<Response> => {
  const url = new URL(req.url);
  if (url.pathname === '/metrics') {
    try {
      const metrics = await metricsRegistry.metrics();
      return new Response(metrics, {
        headers: { 'Content-Type': metricsRegistry.contentType },
      });
    } catch (error) {
      console.error('Failed to collect metrics', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
  if (url.pathname === '/health') {
    return isHealthy()
      ? new Response('OK')
      : new Response('Unhealthy', { status: 503 });
  }
  return new Response('Not Found', { status: 404 });
};

/** `isHealthy` backs `/health`, which the container health check reads. */
export const startMetricsServer = (isHealthy: () => boolean) => {
  const server = Bun.serve({
    port: METRICS_PORT,
    fetch: (req) => handleMetricsRequest(req, isHealthy),
  });
  console.log(`Metrics server listening on port ${METRICS_PORT}`);
  return server;
};
