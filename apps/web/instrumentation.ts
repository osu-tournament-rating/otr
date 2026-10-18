export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { shutdownTracing, startTracing } = await import('@otr/core/tracing');
    const { drainOnSignal } = await import('@/lib/shutdown');
    // A draining server still answers requests, so their spans are flushed
    // when it exits rather than when the signal arrives.
    const drains = drainOnSignal({ beforeExit: shutdownTracing });
    startTracing({ serviceName: 'otr-web', flushOnSignal: !drains });
  }
}
