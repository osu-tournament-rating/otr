import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Next.js never calls register() during `next build`, so builds without
    // runtime settings, such as the Docker image's, still work.
    const { exitIfSettingsMissing } = await import('@/lib/required-settings');
    exitIfSettingsMissing();

    const { shutdownTracing, startTracing } = await import('@otr/core/tracing');
    const { drainOnSignal } = await import('@/lib/shutdown');
    // A draining server still answers requests, so their spans are flushed
    // when it exits rather than when the signal arrives.
    const drains = drainOnSignal({ beforeExit: shutdownTracing });
    startTracing({ serviceName: 'otr-web', flushOnSignal: !drains });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  // The structured logger needs Node.js; on the edge runtime, Next.js's own
  // printed copy is all there is.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logRequestError } = await import('@/lib/request-errors');
    logRequestError(error, request.method, context);
  }
};
