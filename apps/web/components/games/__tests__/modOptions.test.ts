import { describe, expect, it } from 'bun:test';
import { Mods } from '@otr/core/osu';

import { combineFlags } from '@/components/admin-forms/adminFormFields';
import { modOptions, selectedMods } from '@/components/games/modOptions';

describe('modOptions', () => {
  it('labels every mod with its full name and code', () => {
    const labels = new Map(
      modOptions.map(({ value, label }) => [Number(value), label])
    );

    expect(labels.get(Mods.Mirror)).toBe('Mirror (MR)');
    expect(labels.get(Mods.ScoreV2)).toBe('ScoreV2 (V2)');
    expect(labels.get(Mods.HardRock)).toBe('Hard rock (HR)');
    expect(labels.get(Mods.Key7)).toBe('Mania 7 key (7K)');
    expect(labels.has(Mods.None)).toBe(false);

    const bareCodes = modOptions
      .filter(({ label }) => !/^\S.* \([A-Z0-9]+\)$/.test(label))
      .map(({ label }) => label);

    expect(bareCodes).toEqual([]);
  });

  it('offers only single mods, never a group of flags', () => {
    const groups = modOptions
      .map(({ value }) => Number(value))
      .filter((mods) => mods <= 0 || (mods & (mods - 1)) !== 0);

    expect(modOptions.length).toBeGreaterThan(0);
    expect(groups).toEqual([]);
  });

  it('selects each flag of Invalid Mods on its own, so removing one clears it', () => {
    const selected = selectedMods(Mods.InvalidMods | Mods.Hidden);

    expect(selected.map(Number).sort((a, b) => a - b)).toEqual([
      Mods.Hidden,
      Mods.SuddenDeath,
      Mods.Relax,
      Mods.Autoplay,
      Mods.SpunOut,
      Mods.Perfect,
    ]);
    expect(
      combineFlags(selected.filter((mod) => Number(mod) !== Mods.Perfect))
    ).toBe((Mods.InvalidMods | Mods.Hidden) & ~Mods.Perfect);
  });
});
