import { describe, expect, it } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { Ruleset } from '@otr/core/osu';

import {
  buildBeatmapRulesetCondition,
  buildTournamentRulesetCondition,
  collectRulesets,
} from '../rulesetFilter';

const dialect = new PgDialect();
const render = (condition: SQL | undefined) => {
  if (!condition) return undefined;
  const { sql, params } = dialect.sqlToQuery(condition);
  return { sql, params };
};

describe('collectRulesets', () => {
  it('is empty when neither param is sent', () => {
    expect(collectRulesets(undefined, undefined)).toEqual([]);
    expect(collectRulesets(undefined, [])).toEqual([]);
  });

  it('keeps the single ruleset on its own', () => {
    expect(collectRulesets(Ruleset.Taiko, undefined)).toEqual([Ruleset.Taiko]);
  });

  it('merges both params, drops duplicates and follows enum order', () => {
    expect(
      collectRulesets(Ruleset.Mania7k, [
        Ruleset.Catch,
        Ruleset.Osu,
        Ruleset.Mania7k,
        Ruleset.Catch,
      ])
    ).toEqual([Ruleset.Osu, Ruleset.Catch, Ruleset.Mania7k]);
  });
});

describe('buildTournamentRulesetCondition', () => {
  it('adds no condition for no rulesets', () => {
    expect(buildTournamentRulesetCondition([])).toBeUndefined();
  });

  it('compares one ruleset with equality, as the single param always did', () => {
    expect(render(buildTournamentRulesetCondition([Ruleset.Taiko]))).toEqual({
      sql: '"tournaments"."ruleset" = $1',
      params: [Ruleset.Taiko],
    });
  });

  it('matches any of several rulesets', () => {
    expect(
      render(buildTournamentRulesetCondition([Ruleset.Osu, Ruleset.Mania4k]))
    ).toEqual({
      sql: '"tournaments"."ruleset" in ($1, $2)',
      params: [Ruleset.Osu, Ruleset.Mania4k],
    });
  });
});

describe('buildBeatmapRulesetCondition', () => {
  it('adds no condition for no rulesets', () => {
    expect(buildBeatmapRulesetCondition([])).toBeUndefined();
  });

  it('takes ManiaOther maps named for the key count with mania 4K', () => {
    expect(render(buildBeatmapRulesetCondition([Ruleset.Mania4k]))).toEqual({
      sql: '("beatmaps"."ruleset" = $1 OR ("beatmaps"."ruleset" = $2 AND "beatmaps"."diff_name" ~* $3))',
      params: [Ruleset.Mania4k, Ruleset.ManiaOther, '\\y4k\\y'],
    });
  });

  it('ORs several rulesets together, each with its own mania rule', () => {
    const rendered = render(
      buildBeatmapRulesetCondition([Ruleset.Osu, Ruleset.Mania7k])
    );

    expect(rendered?.sql).toBe(
      '("beatmaps"."ruleset" = $1 or ("beatmaps"."ruleset" = $2 OR ("beatmaps"."ruleset" = $3 AND "beatmaps"."diff_name" ~* $4)))'
    );
    expect(rendered?.params).toEqual([
      Ruleset.Osu,
      Ruleset.Mania7k,
      Ruleset.ManiaOther,
      '\\y7k\\y',
    ]);
  });
});
