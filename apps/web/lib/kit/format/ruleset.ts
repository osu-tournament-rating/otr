/**
 * The one set of ruleset names. Short labels go on chips, rows and charts;
 * the full name goes in tooltips and accessible names of icon-only uses.
 */

import { Ruleset } from '@otr/core/osu';

export interface RulesetNameEntry {
  /** `taiko`: chips, table cells, chart axes. */
  label: string;
  /** `osu!taiko`: tooltips and the accessible name of an icon on its own. */
  fullName: string;
}

export const RULESET_NAMES: Readonly<Record<Ruleset, RulesetNameEntry>> = {
  [Ruleset.Osu]: { label: 'osu!', fullName: 'osu!' },
  [Ruleset.Taiko]: { label: 'taiko', fullName: 'osu!taiko' },
  [Ruleset.Catch]: { label: 'catch', fullName: 'osu!catch' },
  [Ruleset.ManiaOther]: {
    label: 'mania (other)',
    fullName: 'osu!mania (other)',
  },
  [Ruleset.Mania4k]: { label: 'mania 4K', fullName: 'osu!mania 4K' },
  [Ruleset.Mania7k]: { label: 'mania 7K', fullName: 'osu!mania 7K' },
};

/**
 * The rulesets players are rated in, in display order, as list filters and
 * the filter tool offer them. Admin pickers (the edit dialogs, and the
 * submission form for admins) also offer `ManiaOther`.
 */
export const RATED_RULESETS: readonly Ruleset[] = [
  Ruleset.Osu,
  Ruleset.Taiko,
  Ruleset.Catch,
  Ruleset.Mania4k,
  Ruleset.Mania7k,
];

/** Whether `value` is one of `RATED_RULESETS`. */
export function isRatedRuleset(value: unknown): value is Ruleset {
  return isRuleset(value) && RATED_RULESETS.includes(value);
}

export function isRuleset(value: unknown): value is Ruleset {
  return typeof value === 'number' && value in RULESET_NAMES;
}

/** `taiko`. Unknown values print `Unknown ruleset`. */
export function getRulesetLabel(ruleset: number): string {
  return isRuleset(ruleset) ? RULESET_NAMES[ruleset].label : 'Unknown ruleset';
}

/** `osu!taiko`. Unknown values print `Unknown ruleset`. */
export function getRulesetFullName(ruleset: number): string {
  return isRuleset(ruleset)
    ? RULESET_NAMES[ruleset].fullName
    : 'Unknown ruleset';
}
