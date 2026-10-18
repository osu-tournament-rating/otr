import { createLogger } from '@otr/core/logging';

const logger = createLogger('otr-web');

/**
 * How long a stopping server keeps answering after SIGTERM: long enough for
 * the proxy's health checks to notice it is leaving and for requests it
 * already took to finish. docker-compose.yml gives the container longer than
 * this to stop before Docker kills it.
 */
const DEFAULT_DRAIN_SECONDS = 10;

/**
 * The longest the cleanup before exit may take. Flushing traces to a collector
 * that is down would otherwise outlast the container's stop grace period.
 */
const CLEANUP_TIMEOUT_MS = 5_000;

/**
 * The reverse proxy sends this header when it health-checks /api/health, and
 * a draining server answers it with 503. Requests without it still get 200,
 * since open tabs and uptime checks read /api/health through the proxy. A
 * build from before draining ignores the header, so the proxy keeps treating
 * it as healthy after a rollback.
 */
export const READINESS_HEADER = 'x-otr-readiness';

// Instrumentation and route handlers are bundled separately, so a module-level
// flag would exist once in each. A global is shared by both.
const DRAINING = Symbol.for('otr.web.draining');
type DrainState = typeof globalThis & { [DRAINING]?: boolean };

/** Whether this server has been told to stop and is finishing its work. */
export const isDraining = (): boolean =>
  (globalThis as DrainState)[DRAINING] === true;

export const setDraining = (draining: boolean): void => {
  (globalThis as DrainState)[DRAINING] = draining;
};

const drainSeconds = (value: string | undefined): number => {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds >= 0
    ? seconds
    : DEFAULT_DRAIN_SECONDS;
};

type DrainHooks = {
  wait?: (ms: number) => Promise<void>;
  exit?: (code: number) => void;
};

/**
 * Stops the server without cutting off anyone using it. The proxy's
 * readiness check fails at once, so it sends new requests to the other web
 * container, while this one keeps serving whatever still reaches it. Once the
 * drain time is up, `beforeExit` gets CLEANUP_TIMEOUT_MS to run and the
 * process exits.
 */
export async function drain({
  seconds,
  beforeExit,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  exit = process.exit,
}: DrainHooks & {
  seconds: number;
  beforeExit: () => Promise<void>;
}): Promise<void> {
  setDraining(true);
  logger.info('Draining before shutdown', { seconds });
  await wait(seconds * 1000);
  await Promise.race([
    beforeExit().catch((error) =>
      logger.error('Cleanup before shutdown failed', { error })
    ),
    wait(CLEANUP_TIMEOUT_MS).then(() =>
      logger.warn('Cleanup before shutdown timed out')
    ),
  ]);
  exit(0);
}

/**
 * Drains on SIGTERM and SIGINT instead of letting `next start` close the
 * server straight away. Only when NEXT_MANUAL_SIG_HANDLE is set, because
 * otherwise Next.js handles the signals itself. Returns whether it took them
 * over, so the caller knows `beforeExit` will run.
 */
export function drainOnSignal({
  beforeExit,
  env = process.env,
  listen = (signal, handler) => process.on(signal, handler),
  ...hooks
}: DrainHooks & {
  beforeExit: () => Promise<void>;
  env?: { NEXT_MANUAL_SIG_HANDLE?: string; SHUTDOWN_DRAIN_SECONDS?: string };
  listen?: (signal: NodeJS.Signals, handler: () => void) => void;
}): boolean {
  if (!env.NEXT_MANUAL_SIG_HANDLE) {
    return false;
  }

  const seconds = drainSeconds(env.SHUTDOWN_DRAIN_SECONDS);
  let started = false;
  const onSignal = () => {
    // Docker kills the container if a second signal is not enough; a drain
    // already under way is left to finish.
    if (started) {
      return;
    }
    started = true;
    void drain({ seconds, beforeExit, ...hooks });
  };

  listen('SIGTERM', onSignal);
  listen('SIGINT', onSignal);
  return true;
}
