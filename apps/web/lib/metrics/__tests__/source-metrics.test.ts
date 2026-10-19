import { describe, expect, it } from 'bun:test';

import { SOURCE_WINDOW_MS, SourceTally } from '../source-metrics';

const WINDOW = 1_000 * SOURCE_WINDOW_MS;

describe('SourceTally', () => {
  it('reports nothing until a window is complete', () => {
    const tally = new SourceTally();
    tally.record('a', WINDOW);

    expect(tally.lastWindow(WINDOW + 1)).toEqual({
      sources: 0,
      calls: 0,
      topSourceCalls: 0,
    });
  });

  it('reports the last complete window: sources, calls, and the busiest source', () => {
    const tally = new SourceTally();
    for (const source of ['a', 'b', 'a', 'a', 'c']) {
      tally.record(source, WINDOW + 10);
    }
    tally.record('d', WINDOW + SOURCE_WINDOW_MS);

    expect(tally.lastWindow(WINDOW + SOURCE_WINDOW_MS + 5)).toEqual({
      sources: 3,
      calls: 5,
      topSourceCalls: 3,
    });
  });

  it('reports an empty window after a quiet one', () => {
    const tally = new SourceTally();
    tally.record('a', WINDOW);

    expect(tally.lastWindow(WINDOW + 2 * SOURCE_WINDOW_MS)).toEqual({
      sources: 0,
      calls: 0,
      topSourceCalls: 0,
    });
  });
});
