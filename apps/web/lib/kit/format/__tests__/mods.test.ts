import { describe, expect, it } from 'bun:test';
import { Mods } from '@otr/core/osu';

import {
  formatLazerMods,
  formatMods,
  getModAcronyms,
  MOD_ACRONYMS,
} from '../mods';

describe('formatMods', () => {
  it('writes acronyms in bit order', () => {
    expect(formatMods(Mods.Hidden | Mods.HardRock)).toBe('HD, HR');
    expect(formatMods(24)).toBe('HD, HR');
    expect(formatMods(8)).toBe('HD');
    expect(formatMods(Mods.Easy | Mods.Hidden | Mods.Flashlight)).toBe(
      'EZ, HD, FL'
    );
  });

  it('writes NM for no mods', () => {
    expect(formatMods(Mods.None)).toBe('NM');
  });

  it('keeps every recorded flag, including NF and SO', () => {
    expect(formatMods(Mods.NoFail | Mods.DoubleTime)).toBe('NF, DT');
    expect(formatMods(Mods.SpunOut)).toBe('SO');
    expect(formatMods(Mods.ScoreV2 | Mods.Mirror)).toBe('V2, MR');
  });

  it('drops the flag that another one implies', () => {
    expect(formatMods(Mods.DoubleTime | Mods.Nightcore)).toBe('NC');
    expect(formatMods(Mods.SuddenDeath | Mods.Perfect)).toBe('PF');
  });

  it('names the key mods', () => {
    expect(formatMods(Mods.Key4)).toBe('4K');
    expect(formatMods(Mods.Key7 | Mods.Hidden)).toBe('HD, 7K');
  });

  it('reads the whole freemod mask as Freemod', () => {
    expect(formatMods(Mods.FreeModAllowed)).toBe('Freemod');
    expect(formatMods(Mods.FreeModAllowed | Mods.DoubleTime)).toBe(
      'Freemod, DT'
    );
    expect(getModAcronyms(Mods.FreeModAllowed)).toEqual(['Freemod']);
  });

  it('prints values that are not flags as they are', () => {
    expect(formatMods(-1)).toBe('-1');
    expect(formatMods(1.5)).toBe('1.5');
  });

  it('has one acronym for each of the 31 single-bit mods', () => {
    const flags = MOD_ACRONYMS.map(([flag]) => flag);
    expect(new Set(flags).size).toBe(31);
    for (const flag of flags) {
      expect(flag & (flag - 1)).toBe(0);
    }
    expect(new Set(MOD_ACRONYMS.map(([, acronym]) => acronym)).size).toBe(31);
  });
});

describe('formatLazerMods', () => {
  it('writes every lazer mod in play order, with a custom speed', () => {
    expect(
      formatLazerMods([
        { acronym: 'HD' },
        { acronym: 'DT', settings: { speed_change: 1.25 } },
        { acronym: 'BR', settings: { spin_speed: 0.5 } },
      ])
    ).toBe('HD, DT 1.25x, BR');
  });

  it('writes NM when there are none', () => {
    expect(formatLazerMods([])).toBe('NM');
  });
});
