import { describe, expect, it } from 'bun:test';

import { Mods } from '@otr/core/osu';

import {
  countModBadgeSlots,
  fitModBadges,
  getModBadgeEntries,
  getModEntryName,
} from '../mod-badges';

describe('countModBadgeSlots', () => {
  it('fits a badge 10/7 as wide as it is tall, gaps between', () => {
    // A 20px badge is 28.57px wide; five with four 2px gaps take 150.86px.
    expect(countModBadgeSlots(150.86, 20, 2)).toBe(5);
    expect(countModBadgeSlots(150, 20, 2)).toBe(4);
    expect(countModBadgeSlots(28.6, 20, 2)).toBe(1);
  });

  it('has no slots in a row too small for one badge', () => {
    expect(countModBadgeSlots(20, 20, 2)).toBe(0);
    expect(countModBadgeSlots(100, 0, 2)).toBe(0);
  });
});

describe('fitModBadges', () => {
  it('shows every badge that fits', () => {
    expect(fitModBadges(3, 3)).toEqual({ shown: 3, hidden: 0 });
    expect(fitModBadges(0, 0)).toEqual({ shown: 0, hidden: 0 });
  });

  it('gives the last slot to the chip when badges are left over', () => {
    expect(fitModBadges(6, 4)).toEqual({ shown: 3, hidden: 3 });
    expect(fitModBadges(2, 1)).toEqual({ shown: 0, hidden: 2 });
  });

  it('still keeps the chip when nothing fits', () => {
    expect(fitModBadges(5, 0)).toEqual({ shown: 0, hidden: 5 });
  });

  it('shows a lone badge rather than a chip in its place', () => {
    expect(fitModBadges(1, 0)).toEqual({ shown: 1, hidden: 0 });
  });
});

describe('getModBadgeEntries', () => {
  it('draws lazer mods in play order with their speed, after FM', () => {
    expect(
      getModBadgeEntries(
        Mods.DoubleTime,
        [{ acronym: 'DT', settings: { speed_change: 1.2 } }, { acronym: 'BR' }],
        true
      )
    ).toEqual([
      { acronym: 'FM', speed: null },
      { acronym: 'DT', speed: 1.2 },
      { acronym: 'BR', speed: null },
    ]);
  });

  it('draws the flags when there are no lazer mods', () => {
    expect(getModBadgeEntries(Mods.Hidden, null)).toEqual([
      { acronym: 'HD', speed: null },
    ]);
  });
});

describe('getModEntryName', () => {
  it('names a custom speed after the mod', () => {
    expect(getModEntryName({ acronym: 'DT', speed: 1.25 })).toBe(
      'Double Time 1.25x'
    );
    expect(getModEntryName({ acronym: 'DA', speed: null })).toBe(
      'Difficulty Adjust'
    );
  });
});
