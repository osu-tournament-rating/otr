import { describe, expect, it } from 'bun:test';

import { resolveRulesetWithTournament } from '../ruleset-utils';
import { Ruleset } from '@otr/core/osu/enums';

describe('resolveRulesetWithTournament', () => {
  it('returns the tournament mania variant when the raw ruleset is mania other', () => {
    expect(
      resolveRulesetWithTournament(Ruleset.ManiaOther, Ruleset.Mania4k)
    ).toBe(Ruleset.Mania4k);
    expect(
      resolveRulesetWithTournament(Ruleset.ManiaOther, Ruleset.Mania7k)
    ).toBe(Ruleset.Mania7k);
  });

  it('falls back to the raw ruleset when the tournament ruleset is not a mania variant', () => {
    expect(
      resolveRulesetWithTournament(Ruleset.ManiaOther, Ruleset.ManiaOther)
    ).toBe(Ruleset.ManiaOther);
    expect(resolveRulesetWithTournament(Ruleset.Mania4k, Ruleset.Mania7k)).toBe(
      Ruleset.Mania4k
    );
    expect(resolveRulesetWithTournament(Ruleset.Catch, Ruleset.Osu)).toBe(
      Ruleset.Catch
    );
  });
});
