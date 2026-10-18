import type { Ruleset } from '@otr/core/osu';

import { getRulesetLabel, isRatedRuleset } from '@/lib/kit/format/ruleset';
import {
  RatedRulesetSchema,
  type RatedRuleset,
  type UserSettings,
} from '@/lib/orpc/schema/user';

/** The two ruleset settings, each a select on the settings page. */
export type RulesetSettingKey = keyof Pick<
  UserSettings,
  'profileRuleset' | 'browsingRuleset'
>;

/** A setting's value: a rated ruleset, or null for most played. */
export type RulesetSettingValue = RatedRuleset | null;

/** Radix Select refuses an empty item value, so most played has its own. */
export const MOST_PLAYED_VALUE = 'most-played';

export function toRulesetSelectValue(setting: Ruleset | null): string {
  return setting === null ? MOST_PLAYED_VALUE : String(setting);
}

/** The setting for a select value; anything but a rated ruleset is most played. */
export function fromRulesetSelectValue(value: string): RulesetSettingValue {
  // `Number('')` is 0, which would read as osu!.
  if (!/^\d+$/.test(value)) return null;
  const parsed = RatedRulesetSchema.safeParse(Number(value));
  return parsed.success ? parsed.data : null;
}

/**
 * The ruleset a setting left on most played opens in now: the ruleset played
 * most, and for the lists only a rated one (as `resolveBrowsingRuleset`).
 * Null when there is none and the page keeps its own default: osu! on the
 * profile, osu! on the leaderboard and every ruleset on the tournament list.
 */
export function getMostPlayedRuleset(
  setting: RulesetSettingKey,
  mostPlayed: Ruleset | null
): Ruleset | null {
  if (setting === 'browsingRuleset') {
    return isRatedRuleset(mostPlayed) ? mostPlayed : null;
  }
  return mostPlayed;
}

/**
 * "Most played (taiko)": the option names the ruleset it stands for now, or
 * just "Most played" when it stands for none.
 */
export function getMostPlayedLabel(ruleset: Ruleset | null): string {
  return ruleset === null
    ? 'Most played'
    : `Most played (${getRulesetLabel(ruleset)})`;
}
