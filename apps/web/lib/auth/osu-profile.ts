import { eq } from 'drizzle-orm';
import type { User } from 'osu-api-v2-js';

import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import {
  OSU_API_RULESETS,
  playerProfileValues,
  savePlayerRulesetData,
  type OsuRulesetStatistics,
} from '@otr/core/db/player-profile';
import * as schema from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';
import { db } from '@/lib/db';

/** The signed-in player's own osu! profile, from `/me/mania`. */
export type OwnOsuProfile = User.Extended.WithStatisticsrulesets;

/**
 * Saves the signed-in player's own osu! profile as the data worker saves a
 * fetch: username, previous usernames, country, and pp and global rank in
 * every ruleset, mania 4K and 7K included. osu! reports a user's own
 * restriction, so the restricted flag comes straight from the profile.
 *
 * With every ruleset's statistics saved, sign-in has done everything a fetch
 * does, so it counts as one: the status becomes Fetched and the last fetch
 * time moves to now, together. A player waiting on a refetch stops waiting,
 * and the refetch scheduler next refetches them on their usual cadence.
 * Without the statistics it is not a fetch, so the status and last fetch
 * time stay as they were; moving the time alone would keep a player who is
 * waiting on a refetch from ever timing out.
 *
 * It runs in one transaction, so a failure saves nothing. A failure is
 * logged and never fails the sign-in.
 */
export const saveOwnOsuProfile = async (
  playerId: number,
  profile: OwnOsuProfile
) => {
  const nowIso = new Date().toISOString();
  const statisticsByRuleset = profile.statistics_rulesets as
    Record<string, OsuRulesetStatistics | undefined> | null | undefined;
  const complete =
    statisticsByRuleset != null && typeof statisticsByRuleset === 'object';
  // A `/me/mania` profile's own statistics are mania's, the only ones that
  // list the 4K and 7K variants.
  const maniaVariants = (
    profile.statistics as OsuRulesetStatistics | null | undefined
  )?.variants;

  try {
    await db.transaction(async (tx) => {
      if (complete) {
        for (const [name, ruleset] of Object.entries(OSU_API_RULESETS)) {
          const statistics = statisticsByRuleset[name];

          if (!statistics) {
            continue;
          }

          await savePlayerRulesetData(
            tx,
            playerId,
            ruleset,
            ruleset === Ruleset.ManiaOther
              ? { ...statistics, variants: maniaVariants }
              : statistics,
            nowIso
          );
        }
      }

      await tx
        .update(schema.players)
        .set({
          ...playerProfileValues(profile),
          restricted: profile.is_restricted === true,
          ...(complete
            ? {
                dataFetchStatus: DataFetchStatus.Fetched,
                osuLastFetch: nowIso,
              }
            : {}),
          updated: nowIso,
        })
        .where(eq(schema.players.id, playerId));
    });
  } catch (error) {
    console.error('Failed to save the osu! profile at sign-in', error);
  }
};
