import type { Ruleset } from '@otr/core/osu';

import { getRulesetLabel } from '@/lib/kit/format/ruleset';
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

/** "Most played (taiko)": the option names the ruleset it stands for now. */
export function getMostPlayedLabel(mostPlayed: Ruleset): string {
  return `Most played (${getRulesetLabel(mostPlayed)})`;
}
