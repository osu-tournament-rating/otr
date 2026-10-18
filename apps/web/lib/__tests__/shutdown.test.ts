import { afterEach, describe, expect, it } from 'bun:test';

import { drain, drainOnSignal, isDraining, setDraining } from '@/lib/shutdown';

describe('drain', () => {
  afterEach(() => setDraining(false));

  it('fails health checks at once and exits only after the drain time', async () => {
    const steps: string[] = [];
    let finishWaiting = () => {};
    const waited: number[] = [];

    const draining = drain({
      seconds: 15,
      wait: (ms) => {
        waited.push(ms);
        return new Promise((resolve) => (finishWaiting = resolve));
      },
      beforeExit: async () => {
        steps.push('beforeExit');
      },
      exit: (code) => steps.push(`exit ${code}`),
    });

    expect(isDraining()).toBe(true);
    expect(waited).toEqual([15_000]);
    expect(steps).toEqual([]);

    finishWaiting();
    await draining;
    expect(steps).toEqual(['beforeExit', 'exit 0']);
  });

  it('still exits when the cleanup before it fails', async () => {
    const exits: number[] = [];
    await drain({
      seconds: 0,
      wait: async () => {},
      beforeExit: async () => {
        throw new Error('exporter unreachable');
      },
      exit: (code) => exits.push(code),
    });
    expect(exits).toEqual([0]);
  });
});

describe('drainOnSignal', () => {
  afterEach(() => setDraining(false));

  const takeOver = (env: Record<string, string>) => {
    const handlers = new Map<string, () => void>();
    const waited: number[] = [];
    const tookOver = drainOnSignal({
      beforeExit: async () => {},
      env,
      listen: (signal, handler) => handlers.set(signal, handler),
      wait: async (ms) => {
        waited.push(ms);
      },
      exit: () => {},
    });
    return { tookOver, handlers, waited };
  };

  // Without NEXT_MANUAL_SIG_HANDLE, `next start` and `next dev` handle the
  // signals, and a second handler would keep them from stopping promptly.
  it('leaves the signals to Next.js unless told to take them over', () => {
    const { tookOver, handlers } = takeOver({});
    expect(tookOver).toBe(false);
    expect(handlers.size).toBe(0);
  });

  it('drains once, for SHUTDOWN_DRAIN_SECONDS, on SIGTERM or SIGINT', () => {
    const { tookOver, handlers, waited } = takeOver({
      NEXT_MANUAL_SIG_HANDLE: 'true',
      SHUTDOWN_DRAIN_SECONDS: '3',
    });
    expect(tookOver).toBe(true);
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);

    handlers.get('SIGTERM')!();
    handlers.get('SIGINT')!();
    expect(isDraining()).toBe(true);
    expect(waited).toEqual([3000]);
  });

  it('drains for the default time when SHUTDOWN_DRAIN_SECONDS is not a number', () => {
    const drainFor = (env: Record<string, string>) => {
      const { handlers, waited } = takeOver({
        NEXT_MANUAL_SIG_HANDLE: 'true',
        ...env,
      });
      handlers.get('SIGTERM')!();
      return waited;
    };
    const unset = drainFor({});
    expect(unset).toHaveLength(1);
    expect(unset[0]).toBeGreaterThan(0);
    expect(drainFor({ SHUTDOWN_DRAIN_SECONDS: 'soon' })).toEqual(unset);
    expect(drainFor({ SHUTDOWN_DRAIN_SECONDS: '-5' })).toEqual(unset);
  });
});
