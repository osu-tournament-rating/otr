import { describe, expect, it } from 'bun:test';

import {
  HEATMAP_STEPS,
  getHeatmapLevel,
  getHeatmapPeak,
  getHeatmapStrength,
  moveHeatmapCell,
} from '../heatmap';

describe('getHeatmapLevel', () => {
  it('shades by share of the largest value, rounding up, with nothing for zero', () => {
    // Five steps of 20 over a largest value of 100.
    expect(getHeatmapLevel(0, 100)).toBe(0);
    expect(getHeatmapLevel(1, 100)).toBe(1);
    expect(getHeatmapLevel(20, 100)).toBe(1);
    expect(getHeatmapLevel(21, 100)).toBe(2);
    expect(getHeatmapLevel(100, 100)).toBe(HEATMAP_STEPS);
  });

  it('has nothing to shade for a missing value', () => {
    expect(getHeatmapLevel(Number.NaN, 100)).toBe(0);
  });
});

describe('getHeatmapStrength', () => {
  it('mixes in a fifth more of the colour per step, up to all of it', () => {
    expect(getHeatmapStrength(0)).toBe(0);
    expect(getHeatmapStrength(1)).toBe(20);
    expect(getHeatmapStrength(HEATMAP_STEPS)).toBe(100);
  });
});

describe('getHeatmapPeak', () => {
  it('finds the largest cell, the first one on a tie', () => {
    expect(
      getHeatmapPeak([
        [1, 7],
        [7, 2],
      ])
    ).toEqual({ row: 0, column: 1 });
  });

  it('is null when every cell is empty', () => {
    expect(getHeatmapPeak([[0, 0]])).toBeNull();
  });
});

describe('moveHeatmapCell', () => {
  const size = { rows: 7, columns: 24 };

  it('steps one cell per arrow and stops at the edges', () => {
    expect(moveHeatmapCell({ row: 3, column: 5 }, 'ArrowRight', size)).toEqual({
      row: 3,
      column: 6,
    });
    expect(moveHeatmapCell({ row: 3, column: 5 }, 'ArrowUp', size)).toEqual({
      row: 2,
      column: 5,
    });
    expect(moveHeatmapCell({ row: 0, column: 0 }, 'ArrowLeft', size)).toEqual({
      row: 0,
      column: 0,
    });
    expect(moveHeatmapCell({ row: 0, column: 0 }, 'ArrowUp', size)).toEqual({
      row: 0,
      column: 0,
    });
    expect(moveHeatmapCell({ row: 6, column: 23 }, 'ArrowRight', size)).toEqual(
      { row: 6, column: 23 }
    );
    expect(moveHeatmapCell({ row: 6, column: 23 }, 'ArrowDown', size)).toEqual({
      row: 6,
      column: 23,
    });
  });

  it('goes to the row’s ends with Home and End, and the grid’s with Ctrl', () => {
    const cell = { row: 3, column: 5 };
    expect(moveHeatmapCell(cell, 'Home', size)).toEqual({ row: 3, column: 0 });
    expect(moveHeatmapCell(cell, 'End', size)).toEqual({ row: 3, column: 23 });
    expect(moveHeatmapCell(cell, 'Home', { ...size, ctrlKey: true })).toEqual({
      row: 0,
      column: 0,
    });
    expect(moveHeatmapCell(cell, 'End', { ...size, ctrlKey: true })).toEqual({
      row: 6,
      column: 23,
    });
  });

  it('ignores other keys', () => {
    expect(moveHeatmapCell({ row: 3, column: 5 }, 'Enter', size)).toBeNull();
  });
});
