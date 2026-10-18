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

/** Drop the job without counting it as failed. */
export class DiscardJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscardJobError';
  }
}
