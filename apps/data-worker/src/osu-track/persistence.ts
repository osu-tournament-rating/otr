import type { UserStatUpdate } from '@otr/core';
import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { Ruleset, VerificationStatus } from '@otr/core/osu';
import { and, eq, isNotNull, min } from 'drizzle-orm';

import type { DatabaseClient } from '../db';
import type { Logger } from '../logging/logger';

const MANIA_RULESETS: Ruleset[] = [
  Ruleset.ManiaOther,
  Ruleset.Mania4k,
  Ruleset.Mania7k,
];

// osu!track tracks mania as one ruleset, so its history seeds every variant
const MODE_RULESETS: Record<number, Ruleset[] | undefined> = {
  0: [Ruleset.Osu],
  1: [Ruleset.Taiko],
  2: [Ruleset.Catch],
  3: MANIA_RULESETS,
};

type ModeResult = {
  mode: number;
  updates: UserStatUpdate[];
};

type RulesetDataRow = typeof schema.playerOsuRulesetData.$inferSelect & {
  ruleset: number;
};

type RulesetDataMap = Map<number, RulesetDataRow>;

interface ProcessPlayerResultsOptions {
  db: DatabaseClient;
  logger: Logger;
  osuPlayerId: number;
  results: ModeResult[];
}

export const processOsuTrackPlayerResults = async ({
  db,
  logger,
  osuPlayerId,
  results,
}: ProcessPlayerResultsOptions) => {
  if (results.length === 0) {
    return;
  }

  // Taken before the ruleset data is read, so ruleset data created after the
  // read is newer than the recorded fetch, and the next profile fetch queues
  // osu!track again (see requeueOsuTrackForNewRulesetData).
  const nowIso = new Date().toISOString();

  const player = await db.query.players.findFirst({
    where: eq(schema.players.osuId, osuPlayerId),
    columns: {
      id: true,
      username: true,
    },
    with: {
      playerOsuRulesetData: true,
    },
  });

  if (!player) {
    logger.warn('Player not found for osu!track fetch', { osuPlayerId });
    return;
  }

  logger.info(
    `osu!track persistence start player ${player.username}#${player.id} (${osuPlayerId})`
  );

  const firstMatchDates = await findFirstVerifiedMatchDates(db, player.id);

  logger.info(
    `osu!track alignment found first verified matches in ${firstMatchDates.size} rulesets for player ${player.id}`
  );

  const rulesetDataMap: RulesetDataMap = new Map(
    player.playerOsuRulesetData.map((entry) => [entry.ruleset, entry])
  );

  let persistedAny = false;

  for (const { mode, updates } of results) {
    const rulesets = MODE_RULESETS[mode];

    if (rulesets === undefined) {
      logger.warn('Skipping unknown osu!track mode', { mode, osuPlayerId });
      continue;
    }

    if (updates.length === 0) {
      logger.info(
        `osu!track persistence no updates for player ${player.id} mode ${mode}`
      );
      continue;
    }

    for (const ruleset of rulesets) {
      const rulesetData = rulesetDataMap.get(ruleset);

      if (!rulesetData) {
        logger.info(
          `osu!track persistence missing ruleset ${ruleset} for player ${player.id}`
        );
        continue;
      }

      const relevant = pickRelevantStatUpdate(
        updates,
        alignmentDate(firstMatchDates, ruleset)
      );

      if (!relevant) {
        logger.info(
          `osu!track persistence no relevant stat for player ${player.id} ruleset ${ruleset}`
        );
        continue;
      }

      const timestampIso = relevant.timestamp.toISOString();

      await db
        .update(schema.playerOsuRulesetData)
        .set({
          earliestGlobalRank: relevant.rank,
          earliestGlobalRankDate: timestampIso,
          updated: nowIso,
        })
        .where(eq(schema.playerOsuRulesetData.id, rulesetData.id));

      persistedAny = true;

      logger.info(
        `osu!track persistence recorded rank ${relevant.rank} (${timestampIso}) for player ${player.id} ruleset ${ruleset}`
      );
    }
  }

  // Mark fetched even when nothing was persisted
  await db
    .update(schema.players)
    .set({
      osuTrackLastFetch: nowIso,
      osuTrackDataFetchStatus: DataFetchStatus.Fetched,
    })
    .where(eq(schema.players.id, player.id));

  if (persistedAny) {
    logger.info(
      `osu!track persistence finished player ${player.id}, set last fetch ${nowIso}`
    );
  } else {
    logger.info(
      `osu!track persistence finished player ${player.id}, no ruleset rows updated, set last fetch ${nowIso}`
    );
  }
};

export const pickRelevantStatUpdate = (
  updates: UserStatUpdate[],
  earliestMatchDate: Date | null
): UserStatUpdate | null => {
  if (updates.length === 0) {
    return null;
  }

  const sorted = [...updates];

  if (!earliestMatchDate) {
    sorted.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return sorted[0] ?? null;
  }

  const target = earliestMatchDate.getTime();

  sorted.sort((a, b) => {
    const diffA = Math.abs(a.timestamp.getTime() - target);
    const diffB = Math.abs(b.timestamp.getTime() - target);
    return diffA - diffB;
  });

  return sorted[0] ?? null;
};

/**
 * The date a ruleset's starting rank is aligned to: the player's first
 * verified match in that ruleset. ManiaOther seeds a variant whose own rank is
 * unknown, so it aligns to the first match in any mania variant. A ruleset not
 * yet played aligns to the first match in any ruleset, since nothing re-aligns
 * it when its first match is verified.
 */
const alignmentDate = (
  firstMatchDates: Map<Ruleset, Date>,
  ruleset: Ruleset
): Date | null => {
  const rulesets = ruleset === Ruleset.ManiaOther ? MANIA_RULESETS : [ruleset];
  const dates = rulesets.flatMap((r) => firstMatchDates.get(r) ?? []);

  return earliest(dates) ?? earliest([...firstMatchDates.values()]);
};

const earliest = (dates: Date[]): Date | null =>
  dates.length === 0
    ? null
    : new Date(Math.min(...dates.map((date) => date.getTime())));

/**
 * The start of the player's first verified match in each ruleset. A match is
 * in its tournament's ruleset, as the processor rates it.
 */
const findFirstVerifiedMatchDates = async (
  db: DatabaseClient,
  playerId: number
): Promise<Map<Ruleset, Date>> => {
  const rows = await db
    .select({
      ruleset: schema.tournaments.ruleset,
      startTime: min(schema.matches.startTime),
    })
    .from(schema.gameScores)
    .innerJoin(schema.games, eq(schema.games.id, schema.gameScores.gameId))
    .innerJoin(schema.matches, eq(schema.matches.id, schema.games.matchId))
    .innerJoin(
      schema.tournaments,
      eq(schema.tournaments.id, schema.matches.tournamentId)
    )
    .where(
      and(
        eq(schema.gameScores.playerId, playerId),
        eq(schema.matches.verificationStatus, VerificationStatus.Verified),
        eq(schema.tournaments.verificationStatus, VerificationStatus.Verified),
        isNotNull(schema.matches.startTime)
      )
    )
    .groupBy(schema.tournaments.ruleset);

  const dates = new Map<Ruleset, Date>();

  for (const { ruleset, startTime } of rows) {
    const parsed = startTime ? new Date(startTime) : null;

    if (parsed && !Number.isNaN(parsed.valueOf())) {
      dates.set(ruleset as Ruleset, parsed);
    }
  }

  return dates;
};
