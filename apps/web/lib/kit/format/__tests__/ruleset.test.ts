import { describe, expect, it } from 'bun:test';
import { Ruleset } from '@otr/core/osu';

import {
  getRulesetFullName,
  getRulesetLabel,
  isRatedRuleset,
  isRuleset,
  RATED_RULESETS,
  RULESET_NAMES,
} from '../ruleset';

describe('ruleset names', () => {
  it('uses the agreed short labels', () => {
    expect(RATED_RULESETS.map(getRulesetLabel)).toEqual([
      'osu!',
      'taiko',
      'catch',
      'mania 4K',
      'mania 7K',
    ]);
  });

  it('gives the full osu! name for tooltips', () => {
    expect(RATED_RULESETS.map(getRulesetFullName)).toEqual([
      'osu!',
      'osu!taiko',
      'osu!catch',
      'osu!mania 4K',
      'osu!mania 7K',
    ]);
  });

  it('names every member of the enum', () => {
    const members = Object.values(Ruleset).filter(
      (value): value is Ruleset => typeof value === 'number'
    );
    expect(Object.keys(RULESET_NAMES).map(Number).sort()).toEqual(
      [...members].sort()
    );
  });

  it('drops the osu! prefix from every short label but osu! itself', () => {
    for (const ruleset of RATED_RULESETS.filter((r) => r !== Ruleset.Osu)) {
      expect(getRulesetLabel(ruleset)).not.toContain('osu!');
      expect(getRulesetFullName(ruleset).startsWith('osu!')).toBe(true);
    }
  });

  it('keeps unrated mania out of the rated list', () => {
    expect(RATED_RULESETS).not.toContain(Ruleset.ManiaOther);
    expect(getRulesetLabel(Ruleset.ManiaOther)).toBe('mania (other)');
    expect(getRulesetFullName(Ruleset.ManiaOther)).toBe('osu!mania (other)');
  });

  it('handles values outside the enum', () => {
    expect(isRuleset(4)).toBe(true);
    expect(isRuleset(9)).toBe(false);
    expect(isRuleset('0')).toBe(false);
    expect(getRulesetLabel(9)).toBe('Unknown ruleset');
    expect(getRulesetFullName(-1)).toBe('Unknown ruleset');
  });

  it('tells a rated ruleset from mania (other) and missing values', () => {
    for (const ruleset of RATED_RULESETS) {
      expect(isRatedRuleset(ruleset)).toBe(true);
    }
    expect(isRatedRuleset(Ruleset.ManiaOther)).toBe(false);
    expect(isRatedRuleset(null)).toBe(false);
    expect(isRatedRuleset(9)).toBe(false);
  });
});
