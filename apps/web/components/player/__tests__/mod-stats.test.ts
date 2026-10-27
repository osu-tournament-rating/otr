import { describe, expect, it } from 'bun:test';
import { Mods } from '@otr/core/osu';

import { groupModStats } from '@/components/player/mod-stats';
import { getModPaletteColor } from '@/lib/kit/color/mods';

describe('groupModStats', () => {
  it('folds combinations into the beatmap pages’ display groups', () => {
    const groups = groupModStats(
      [
        { mods: Mods.Hidden, count: 10, averageScore: 530_000 },
        // NoFail is dropped, so this joins the HD group.
        { mods: Mods.Hidden | Mods.NoFail, count: 10, averageScore: 530_000 },
        { mods: Mods.None, count: 30, averageScore: 600_000 },
      ],
      'count'
    );

    expect(groups.map((group) => [group.label, group.count])).toEqual([
      ['NM', 30],
      ['HD', 20],
    ]);
  });

  it('counts Nightcore as Double Time, as the beatmap pages do', () => {
    const groups = groupModStats(
      [
        { mods: Mods.DoubleTime, count: 6, averageScore: 840_000 },
        {
          mods: Mods.DoubleTime | Mods.Nightcore,
          count: 4,
          averageScore: 840_000,
        },
      ],
      'count'
    );

    expect(groups.map((group) => [group.label, group.count])).toEqual([
      ['DT', 10],
    ]);
    expect(groups[0].mods).toBe(Mods.DoubleTime);
  });

  it('removes the mod multipliers and weights the average by games', () => {
    const [hidden] = groupModStats(
      [
        { mods: Mods.Hidden, count: 1, averageScore: 1_060_000 },
        { mods: Mods.Hidden | Mods.NoFail, count: 3, averageScore: 530_000 },
      ],
      'averageScore'
    );

    // 1,000,000 once and 500,000 three times, after HD's 1.06x.
    expect(hidden.averageScore).toBe(625_000);
  });

  it('colors each chart mod from the mod palette', () => {
    const [group] = groupModStats(
      [{ mods: Mods.Hidden, count: 4, averageScore: 1 }],
      'count'
    );

    expect(group.label).toBe('HD');
    expect(group.fill).toBe(getModPaletteColor(Mods.Hidden));
  });

  it('folds every other combination into one "Other" group, last', () => {
    const groups = groupModStats(
      [
        {
          mods: Mods.Hidden | Mods.HardRock,
          count: 30,
          averageScore: 1_166_000,
        },
        { mods: Mods.Easy, count: 10, averageScore: 400_000 },
        { mods: Mods.None, count: 20, averageScore: 600_000 },
      ],
      'count'
    );

    expect(groups.map((group) => [group.label, group.count])).toEqual([
      ['NM', 20],
      ['Other', 40],
    ]);
    const other = groups[1];
    expect(other.fill).toBe('var(--chart-other)');
    // HDHR's 1,166,000 is 1,000,000 after HD's 1.06x and HR's 1.1x; EZ keeps
    // its score. (1,000,000 × 30 + 400,000 × 10) / 40 = 850,000.
    expect(other.averageScore).toBe(850_000);
    // EZ stays visible to the Mod performance tooltip's note.
    expect(other.mods & Mods.Easy).toBe(Mods.Easy);
  });

  it('drops groups under 1% of all games', () => {
    const groups = groupModStats(
      [
        { mods: Mods.None, count: 200, averageScore: 1 },
        { mods: Mods.Easy, count: 1, averageScore: 1 },
      ],
      'count'
    );

    expect(groups.map((group) => group.label)).toEqual(['NM']);
  });

  it('orders by the chosen value, then by label', () => {
    const groups = groupModStats(
      [
        { mods: Mods.HardRock, count: 5, averageScore: 700_000 },
        { mods: Mods.DoubleTime, count: 5, averageScore: 840_000 },
        { mods: Mods.Hidden, count: 9, averageScore: 636_000 },
      ],
      'count'
    );

    expect(groups.map((group) => group.label)).toEqual(['HD', 'DT', 'HR']);
  });
});
