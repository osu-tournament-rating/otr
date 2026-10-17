import { describe, expect, it } from 'bun:test';
import { Ruleset } from '@otr/core/osu';

import {
  MOST_PLAYED_VALUE,
  fromRulesetSelectValue,
  getMostPlayedLabel,
  toRulesetSelectValue,
} from '../default-ruleset';

describe('ruleset setting select values', () => {
  it('gives most played a value Radix Select accepts', () => {
    expect(MOST_PLAYED_VALUE).not.toBe('');
    expect(toRulesetSelectValue(null)).toBe(MOST_PLAYED_VALUE);
    expect(fromRulesetSelectValue(MOST_PLAYED_VALUE)).toBeNull();
  });

  it('round-trips every rated ruleset, osu! included', () => {
    for (const ruleset of [
      Ruleset.Osu,
      Ruleset.Taiko,
      Ruleset.Catch,
      Ruleset.Mania4k,
      Ruleset.Mania7k,
    ]) {
      expect<Ruleset | null>(
        fromRulesetSelectValue(toRulesetSelectValue(ruleset))
      ).toBe(ruleset);
    }
    expect(toRulesetSelectValue(Ruleset.Osu)).toBe('0');
  });

  it('reads anything but a rated ruleset as most played', () => {
    expect(fromRulesetSelectValue(String(Ruleset.ManiaOther))).toBeNull();
    expect(fromRulesetSelectValue('9')).toBeNull();
    expect(fromRulesetSelectValue('')).toBeNull();
  });
});

describe('getMostPlayedLabel', () => {
  it('names the ruleset most played stands for', () => {
    expect(getMostPlayedLabel(Ruleset.Taiko)).toBe('Most played (taiko)');
    expect(getMostPlayedLabel(Ruleset.Osu)).toBe('Most played (osu!)');
    expect(getMostPlayedLabel(Ruleset.Mania4k)).toBe('Most played (mania 4K)');
  });
});
