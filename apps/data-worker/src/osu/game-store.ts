import { and, eq, not } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import {
  cascadeGameRejection,
  cascadeMatchRejection,
} from '@otr/core/db/rejection-cascade';
import {
  GameRejectionReason,
  ScoreRejectionReason,
  VerificationStatus,
} from '@otr/core/osu/enums';

import type { DatabaseClient } from '../db';
import { ensureBeatmapPlaceholder } from './beatmap-store';
import type { FetchedGame, FetchedScore, PlayerMeta } from './match-source';
import { getOrCreatePlayerId } from './player-store';

type Transaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

interface StoredGame {
  id: number;
  osuId: number;
  verificationStatus: number;
}

export interface StoreFetchedGamesOptions {
  match: { id: number; verificationStatus: number };
  /** The games of the match and of every match merged into it. */
  games: readonly FetchedGame[];
  /** Player IDs by osu! user ID, for the users the matches list. */
  playerIds: ReadonlyMap<number, number>;
  users: ReadonlyMap<number, PlayerMeta>;
  nowIso: string;
}

/**
 * Stores fetched games and scores in a match and returns the osu! IDs of the
 * beatmaps it marked for fetching. The caller queues those in the same
 * transaction.
 *
 * A stored game or score takes osu!'s values, except the fields an admin
 * edited, which the database keeps. Its status and rejection reason stay
 * as they are; a rejected match or game passes its rejection down again
 * afterwards. A game or score an admin deleted is not stored again, and the
 * scores of a game an admin merged into another go to that game.
 */
export async function storeFetchedGames(
  tx: Transaction,
  options: StoreFetchedGamesOptions
): Promise<number[]> {
  const { match, nowIso } = options;
  const isMatchRejected =
    match.verificationStatus === VerificationStatus.Rejected;

  const storedGames = await tx
    .select({
      id: schema.games.id,
      osuId: schema.games.osuId,
      verificationStatus: schema.games.verificationStatus,
    })
    .from(schema.games)
    .where(eq(schema.games.matchId, match.id));
  const gamesByOsuId = new Map(storedGames.map((game) => [game.osuId, game]));
  const gamesById = new Map(storedGames.map((game) => [game.id, game]));

  const exclusions = await tx
    .select({
      osuGameId: schema.fetchExclusions.osuGameId,
      playerId: schema.fetchExclusions.playerId,
      mergedIntoGameId: schema.fetchExclusions.mergedIntoGameId,
    })
    .from(schema.fetchExclusions)
    .where(eq(schema.fetchExclusions.matchId, match.id));
  const excludedGames = new Map<number, number | null>();
  const excludedScores = new Set<string>();
  for (const exclusion of exclusions) {
    if (exclusion.playerId == null) {
      excludedGames.set(exclusion.osuGameId, exclusion.mergedIntoGameId);
    } else {
      excludedScores.add(scoreKey(exclusion.osuGameId, exclusion.playerId));
    }
  }

  const beatmapsToQueue = new Set<number>();
  const rejectedGameIds = new Set<number>();

  for (const game of options.games) {
    let target = gamesByOsuId.get(game.osuId);

    if (target) {
      const beatmapId = await placeBeatmap(tx, game, nowIso, beatmapsToQueue);
      await tx
        .update(schema.games)
        .set({ ...game.fields, beatmapId, updated: nowIso })
        .where(eq(schema.games.id, target.id));
    } else if (excludedGames.has(game.osuId)) {
      // Deleted, or merged into the game that now holds its scores.
      const mergedIntoGameId = excludedGames.get(game.osuId);
      target =
        mergedIntoGameId == null ? undefined : gamesById.get(mergedIntoGameId);
      if (!target) {
        continue;
      }
    } else {
      const beatmapId = await placeBeatmap(tx, game, nowIso, beatmapsToQueue);
      const [inserted] = await tx
        .insert(schema.games)
        .values({
          osuId: game.osuId,
          matchId: match.id,
          ...game.fields,
          beatmapId,
          updated: nowIso,
          verificationStatus: isMatchRejected
            ? VerificationStatus.Rejected
            : VerificationStatus.None,
          rejectionReason: isMatchRejected
            ? GameRejectionReason.RejectedMatch
            : 0,
          warningFlags: 0,
        })
        .returning({
          id: schema.games.id,
          osuId: schema.games.osuId,
          verificationStatus: schema.games.verificationStatus,
        });

      if (!inserted) {
        throw new Error('Failed to insert game');
      }

      target = inserted;
      gamesByOsuId.set(inserted.osuId, inserted);
      gamesById.set(inserted.id, inserted);
    }

    await storeScores(tx, {
      game: target,
      scores: game.scores,
      isParentRejected:
        isMatchRejected ||
        target.verificationStatus === VerificationStatus.Rejected,
      excludedScores,
      playerIds: options.playerIds,
      users: options.users,
      nowIso,
    });

    if (
      !isMatchRejected &&
      target.verificationStatus === VerificationStatus.Rejected
    ) {
      rejectedGameIds.add(target.id);
    }
  }

  if (isMatchRejected) {
    await cascadeMatchRejection(tx, [match.id], { updatedAt: nowIso });
  } else if (rejectedGameIds.size > 0) {
    await cascadeGameRejection(tx, [...rejectedGameIds], {
      updatedAt: nowIso,
    });
  }

  return [...beatmapsToQueue];
}

