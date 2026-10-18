import { describe, expect, test } from 'bun:test';

import { Mods } from '@otr/core/osu';

import { normalizeBeatmapDisplayMods } from '@/lib/utils/mods';
import {
  isChartedScoreMods,
  normalizeScoreModsArithmetic,
} from '../beatmapStatsHelpers';

// Parity with NORMALIZED_SCORE_MODS_SQL in beatmapProcedures
describe('normalizeScoreModsArithmetic', () => {
  test('matches normalizeBeatmapDisplayMods for every 14-bit bitmask', () => {
    for (let mods = 0; mods < 1 << 14; mods++) {
      const arithmetic = normalizeScoreModsArithmetic(mods);
      const reference = normalizeBeatmapDisplayMods(mods);
      if (arithmetic !== reference) {
        throw new Error(
          `Mismatch for mods=${mods}: arithmetic=${arithmetic}, reference=${reference}`
        );
      }
    }
    expect(true).toBe(true);
  });

  test('strips NoFail and SpunOut', () => {
    expect(
      normalizeScoreModsArithmetic(Mods.NoFail | Mods.SpunOut | Mods.Hidden)
    ).toBe(Mods.Hidden);
  });

  test('folds Nightcore into DoubleTime', () => {
    expect(normalizeScoreModsArithmetic(Mods.Nightcore)).toBe(Mods.DoubleTime);
    expect(normalizeScoreModsArithmetic(Mods.Nightcore | Mods.DoubleTime)).toBe(
      Mods.DoubleTime
    );
  });

  test('leaves a legitimate zero (NM) at zero', () => {
    expect(normalizeScoreModsArithmetic(0)).toBe(0);
  });
});

// Parity with CHARTED_SCORE_MODS_FILTER in beatmapProcedures
describe('isChartedScoreMods', () => {
  const accepted: Array<[string, number]> = [
    ['NM', Mods.None],
    ['NF', Mods.NoFail],
    ['HD', Mods.Hidden],
    ['HR', Mods.HardRock],
    ['DT', Mods.DoubleTime],
    ['NC', Mods.Nightcore],
    ['HDHR', Mods.Hidden | Mods.HardRock],
    ['HDDT', Mods.Hidden | Mods.DoubleTime],
    ['HDHRNCNF', Mods.Hidden | Mods.HardRock | Mods.Nightcore | Mods.NoFail],
  ];

  const rejected: Array<[string, number]> = [
    ['EZ', Mods.Easy],
    ['HT', Mods.HalfTime],
    ['FL', Mods.Flashlight],
    ['SO', Mods.SpunOut],
    ['SD', Mods.SuddenDeath],
    ['PF', Mods.Perfect],
    ['TD', Mods.TouchDevice],
    ['RX', Mods.Relax],
    ['4K', Mods.Key4],
    ['HDEZ', Mods.Hidden | Mods.Easy],
    ['HDHRSO', Mods.Hidden | Mods.HardRock | Mods.SpunOut],
    ['NFSO', Mods.NoFail | Mods.SpunOut],
  ];

  test.each(accepted)('charts %s', (_label, mods) => {
    expect(isChartedScoreMods(mods)).toBe(true);
  });

  test.each(rejected)('drops %s', (_label, mods) => {
    expect(isChartedScoreMods(mods)).toBe(false);
  });

  test('accepts exactly 32 of the 14-bit bitmasks', () => {
    let accepted = 0;
    for (let mods = 0; mods < 1 << 14; mods++) {
      if (isChartedScoreMods(mods)) accepted += 1;
    }

    // NF, HD, HR, DT and NC freely combine: 2^5.
    expect(accepted).toBe(32);
  });
});
