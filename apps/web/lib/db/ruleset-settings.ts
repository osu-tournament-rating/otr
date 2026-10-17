import * as schema from '@otr/core/db/schema';
import type { Ruleset } from '@otr/core/osu';
import { eq } from 'drizzle-orm';

import { mostPlayedRulesetSql } from '@/app/server/oRPC/procedures/shared/defaultRuleset';
import type { DatabaseClient } from '@/lib/db';
import { RATED_RULESETS } from '@/lib/kit/format/ruleset';

/** A player's two ruleset settings, null when left on most played. */
export interface RulesetSettings {
  profileRuleset: Ruleset | null;
  browsingRuleset: Ruleset | null;
  /** The ruleset they have played most, whatever the settings say. */
  mostPlayedRuleset: Ruleset;
}

/**
 * A player's ruleset settings, or null when no player has that id. A player
 * who never signed in, or never saved a setting, has both settings null.
 */
export async function getRulesetSettings(
  database: DatabaseClient,
  playerId: number
): Promise<RulesetSettings | null> {
  const [row] = await database
    .select({
      profileRuleset: schema.userSettings.profileRuleset,
      browsingRuleset: schema.userSettings.browsingRuleset,
      mostPlayedRuleset: mostPlayedRulesetSql(schema.players.id),
    })
    .from(schema.players)
    .leftJoin(schema.users, eq(schema.users.playerId, schema.players.id))
    .leftJoin(
      schema.userSettings,
      eq(schema.userSettings.userId, schema.users.id)
    )
    .where(eq(schema.players.id, playerId))
    .limit(1);

  if (!row) return null;

  return {
    profileRuleset: row.profileRuleset as Ruleset | null,
    browsingRuleset: row.browsingRuleset as Ruleset | null,
    mostPlayedRuleset: row.mostPlayedRuleset,
  };
}

/**
 * The ruleset a signed-in player's leaderboard and tournament list open in:
 * their browsing setting, else the ruleset they have played most. Their
 * profile setting plays no part. Null when that is not a rated ruleset (most
 * played can be mania (other)), so the page keeps its own default.
 */
export function resolveBrowsingRuleset(
  settings: Pick<RulesetSettings, 'browsingRuleset' | 'mostPlayedRuleset'>
): Ruleset | null {
  const ruleset = settings.browsingRuleset ?? settings.mostPlayedRuleset;
  return RATED_RULESETS.includes(ruleset) ? ruleset : null;
}

/** `resolveBrowsingRuleset` for a player id; null for a visitor. */
export async function getBrowsingRuleset(
  database: DatabaseClient,
  playerId: number | null | undefined
): Promise<Ruleset | null> {
  if (!playerId) return null;
  const settings = await getRulesetSettings(database, playerId);
  return settings ? resolveBrowsingRuleset(settings) : null;
}