function scoreKey(osuGameId: number, playerId: number) {
  return `${osuGameId}:${playerId}`;
}

async function storeScores(
  tx: Transaction,
  options: {
    game: StoredGame;
    scores: readonly FetchedScore[];
    isParentRejected: boolean;
    excludedScores: ReadonlySet<string>;
    playerIds: ReadonlyMap<number, number>;
    users: ReadonlyMap<number, PlayerMeta>;
    nowIso: string;
  }
) {
  const { game, nowIso } = options;

  const storedScores = await tx
    .select({
      id: schema.gameScores.id,
      playerId: schema.gameScores.playerId,
    })
    .from(schema.gameScores)
    .where(eq(schema.gameScores.gameId, game.id));
  const scoreIdsByPlayer = new Map(
    storedScores.map((score) => [score.playerId, score.id])
  );

  for (const score of options.scores) {
    const playerId =
      options.playerIds.get(score.osuUserId) ??
      (await getOrCreatePlayerId(
        tx,
        score.osuUserId,
        options.users.get(score.osuUserId)
      ));

    const values = { ...score.fields, placement: 0, updated: nowIso };
    const storedId = scoreIdsByPlayer.get(playerId);

    if (storedId != null) {
      await tx
        .update(schema.gameScores)
        .set(values)
        .where(eq(schema.gameScores.id, storedId));
      continue;
    }

    if (options.excludedScores.has(scoreKey(game.osuId, playerId))) {
      continue;
    }

    const [inserted] = await tx
      .insert(schema.gameScores)
      .values({
        gameId: game.id,
        playerId,
        ...values,
        verificationStatus: options.isParentRejected
          ? VerificationStatus.Rejected
          : VerificationStatus.None,
        rejectionReason: options.isParentRejected
          ? ScoreRejectionReason.RejectedGame
          : 0,
      })
      .returning({ id: schema.gameScores.id });

    if (inserted) {
      scoreIdsByPlayer.set(playerId, inserted.id);
    }
  }
}

/**
 * The game's beatmap row, created as a placeholder when it is new. A
 * placeholder not yet fetched is marked as fetching and added to `queue`.
 */
async function placeBeatmap(
  tx: Transaction,
  game: FetchedGame,
  nowIso: string,
  queue: Set<number>
): Promise<number> {
  const beatmap = await ensureBeatmapPlaceholder(
    tx,
    game.osuBeatmapId,
    DataFetchStatus.NotFetched,
    nowIso
  );

  if (beatmap.dataFetchStatus === DataFetchStatus.NotFetched) {
    const [marked] = await tx
      .update(schema.beatmaps)
      .set({ dataFetchStatus: DataFetchStatus.Fetching, updated: nowIso })
      .where(
        and(
          eq(schema.beatmaps.id, beatmap.id),
          eq(schema.beatmaps.dataFetchStatus, DataFetchStatus.NotFetched),
          not(schema.beatmaps.manualOverride)
        )
      )
      .returning({ id: schema.beatmaps.id });

    if (marked) {
      queue.add(game.osuBeatmapId);
    }
  }

  return beatmap.id;
}
