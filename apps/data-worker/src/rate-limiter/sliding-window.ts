import type { RateLimiter } from './fixed-window';

const sleep = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

export interface SlidingWindowRateLimiterOptions {
  requests: number;
  windowMs: number;
  now?: () => number;
}

/**
 * Allows at most `requests` calls in any `windowMs`, measured back from each
 * call, so no stretch of that length ever holds more. It keeps the time of
 * each call still inside the window. Unlike the fixed window, it can say how
 * long until a number of calls fit, so a caller can wait elsewhere.
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly requests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  /** Call times inside the window, oldest first. */
  private readonly calls: number[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: SlidingWindowRateLimiterOptions) {
    if (!Number.isFinite(options.requests) || options.requests <= 0) {
      throw new Error('requests must be a positive number');
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error('windowMs must be a positive number');
    }

    this.requests = Math.floor(options.requests);
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
  }

  /** Milliseconds until `count` more calls fit in the window; 0 when they fit now. */
  msUntilAvailable(count = 1): number {
    const now = this.now();
    this.forget(now);

    const over =
      this.calls.length + Math.min(count, this.requests) - this.requests;
    if (over <= 0) {
      return 0;
    }

    // The window holds room for `count` once its `over` oldest calls leave it.
    return Math.max(0, this.calls[over - 1]! + this.windowMs - now);
  }

  /** Whether no call is still inside the window. */
  isIdle(): boolean {
    this.forget(this.now());
    return this.calls.length === 0;
  }

  /** Runs `task` once a call fits, in the order calls were scheduled. */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      for (let wait = this.msUntilAvailable(); wait > 0;) {
        await sleep(wait);
        wait = this.msUntilAvailable();
      }
      this.calls.push(this.now());
      return task();
    };

    const execution = this.tail.then(run, run);
    this.tail = execution.then(
      () => undefined,
      () => undefined
    );
    return execution;
  }

  private forget(now: number) {
    while (this.calls.length > 0 && this.calls[0]! <= now - this.windowMs) {
      this.calls.shift();
    }
  }
}
