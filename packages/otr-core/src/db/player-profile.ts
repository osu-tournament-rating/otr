import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { Ruleset } from '../osu/enums';
import * as relations from './relations';
import * as schema from './schema';

type ProfileDb = Pick<
  NodePgDatabase<typeof schema & typeof relations>,
  'insert'
>;

/** One of osu!'s mania variants, as a user's mania statistics list them. */
export interface OsuStatisticsVariant {
  variant?: string | null;
  pp?: number | null;
  global_rank?: number | null;
  is_ranked?: boolean | null;
}

/** What o!TR keeps from an osu! user's statistics in one ruleset. */
export interface OsuRulesetStatistics {
  pp?: number | null;
  global_rank?: number | null;
  /**
   * Mania only: 4K and 7K. osu! lists them only in the statistics of a
   * request made for the mania ruleset.
   */
  variants?: readonly OsuStatisticsVariant[] | null;
}

/** What o!TR keeps from an osu! user on the player. */
export interface OsuUserProfile {
  username?: string | null;
  previous_usernames?: readonly (string | null)[] | null;
  country_code?: string | null;
  country?: { code?: string | null } | null;
}

/** The rulesets osu! reports statistics for, by the names its API uses. */
export const OSU_API_RULESETS = {
  osu: Ruleset.Osu,
  taiko: Ruleset.Taiko,
  fruits: Ruleset.Catch,
  mania: Ruleset.ManiaOther,
} as const;

const MANIA_VARIANTS: Record<string, Ruleset> = {
  '4k': Ruleset.Mania4k,
  '7k': Ruleset.Mania7k,
};

/**
 * osu!'s previous usernames without blanks, the current username, or
 * repeats that differ only in case, in osu!'s order.
 */
export const normalizePreviousUsernames = (
  values: readonly (string | null)[] | null | undefined,
  currentUsername: string
): string[] => {
  const seen = new Set([currentUsername.trim().toLowerCase()]);
  const names: string[] = [];

  for (const value of values ?? []) {
    const name = value?.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    names.push(name);
  }

  return names;
};

/**
 * The player columns an osu! user sets: username, previous usernames and
 * country. The data worker and sign-in both save a profile with these.
 */
export const playerProfileValues = (user: OsuUserProfile) => {
  const username = user.username ?? '';

  return {
    username,
    previousUsernames: normalizePreviousUsernames(
      user.previous_usernames,
      username
    ),
    country: user.country?.code ?? user.country_code ?? '',
  };
};

const upsertRulesetData = async (
  db: ProfileDb,
  values: {
    playerId: number;
    ruleset: Ruleset;
    pp: number;
    globalRank: number | null;
    updated: string;
  }
) => {
  await db
    .insert(schema.playerOsuRulesetData)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.playerOsuRulesetData.playerId,
        schema.playerOsuRulesetData.ruleset,
      ],
      set: {
        pp: values.pp,
        globalRank: values.globalRank,
        updated: values.updated,
      },
    });
};

/**
 * Saves the player's pp and global rank in `ruleset` from osu!'s statistics
 * for it. Mania's statistics also save 4K and 7K from their variants. The
 * data worker and sign-in both save ruleset data with this.
 */
export const savePlayerRulesetData = async (
  db: ProfileDb,
  playerId: number,
  ruleset: Ruleset,
  statistics: OsuRulesetStatistics,
  updatedIso: string
) => {
  await upsertRulesetData(db, {
    playerId,
    ruleset,
    pp: statistics.pp ?? 0,
    globalRank: statistics.global_rank ?? null,
    updated: updatedIso,
  });

  if (ruleset !== Ruleset.ManiaOther || !Array.isArray(statistics.variants)) {
    return;
  }

  for (const variant of statistics.variants) {
    const hasRanking = variant.is_ranked || variant.global_rank !== undefined;
    const variantRuleset =
      MANIA_VARIANTS[String(variant.variant ?? '').toLowerCase()];

    if (!hasRanking || variantRuleset === undefined) {
      continue;
    }

    await upsertRulesetData(db, {
      playerId,
      ruleset: variantRuleset,
      pp: Number(variant.pp ?? 0),
      globalRank: variant.global_rank ?? null,
      updated: updatedIso,
    });
  }
};
