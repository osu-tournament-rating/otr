/** Retry after at least `delayMs`, for example a wait osu! asked for. */
export class RetryableJobError extends Error {
  constructor(
    message: string,
    readonly delayMs?: number
  ) {
    super(message);
    this.name = 'RetryableJobError';
  }
}

/** Fail now without using the remaining attempts, because a retry can't help. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * Run the job again after `delayMs` without using an attempt, because it
 * can't run yet rather than because it failed: for example, it waits for a
 * user's rate limit or for them to sign in again.
 */
export class DeferJobError extends Error {
  constructor(
    message: string,
    readonly delayMs: number
  ) {
    super(message);
    this.name = 'DeferJobError';
  }
}

/** Drop the job without counting it as failed. */
export class DiscardJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscardJobError';
  }
}
