import { Gauge } from 'prom-client';

import { metricsRegistry } from './registry';

export const SOURCE_WINDOW_MS = 5 * 60 * 1000;

/** Sources tracked per window; calls from any beyond it still count in the total. */
export const MAX_TRACKED_SOURCES = 50_000;

export type SourceWindow = {
  /** Distinct sources that made a call. */
  sources: number;
  /** Calls from all of them. */
  calls: number;
  /** Calls from the busiest one. */
  topSourceCalls: number;
};

const EMPTY: SourceWindow = { sources: 0, calls: 0, topSourceCalls: 0 };

/**
 * Counts calls per source in fixed five-minute windows and reports the last
 * complete one, so a scrape never sees a window that has only just begun.
 */
export class SourceTally {
  private window = -1;
  private counts = new Map<string, number>();
  private calls = 0;
  private previous: SourceWindow = EMPTY;

  record(source: string, now = Date.now()) {
    this.advance(now);
    this.calls += 1;

    const count = this.counts.get(source);
    if (count !== undefined) {
      this.counts.set(source, count + 1);
    } else if (this.counts.size < MAX_TRACKED_SOURCES) {
      this.counts.set(source, 1);
    }
  }

  lastWindow(now = Date.now()): SourceWindow {
    this.advance(now);
    return this.previous;
  }

  private advance(now: number) {
    const window = Math.floor(now / SOURCE_WINDOW_MS);
    if (window === this.window) {
      return;
    }

    let topSourceCalls = 0;
    for (const count of this.counts.values()) {
      topSourceCalls = Math.max(topSourceCalls, count);
    }

    // After a window with no calls at all, there is nothing to report.
    this.previous =
      window === this.window + 1
        ? { sources: this.counts.size, calls: this.calls, topSourceCalls }
        : EMPTY;
    this.window = window;
    this.counts = new Map();
    this.calls = 0;
  }
}

/** Anonymous calls by source, the sign of a scraper. */
export const anonymousSources = new SourceTally();

export const anonymousSourceCount = new Gauge({
  name: 'web_anonymous_sources',
  help: 'Distinct sources of anonymous calls in the last complete 5 minutes',
  registers: [metricsRegistry],
  collect() {
    this.set(anonymousSources.lastWindow().sources);
  },
});

export const anonymousWindowCalls = new Gauge({
  name: 'web_anonymous_window_calls',
  help: 'Anonymous calls with a known source in the last complete 5 minutes',
  registers: [metricsRegistry],
  collect() {
    this.set(anonymousSources.lastWindow().calls);
  },
});

export const anonymousTopSourceCalls = new Gauge({
  name: 'web_anonymous_top_source_calls',
  help: 'Anonymous calls from the busiest source in the last complete 5 minutes',
  registers: [metricsRegistry],
  collect() {
    this.set(anonymousSources.lastWindow().topSourceCalls);
  },
});
