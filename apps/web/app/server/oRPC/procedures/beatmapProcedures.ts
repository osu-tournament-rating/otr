import { ORPCError } from '@orpc/server';
import { and, asc, desc, eq, ne, not, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import * as schema from '@otr/core/db/schema';
import { Mods, Ruleset, TeamType, VerificationStatus } from '@otr/core/osu';
import {
  BeatmapStatsResponseSchema,
  type BeatmapStatsResponse,
  type BeatmapTournamentUsage,
  type BeatmapUsagePoint,
  type BeatmapModDistribution,
  type BeatmapModScoreDistribution,
  type BeatmapPerformanceSummary,
  type BeatmapScorePercentilePoint,
  type BeatmapScoreSample,
  type BeatmapClosenessSummary,
  type BeatmapTierBreakdown,
  type BeatmapTierScoreSummary,
  type BeatmapTopPerformer,
} from '@/lib/orpc/schema/beatmapStats';
import { summarizeCloseness } from '@/lib/beatmaps/closeness';
import { getRankRangeBucketKey } from '@/lib/beatmaps/rankRange';
import { tierNames } from '@/lib/utils/tierData';
import { getRelatedBeatmapDifficulties } from '@/lib/orpc/queries/relatedBeatmapDifficulties';

import { publicProcedure } from './base';
import {
  CHARTED_SCORE_MODS_MASK,
  STRIPPED_SCORE_MODS_MASK,
  TIER_BREAKDOWN_MAX_TIER_INDEX,
  TIER_RATING_BOUNDARIES,
  summarizeFreemodPicks,
  summarizePoolDisplayMods,
  summarizeRankRangeMods,
} from './beatmapStatsHelpers';
import { KeyTypeSchema, resolveBeatmapId } from './shared/keyType';

/** Verified scores surfaced by the beatmap page's score table. */
const TOP_PERFORMER_LIMIT = 25;

const SCORE_SAMPLE_LIMIT = 1000;

/** Mod groups below this many verified scores are noise for a box plot. */
const SCORE_DISTRIBUTION_MIN_GROUP_SIZE = 5;

const NIGHTCORE_SQL = sql.raw(String(Mods.Nightcore));
const DOUBLE_TIME_SQL = sql.raw(String(Mods.DoubleTime));
const STRIPPED_MODS_SQL = sql.raw(String(STRIPPED_SCORE_MODS_MASK));
const CHARTED_MODS_SQL = sql.raw(String(CHARTED_SCORE_MODS_MASK));

// SQL mirror of isChartedScoreMods; the beatmapModNormalization test asserts parity
const CHARTED_SCORE_MODS_FILTER = sql`(${schema.gameScores.mods} & ~${CHARTED_MODS_SQL}) = 0`;

// SQL mirror of normalizeScoreModsArithmetic; the beatmapModNormalization test asserts parity
const NORMALIZED_SCORE_MODS_SQL = sql<number>`
  CASE
    WHEN (${schema.gameScores.mods} & ${NIGHTCORE_SQL}) <> 0
      THEN ((${schema.gameScores.mods} & ~(${NIGHTCORE_SQL} | ${STRIPPED_MODS_SQL})) | ${DOUBLE_TIME_SQL})
    ELSE (${schema.gameScores.mods} & ~${STRIPPED_MODS_SQL})
  END`;

// Ascending boundaries, so width_bucket returns an index into tierNames
const TIER_BOUNDARIES_SQL = sql.raw(
  `ARRAY[${TIER_RATING_BOUNDARIES.join(',')}]::float8[]`
);

// Clamps the bucket index so Elite Grandmaster groups with Grandmaster
const TIER_BREAKDOWN_MAX_TIER_INDEX_SQL = sql.raw(
  String(TIER_BREAKDOWN_MAX_TIER_INDEX)
);

const playerCompactColumns = {
  id: schema.players.id,
  osuId: schema.players.osuId,
  username: schema.players.username,
  country: schema.players.country,
  defaultRuleset: schema.players.defaultRuleset,
} as const;

/** Clamps a stored accuracy aggregate into the 0–1 the response schema allows. */
function toAccuracyFraction(value: number | string | null): number | null {
  if (value == null) return null;

  const fraction = Number(value);
  if (!Number.isFinite(fraction)) return null;

  return Math.min(1, Math.max(0, fraction));
}

export const getBeatmapStats = publicProcedure
  .input(
    z.object({
      id: z.number().int().positive(),
      keyType: KeyTypeSchema,
    })
  )
  .output(BeatmapStatsResponseSchema)
  .route({
    summary: 'Get beatmap statistics',
    description:
      'Fetch beatmap statistics by ID.\n\n' +
      '**Examples:**\n' +
      '- By o!TR ID: `GET /beatmaps/123/stats`\n' +
      '- By osu! ID: `GET /beatmaps/4504101/stats?keyType=osu`',
    tags: ['public'],
    method: 'GET',
    path: '/beatmaps/{id}/stats',
  })
  .handler(async ({ input, context }) => {
    try {
      const beatmapId = await resolveBeatmapId(
        context.db,
        input.id,
        input.keyType
      );

      const fullyVerifiedGame = sql`(${eq(schema.tournaments.verificationStatus, VerificationStatus.Verified)} AND ${eq(schema.matches.verificationStatus, VerificationStatus.Verified)} AND ${eq(schema.games.verificationStatus, VerificationStatus.Verified)})`;
      const verifiedGameFilter = and(
        eq(schema.games.beatmapId, beatmapId),
        fullyVerifiedGame
      );
      const verifiedScoreFilter = and(
        verifiedGameFilter,
        eq(schema.gameScores.verificationStatus, VerificationStatus.Verified)
      );

      // Score-quartile aggregates chart only the standard mod set; everything else counts every verified score
      const chartedScoreFilter = and(
        verifiedScoreFilter,
        CHARTED_SCORE_MODS_FILTER
      );

      // Team Vs games the closeness summary skips, held out only by verification
      const excludedClosenessGames = context.db
        .select({ gameId: schema.games.id })
        .from(schema.gameRosters)
        .innerJoin(schema.games, eq(schema.games.id, schema.gameRosters.gameId))
        .innerJoin(schema.matches, eq(schema.matches.id, schema.games.matchId))
        .innerJoin(
          schema.tournaments,
          eq(schema.tournaments.id, schema.matches.tournamentId)
        )
        .where(
          and(
            eq(schema.games.beatmapId, beatmapId),
            eq(schema.games.teamType, TeamType.TeamVs),
            not(fullyVerifiedGame)
          )
        )
        .groupBy(schema.games.id)
        .having(sql`COUNT(*) = 2`)
        .as('excluded_closeness_games');

      const [
        beatmapRow,
        creatorsRows,
        summaryRow,
        totalPlayedSummaryRow,
        poolingRow,
        usageRows,
        tournamentRows,
        avgRows,
        modRows,
        topPerformerRows,
        scoreDistributionRows,
        scoreCdfRows,
        scoreSampleRows,
        performanceCountRows,
        missBucketRows,
        gradeCountRows,
        freemodPickRows,
        rankRangeModRows,
        tierBreakdownRows,
        closenessGameRows,
        excludedClosenessGameRows,
      ] = await Promise.all([
        context.db
          .select({
            id: schema.beatmaps.id,
            osuId: schema.beatmaps.osuId,
            ruleset: schema.beatmaps.ruleset,
            rankedStatus: schema.beatmaps.rankedStatus,
            diffName: schema.beatmaps.diffName,
            totalLength: schema.beatmaps.totalLength,
            drainLength: schema.beatmaps.drainLength,
            bpm: schema.beatmaps.bpm,
            countCircle: schema.beatmaps.countCircle,
            countSlider: schema.beatmaps.countSlider,
            countSpinner: schema.beatmaps.countSpinner,
            cs: schema.beatmaps.cs,
            hp: schema.beatmaps.hp,
            od: schema.beatmaps.od,
            ar: schema.beatmaps.ar,
            sr: schema.beatmaps.sr,
            maxCombo: schema.beatmaps.maxCombo,
            beatmapsetId: schema.beatmaps.beatmapsetId,
            dataFetchStatus: schema.beatmaps.dataFetchStatus,
            manualOverride: schema.beatmaps.manualOverride,
            beatmapTitleOverride: schema.beatmaps.titleOverride,
            beatmapArtistOverride: schema.beatmaps.artistOverride,
            setOwnerIdOverride: schema.beatmaps.setOwnerIdOverride,
            beatmapsetOsuId: schema.beatmapsets.osuId,
            artist: schema.beatmapsets.artist,
            title: schema.beatmapsets.title,
            creatorId: schema.beatmapsets.creatorId,
            creatorOsuId: schema.players.osuId,
            creatorUsername: schema.players.username,
            creatorCountry: schema.players.country,
            creatorDefaultRuleset: schema.players.defaultRuleset,
          })
          .from(schema.beatmaps)
          .leftJoin(
            schema.beatmapsets,
            eq(schema.beatmaps.beatmapsetId, schema.beatmapsets.id)
          )
          .leftJoin(
            schema.players,
            eq(schema.beatmapsets.creatorId, schema.players.id)
          )
          .where(eq(schema.beatmaps.id, beatmapId))
          .limit(1),
        context.db
          .select(playerCompactColumns)
          .from(schema.joinBeatmapCreators)
          .innerJoin(
            schema.players,
            eq(schema.joinBeatmapCreators.creatorsId, schema.players.id)
          )
          .where(eq(schema.joinBeatmapCreators.createdBeatmapsId, beatmapId)),
        context.db
          .select({
            totalGameCount: sql<number>`COUNT(DISTINCT ${schema.games.id})`,
          })
          .from(schema.games)
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(
            and(
              eq(schema.games.beatmapId, beatmapId),
              eq(
                schema.tournaments.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(
                schema.matches.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(schema.games.verificationStatus, VerificationStatus.Verified)
            )
          ),
        // Usage credit, not a statistic — see totalPlayedGameCount in lib/orpc/schema/beatmapStats.
        context.db
          .select({
            totalGameCount: sql<number>`COUNT(DISTINCT ${schema.games.id})`,
          })
          .from(schema.games)
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(
            and(
              eq(schema.games.beatmapId, beatmapId),
              or(
                ne(
                  schema.tournaments.verificationStatus,
                  VerificationStatus.Verified
                ),
                and(
                  eq(
                    schema.matches.verificationStatus,
                    VerificationStatus.Verified
                  ),
                  eq(
                    schema.games.verificationStatus,
                    VerificationStatus.Verified
                  )
                )
              )
            )
          ),
        // Unfiltered by verification; verifiedTournamentCount reports the verified subset
        context.db
          .select({
            totalTournamentCount: sql<number>`COUNT(DISTINCT ${schema.joinPooledBeatmaps.tournamentsPooledInId})`,
            verifiedTournamentCount: sql<number>`COUNT(DISTINCT ${schema.joinPooledBeatmaps.tournamentsPooledInId}) FILTER (WHERE ${schema.tournaments.verificationStatus} = ${VerificationStatus.Verified})`,
            playedTournamentCount: sql<number>`COUNT(DISTINCT ${schema.joinPooledBeatmaps.tournamentsPooledInId}) FILTER (WHERE ${schema.games.id} IS NOT NULL)`,
          })
          .from(schema.joinPooledBeatmaps)
          .innerJoin(
            schema.tournaments,
            eq(
              schema.tournaments.id,
              schema.joinPooledBeatmaps.tournamentsPooledInId
            )
          )
          .leftJoin(
            schema.matches,
            eq(schema.matches.tournamentId, schema.tournaments.id)
          )
          .leftJoin(
            schema.games,
            and(
              eq(schema.games.matchId, schema.matches.id),
              eq(schema.games.beatmapId, beatmapId)
            )
          )
          .where(eq(schema.joinPooledBeatmaps.pooledBeatmapsId, beatmapId)),
        context.db
          .select({
            quarter: sql<string>`TO_CHAR(${schema.games.startTime}, 'YYYY-"Q"Q')`,
            gameCount: sql<number>`COUNT(DISTINCT ${schema.games.id})`,
          })
          .from(schema.games)
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(
            and(
              eq(schema.games.beatmapId, beatmapId),
              eq(
                schema.tournaments.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(
                schema.matches.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(schema.games.verificationStatus, VerificationStatus.Verified)
            )
          )
          .groupBy(sql`TO_CHAR(${schema.games.startTime}, 'YYYY-"Q"Q')`)
          .orderBy(sql`TO_CHAR(${schema.games.startTime}, 'YYYY-"Q"Q')`),
        context.db
          .select({
            tournamentId: schema.tournaments.id,
            tournamentName: schema.tournaments.name,
            // Not in the response; only buckets the tournament into a usageOverTime quarter
            tournamentStartTime: schema.tournaments.startTime,
            tournamentEndTime: schema.tournaments.endTime,
            tournamentLobbySize: schema.tournaments.lobbySize,
            tournamentVerificationStatus: schema.tournaments.verificationStatus,
            tournamentRejectionReason: schema.tournaments.rejectionReason,
            tournamentRankRangeLowerBound:
              schema.tournaments.rankRangeLowerBound,
            gameCount: sql<number>`COUNT(DISTINCT ${schema.games.id})`,
            firstPlayedAt: sql<string>`MIN(${schema.games.startTime})`,
            // MODE() ignores nulls, so this is null exactly when there are no verified games here
            mostCommonMods: sql<
              number | null
            >`MODE() WITHIN GROUP (ORDER BY ${schema.games.mods})`,
          })
          .from(schema.joinPooledBeatmaps)
          .innerJoin(
            schema.tournaments,
            eq(
              schema.tournaments.id,
              schema.joinPooledBeatmaps.tournamentsPooledInId
            )
          )
          .leftJoin(
            schema.matches,
            and(
              eq(schema.matches.tournamentId, schema.tournaments.id),
              eq(schema.matches.verificationStatus, VerificationStatus.Verified)
            )
          )
          .leftJoin(
            schema.games,
            and(
              eq(schema.games.matchId, schema.matches.id),
              eq(schema.games.beatmapId, beatmapId),
              eq(schema.games.verificationStatus, VerificationStatus.Verified)
            )
          )
          .where(eq(schema.joinPooledBeatmaps.pooledBeatmapsId, beatmapId))
          // Postgres infers the functional dependency for the other tournaments columns
          .groupBy(schema.tournaments.id)
          .orderBy(desc(sql`COUNT(DISTINCT ${schema.games.id})`)),
        context.db
          .select({
            tournamentId: schema.tournaments.id,
            scoreCount: sql<number>`COUNT(*)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(
            and(
              eq(schema.games.beatmapId, beatmapId),
              eq(
                schema.tournaments.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(
                schema.matches.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(schema.games.verificationStatus, VerificationStatus.Verified),
              eq(
                schema.gameScores.verificationStatus,
                VerificationStatus.Verified
              )
            )
          )
          .groupBy(schema.tournaments.id),
        context.db
          .select({
            mods: schema.gameScores.mods,
            scoreCount: sql<number>`COUNT(*)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(
            and(
              eq(schema.games.beatmapId, beatmapId),
              eq(
                schema.tournaments.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(
                schema.matches.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(schema.games.verificationStatus, VerificationStatus.Verified),
              eq(
                schema.gameScores.verificationStatus,
                VerificationStatus.Verified
              )
            )
          )
          .groupBy(schema.gameScores.mods)
          .orderBy(desc(sql`COUNT(*)`)),
        context.db
          .select({
            playerId: schema.players.id,
            playerOsuId: schema.players.osuId,
            playerUsername: schema.players.username,
            playerCountry: schema.players.country,
            playerDefaultRuleset: schema.players.defaultRuleset,
            score: schema.gameScores.score,
            grade: schema.gameScores.grade,
            accuracy: schema.gameScores.accuracy,
            mods: schema.gameScores.mods,
            lazerMods: schema.gameScores.lazerMods,
            playedAt: schema.games.startTime,
            matchId: schema.matches.id,
            gameId: schema.games.id,
            scoreId: schema.gameScores.id,
            tournamentId: schema.tournaments.id,
            tournamentName: schema.tournaments.name,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .innerJoin(
            schema.players,
            eq(schema.players.id, schema.gameScores.playerId)
          )
          .where(
            and(
              eq(schema.games.beatmapId, beatmapId),
              eq(
                schema.tournaments.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(
                schema.matches.verificationStatus,
                VerificationStatus.Verified
              ),
              eq(schema.games.verificationStatus, VerificationStatus.Verified),
              eq(
                schema.gameScores.verificationStatus,
                VerificationStatus.Verified
              )
            )
          )
          .orderBy(desc(schema.gameScores.score))
          .limit(TOP_PERFORMER_LIMIT),
        // Quartile summary of charted-mod scores per normalized combination.
        context.db
          .select({
            mods: NORMALIZED_SCORE_MODS_SQL.as('normalized_mods'),
            scoreCount: sql<number>`COUNT(*)`,
            minScore: sql<number>`MIN(${schema.gameScores.score})`,
            p20Score: sql<number>`PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            p25Score: sql<number>`PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            medianScore: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            p75Score: sql<number>`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            maxScore: sql<number>`MAX(${schema.gameScores.score})`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(chartedScoreFilter)
          .groupBy(sql`normalized_mods`)
          .having(
            sql`COUNT(*) >= ${sql.raw(String(SCORE_DISTRIBUTION_MIN_GROUP_SIZE))}`
          )
          .orderBy(desc(sql`COUNT(*)`), asc(sql`normalized_mods`)),
        // Score CDF: one interpolated quantile per whole percentile, 0..100
        context.db
          .select({
            scores: sql<
              number[] | null
            >`PERCENTILE_CONT((SELECT ARRAY_AGG(g / 100.0 ORDER BY g) FROM generate_series(0, 100) AS g)) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            scoreCount: sql<number>`COUNT(*)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(chartedScoreFilter),
        // Deterministic scatter sample; rating_before is null without a processor adjustment
        context.db
          .select({
            scoreId: schema.gameScores.id,
            score: schema.gameScores.score,
            mods: schema.gameScores.mods,
            rating: schema.ratingAdjustments.ratingBefore,
            rankRangeLowerBound: schema.tournaments.rankRangeLowerBound,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .leftJoin(
            schema.ratingAdjustments,
            and(
              eq(schema.ratingAdjustments.playerId, schema.gameScores.playerId),
              eq(schema.ratingAdjustments.matchId, schema.matches.id)
            )
          )
          .where(verifiedScoreFilter)
          .orderBy(sql`md5(${schema.gameScores.id}::text)`)
          .limit(SCORE_SAMPLE_LIMIT),
        // Miss-data scalar counts.
        context.db
          .select({
            scoreCount: sql<number>`COUNT(*)`,
            missDataScoreCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.gameScores.statMiss} IS NOT NULL)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(verifiedScoreFilter),
        // Miss buckets (5 = "5 or more"), only where miss data exists.
        context.db
          .select({
            misses: sql<number>`LEAST(${schema.gameScores.statMiss}, 5)`.as(
              'misses'
            ),
            scoreCount: sql<number>`COUNT(*)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(
            and(
              verifiedScoreFilter,
              sql`${schema.gameScores.statMiss} IS NOT NULL`
            )
          )
          .groupBy(sql`misses`)
          .orderBy(asc(sql`misses`)),
        // Grade counts by persisted ScoreGrade ordinal.
        context.db
          .select({
            grade: schema.gameScores.grade,
            scoreCount: sql<number>`COUNT(*)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(verifiedScoreFilter)
          .groupBy(schema.gameScores.grade)
          .orderBy(asc(schema.gameScores.grade)),
        // Distinct (game, game mods, score mods) rows; freemod detection stays
        // in TS via deriveGameIsFreeMod so the convention matches everywhere.
        context.db
          .select({
            tournamentId: schema.tournaments.id,
            gameId: schema.games.id,
            gameMods: schema.games.mods,
            scoreMods: schema.gameScores.mods,
            scoreCount: sql<number>`COUNT(*)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(verifiedScoreFilter)
          .groupBy(
            schema.tournaments.id,
            schema.games.id,
            schema.games.mods,
            schema.gameScores.mods
          )
          .orderBy(asc(schema.games.id), asc(schema.gameScores.mods)),
        // Bucketing stays in TS via summarizeRankRangeMods
        context.db
          .select({
            rankRangeLowerBound: schema.tournaments.rankRangeLowerBound,
            mods: NORMALIZED_SCORE_MODS_SQL.as('normalized_mods'),
            scoreCount: sql<number>`COUNT(*)`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(verifiedScoreFilter)
          .groupBy(
            schema.tournaments.rankRangeLowerBound,
            sql`normalized_mods`
          ),
        // Quartiles per rating tier; the inner join drops unrated scores rather than
        // falling back to player_ratings
        context.db
          .select({
            tierIndex:
              sql<number>`LEAST(width_bucket(${schema.ratingAdjustments.ratingBefore}, ${TIER_BOUNDARIES_SQL}), ${TIER_BREAKDOWN_MAX_TIER_INDEX_SQL})`.as(
                'tier_index'
              ),
            scoreCount: sql<number>`COUNT(*)`,
            minScore: sql<number>`MIN(${schema.gameScores.score})`,
            p20Score: sql<number>`PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            p25Score: sql<number>`PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            medianScore: sql<number>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            p75Score: sql<number>`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${schema.gameScores.score})`,
            maxScore: sql<number>`MAX(${schema.gameScores.score})`,
            minAccuracy: sql<number | null>`MIN(${schema.gameScores.accuracy})`,
            p20Accuracy: sql<
              number | null
            >`PERCENTILE_CONT(0.20) WITHIN GROUP (ORDER BY ${schema.gameScores.accuracy}) FILTER (WHERE ${schema.gameScores.accuracy} IS NOT NULL)`,
            p25Accuracy: sql<
              number | null
            >`PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${schema.gameScores.accuracy}) FILTER (WHERE ${schema.gameScores.accuracy} IS NOT NULL)`,
            medianAccuracy: sql<
              number | null
            >`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${schema.gameScores.accuracy}) FILTER (WHERE ${schema.gameScores.accuracy} IS NOT NULL)`,
            p75Accuracy: sql<
              number | null
            >`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${schema.gameScores.accuracy}) FILTER (WHERE ${schema.gameScores.accuracy} IS NOT NULL)`,
            maxAccuracy: sql<number | null>`MAX(${schema.gameScores.accuracy})`,
          })
          .from(schema.gameScores)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameScores.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .innerJoin(
            schema.ratingAdjustments,
            and(
              eq(schema.ratingAdjustments.playerId, schema.gameScores.playerId),
              eq(schema.ratingAdjustments.matchId, schema.matches.id)
            )
          )
          .where(chartedScoreFilter)
          .groupBy(sql`tier_index`)
          .orderBy(asc(sql`tier_index`)),
        // Equal rosters and a non-zero losing score keep ln(winning / losing) defined.
        // The cohort key reads games.ruleset, which routinely disagrees with beatmaps.ruleset
        context.db
          .select({
            logRatio: sql<number>`LN(MAX(${schema.gameRosters.score})::float8 / MIN(${schema.gameRosters.score}))`,
            ruleset: schema.games.ruleset,
            teamSize: sql<number>`LEAST(MAX(cardinality(${schema.gameRosters.roster})), 5)`,
          })
          .from(schema.gameRosters)
          .innerJoin(
            schema.games,
            eq(schema.games.id, schema.gameRosters.gameId)
          )
          .innerJoin(
            schema.matches,
            eq(schema.matches.id, schema.games.matchId)
          )
          .innerJoin(
            schema.tournaments,
            eq(schema.tournaments.id, schema.matches.tournamentId)
          )
          .where(
            and(verifiedGameFilter, eq(schema.games.teamType, TeamType.TeamVs))
          )
          .groupBy(schema.games.id, schema.games.ruleset)
          .having(
            sql`COUNT(*) = 2
              AND MAX(cardinality(${schema.gameRosters.roster})) = MIN(cardinality(${schema.gameRosters.roster}))
              AND MIN(${schema.gameRosters.score}) > 0`
          ),
        context.db
          .select({ gameCount: sql<number>`COUNT(*)` })
          .from(excludedClosenessGames),
      ]);

      const beatmap = beatmapRow[0]!;

      const relatedDifficultyRows = await getRelatedBeatmapDifficulties(
        context.db,
        beatmap.beatmapsetId
      );

      const setOwnerOverrideRows = beatmap.setOwnerIdOverride
        ? await context.db
            .select({
              id: schema.players.id,
              osuId: schema.players.osuId,
              username: schema.players.username,
              country: schema.players.country,
              defaultRuleset: schema.players.defaultRuleset,
            })
            .from(schema.players)
            .where(eq(schema.players.id, beatmap.setOwnerIdOverride))
            .limit(1)
        : [];

      const setOwnerOverride = setOwnerOverrideRows[0]
        ? {
            id: setOwnerOverrideRows[0].id,
            osuId: setOwnerOverrideRows[0].osuId,
            username: setOwnerOverrideRows[0].username,
            country: setOwnerOverrideRows[0].country,
            defaultRuleset: setOwnerOverrideRows[0].defaultRuleset as Ruleset,
          }
        : null;

      const creators = creatorsRows.map((row) => ({
        id: row.id,
        osuId: row.osuId,
        username: row.username,
        country: row.country,
        defaultRuleset: row.defaultRuleset as Ruleset,
      }));

      const summary = {
        totalGameCount: Number(summaryRow[0]?.totalGameCount ?? 0),
        totalTournamentCount: Number(poolingRow[0]?.totalTournamentCount ?? 0),
        verifiedTournamentCount: Number(
          poolingRow[0]?.verifiedTournamentCount ?? 0
        ),
        totalPlayedGameCount: Number(
          totalPlayedSummaryRow[0]?.totalGameCount ?? 0
        ),
        pooledPlayedTournamentCount: Number(
          poolingRow[0]?.playedTournamentCount ?? 0
        ),
      };

      const getQuarterKey = (date: Date): string => {
        const year = date.getFullYear();
        const quarter = Math.ceil((date.getMonth() + 1) / 3);
        return `${year}-Q${quarter}`;
      };

      const poolingByQuarter = new Map<string, Set<number>>();
      for (const t of tournamentRows) {
        const dateToUse = t.firstPlayedAt
          ? new Date(t.firstPlayedAt)
          : t.tournamentStartTime
            ? new Date(t.tournamentStartTime)
            : null;

        if (!dateToUse) continue;

        const quarterKey = getQuarterKey(dateToUse);
        if (!poolingByQuarter.has(quarterKey)) {
          poolingByQuarter.set(quarterKey, new Set());
        }
        poolingByQuarter.get(quarterKey)!.add(t.tournamentId);
      }

      const poolingCounts = new Map<string, number>();
      for (const [quarter, tournamentIds] of poolingByQuarter) {
        poolingCounts.set(quarter, tournamentIds.size);
      }

      const usageByQuarter = new Map<string, number>();
      for (const row of usageRows) {
        usageByQuarter.set(row.quarter, Number(row.gameCount));
      }

      const allQuarters = new Set([
        ...usageRows.map((r) => r.quarter),
        ...poolingCounts.keys(),
      ]);

      const parseQuarter = (q: string): [number, number] => {
        const [year, qNum] = q.split('-Q');
        return [parseInt(year, 10), parseInt(qNum, 10)];
      };

      const usageOverTime: BeatmapUsagePoint[] = [];
      if (allQuarters.size > 0) {
        const sortedQuarters = Array.from(allQuarters).sort();
        const [startYear, startQ] = parseQuarter(sortedQuarters[0]);
        const [lastYear, lastQ] = parseQuarter(
          sortedQuarters[sortedQuarters.length - 1]
        );

        // Extend through the current quarter so idle periods stay visible as empty bars
        const [currentYear, currentQ] = parseQuarter(getQuarterKey(new Date()));
        const [endYear, endQ] =
          currentYear > lastYear ||
          (currentYear === lastYear && currentQ > lastQ)
            ? [currentYear, currentQ]
            : [lastYear, lastQ];

        let year = startYear;
        let q = startQ;
        while (year < endYear || (year === endYear && q <= endQ)) {
          const quarterKey = `${year}-Q${q}`;
          usageOverTime.push({
            quarter: quarterKey,
            gameCount: usageByQuarter.get(quarterKey) ?? 0,
            pooledCount: poolingCounts.get(quarterKey) ?? 0,
          });
          q++;
          if (q > 4) {
            q = 1;
            year++;
          }
        }
      }

      const scoreCountByTournament = new Map(
        avgRows.map((row) => [row.tournamentId, Number(row.scoreCount)])
      );

      const poolModsByTournament = summarizePoolDisplayMods(
        freemodPickRows.map((row) => ({
          tournamentId: row.tournamentId,
          gameId: row.gameId,
          gameMods: row.gameMods,
          scoreMods: row.scoreMods,
          scoreCount: Number(row.scoreCount),
        }))
      );

      const tournaments: BeatmapTournamentUsage[] = tournamentRows.map(
        (row) => {
          const poolMods = poolModsByTournament.get(row.tournamentId);

          return {
            tournament: {
              id: row.tournamentId,
              name: row.tournamentName,
            },
            gameCount: Number(row.gameCount),
            scoreCount: scoreCountByTournament.get(row.tournamentId) ?? 0,
            rankRangeLowerBound: row.tournamentRankRangeLowerBound,
            lobbySize: row.tournamentLobbySize,
            startTime: row.tournamentStartTime,
            endTime: row.tournamentEndTime,
            verificationStatus:
              row.tournamentVerificationStatus as VerificationStatus,
            rejectionReason: row.tournamentRejectionReason,
            // Falls back to the games' mode only when no verified score resolved the pool
            mostCommonMods: poolMods
              ? poolMods.mods
              : row.mostCommonMods == null
                ? null
                : Number(row.mostCommonMods),
            mostCommonModsFreemod: poolMods?.freemod ?? false,
          };
        }
      );

      const totalModScores = modRows.reduce(
        (acc, row) => acc + Number(row.scoreCount),
        0
      );
      const modDistribution: BeatmapModDistribution[] = modRows.map((row) => ({
        mods: row.mods,
        scoreCount: Number(row.scoreCount),
        percentage:
          totalModScores > 0
            ? (Number(row.scoreCount) / totalModScores) * 100
            : 0,
      }));

      const topPerformers: BeatmapTopPerformer[] = topPerformerRows.map(
        (row) => ({
          player: {
            id: row.playerId,
            osuId: row.playerOsuId,
            username: row.playerUsername,
            country: row.playerCountry,
            defaultRuleset: row.playerDefaultRuleset as Ruleset,
          },
          score: row.score,
          grade: row.grade,
          accuracy: toAccuracyFraction(row.accuracy),
          mods: row.mods,
          lazerMods: row.lazerMods,
          playedAt: row.playedAt,
          matchId: row.matchId,
          gameId: row.gameId,
          scoreId: row.scoreId,
          tournament: {
            id: row.tournamentId,
            name: row.tournamentName,
          },
        })
      );

      const scoreDistribution: BeatmapModScoreDistribution[] =
        scoreDistributionRows.map((row) => ({
          mods: Number(row.mods),
          scoreCount: Number(row.scoreCount),
          minScore: Number(row.minScore),
          p20Score: Math.round(Number(row.p20Score)),
          p25Score: Math.round(Number(row.p25Score)),
          medianScore: Math.round(Number(row.medianScore)),
          p75Score: Math.round(Number(row.p75Score)),
          maxScore: Number(row.maxScore),
        }));

      const cdfRow = scoreCdfRows[0];
      const chartedScoreCount = Number(cdfRow?.scoreCount ?? 0);
      const scorePercentiles: BeatmapScorePercentilePoint[] =
        chartedScoreCount > 0 && cdfRow?.scores != null
          ? cdfRow.scores.map((score, percentile) => ({
              percentile,
              score: Math.round(Number(score)),
            }))
          : [];

      // The scatter charts every verified score, so the denominator is unfiltered
      const scoreSample: BeatmapScoreSample = {
        totalScoreCount: Number(performanceCountRows[0]?.scoreCount ?? 0),
        points: [...scoreSampleRows]
          .sort((left, right) => left.scoreId - right.scoreId)
          .map((row) => ({
            score: row.score,
            // Pre-match rating only; null is expected on recent data
            rating: row.rating != null ? Number(row.rating) : null,
            mods: row.mods,
            rankRange: getRankRangeBucketKey(row.rankRangeLowerBound) ?? 'open',
          })),
      };

      const performanceCounts = performanceCountRows[0];
      const performance: BeatmapPerformanceSummary = {
        scoreCount: Number(performanceCounts?.scoreCount ?? 0),
        missDataScoreCount: Number(performanceCounts?.missDataScoreCount ?? 0),
        missDistribution: missBucketRows.map((row) => ({
          misses: Number(row.misses),
          scoreCount: Number(row.scoreCount),
        })),
        gradeDistribution: gradeCountRows.map((row) => ({
          grade: row.grade,
          scoreCount: Number(row.scoreCount),
        })),
      };

      const freemodPicks = summarizeFreemodPicks(
        freemodPickRows.map((row) => ({
          gameId: row.gameId,
          gameMods: row.gameMods,
          scoreMods: row.scoreMods,
          scoreCount: Number(row.scoreCount),
        }))
      );

      const rankRangeModDistribution = summarizeRankRangeMods(
        rankRangeModRows.map((row) => ({
          rankRangeLowerBound: row.rankRangeLowerBound,
          mods: Number(row.mods),
          scoreCount: Number(row.scoreCount),
        }))
      );

      // Sparse tiers are dropped from the rows but still counted in ratedScoreCount.
      let ratedScoreCount = 0;
      const tiers: BeatmapTierScoreSummary[] = [];
      for (const row of tierBreakdownRows) {
        const scoreCount = Number(row.scoreCount);
        ratedScoreCount += scoreCount;

        if (scoreCount < SCORE_DISTRIBUTION_MIN_GROUP_SIZE) continue;

        const tier = tierNames[Number(row.tierIndex)];
        if (tier == null) continue;

        tiers.push({
          tier,
          scoreCount,
          minScore: Number(row.minScore),
          p20Score: Math.round(Number(row.p20Score)),
          p25Score: Math.round(Number(row.p25Score)),
          medianScore: Math.round(Number(row.medianScore)),
          p75Score: Math.round(Number(row.p75Score)),
          maxScore: Number(row.maxScore),
          minAccuracy: toAccuracyFraction(row.minAccuracy),
          p20Accuracy: toAccuracyFraction(row.p20Accuracy),
          p25Accuracy: toAccuracyFraction(row.p25Accuracy),
          medianAccuracy: toAccuracyFraction(row.medianAccuracy),
          p75Accuracy: toAccuracyFraction(row.p75Accuracy),
          maxAccuracy: toAccuracyFraction(row.maxAccuracy),
        });
      }

      const tierBreakdown: BeatmapTierBreakdown = {
        ratedScoreCount,
        totalScoreCount: chartedScoreCount,
        tiers,
      };

      const closenessSummary = summarizeCloseness(
        closenessGameRows.map((row) => ({
          logRatio: Number(row.logRatio),
          ruleset: row.ruleset as Ruleset,
          teamSize: Number(row.teamSize),
        })),
        Number(excludedClosenessGameRows[0]?.gameCount ?? 0)
      );
      // meanZ and shrunkZ stay internal; the interval already carries the uncertainty
      const closeness: BeatmapClosenessSummary = {
        gameCount: closenessSummary.gameCount,
        excludedUnverifiedGameCount:
          closenessSummary.excludedUnverifiedGameCount,
        cohort: closenessSummary.cohort,
        reliability: closenessSummary.reliability,
        percentile: closenessSummary.percentile,
        percentileInterval: closenessSummary.percentileInterval,
        bins: closenessSummary.bins,
        baselineZDeciles: closenessSummary.baselineZDeciles
          ? [...closenessSummary.baselineZDeciles]
          : null,
        games: closenessSummary.games.map((game) => ({
          logRatio: game.logRatio,
          z: game.z,
          ruleset: game.ruleset,
          teamSize: game.teamSize,
        })),
      };

      const response: BeatmapStatsResponse = {
        beatmap: {
          id: beatmap.id,
          osuId: beatmap.osuId,
          ruleset: beatmap.ruleset as Ruleset,
          rankedStatus: beatmap.rankedStatus,
          manualOverride: beatmap.manualOverride,
          titleOverride: beatmap.beatmapTitleOverride,
          artistOverride: beatmap.beatmapArtistOverride,
          setOwnerIdOverride: beatmap.setOwnerIdOverride,
          diffName: beatmap.diffName,
          totalLength: beatmap.totalLength,
          drainLength: beatmap.drainLength,
          bpm: beatmap.bpm,
          countCircle: beatmap.countCircle,
          countSlider: beatmap.countSlider,
          countSpinner: beatmap.countSpinner,
          cs: beatmap.cs,
          hp: beatmap.hp,
          od: beatmap.od,
          ar: beatmap.ar,
          sr: beatmap.sr,
          maxCombo: beatmap.maxCombo,
          beatmapsetId: beatmap.beatmapsetId,
          dataFetchStatus: beatmap.dataFetchStatus,
          beatmapset: beatmap.beatmapsetOsuId
            ? {
                id: beatmap.beatmapsetId!,
                osuId: beatmap.beatmapsetOsuId,
                artist: beatmap.artist ?? 'Unknown',
                title: beatmap.title ?? 'Unknown',
                creatorId: beatmap.creatorId,
                rankedStatus: beatmap.rankedStatus,
                rankedDate: null,
                submittedDate: null,
                creator:
                  beatmap.creatorId && beatmap.creatorOsuId
                    ? {
                        id: beatmap.creatorId,
                        osuId: beatmap.creatorOsuId,
                        username: beatmap.creatorUsername ?? 'Unknown',
                        country: beatmap.creatorCountry ?? '',
                        defaultRuleset: (beatmap.creatorDefaultRuleset ??
                          Ruleset.Osu) as Ruleset,
                      }
                    : null,
              }
            : null,
          creators,
          setOwnerOverride,
        },
        relatedDifficulties: relatedDifficultyRows.map((difficulty) => ({
          osuId: difficulty.osuId,
          diffName: difficulty.diffName,
          ruleset: difficulty.ruleset as Ruleset,
          sr: difficulty.sr,
          pooledTournamentCount: Number(difficulty.pooledTournamentCount),
          verifiedGameCount: Number(difficulty.verifiedGameCount),
        })),
        summary,
        usageOverTime,
        tournaments,
        modDistribution,
        topPerformers,
        scoreDistribution,
        scorePercentiles,
        chartedScoreCount,
        scoreSample,
        performance,
        freemodPicks,
        rankRangeModDistribution,
        tierBreakdown,
        closeness,
      };

      return BeatmapStatsResponseSchema.parse(response);
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }

      console.error(
        '[orpc] beatmaps.stats failed',
        { beatmapId: input.id },
        error
      );

      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to load beatmap statistics',
      });
    }
  });
