import { ORPCError } from '@orpc/server';
import {
  SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lte,
  sql,
} from 'drizzle-orm';
import * as schema from '@otr/core/db/schema';
import { VerificationStatus } from '@otr/core/osu';

import {
  BeatmapListRequestSchema,
  BeatmapListResponseSchema,
  BeatmapListItemSchema,
} from '@/lib/orpc/schema/beatmapList';
import {
  beatmapIsVisible,
  buildBeatmapSearchExpressions,
} from '@/lib/orpc/queries/search';
import {
  calculateBeatmapListModDistribution,
  filterBeatmapModDistribution,
} from '@/lib/utils/mods';
import { publicProcedure, withSearchRateLimit } from './base';
import {
  buildBeatmapRulesetCondition,
  collectRulesets,
} from './shared/rulesetFilter';
import { logger } from '@/lib/logger';

const DEFAULT_MAX_SR = 200;

export const listBeatmaps = publicProcedure
  .input(BeatmapListRequestSchema)
  .use(withSearchRateLimit, (input) => input.searchQuery)
  .output(BeatmapListResponseSchema)
  .route({
    summary: 'List beatmaps with filtering and pagination',
    tags: ['public'],
    method: 'GET',
    path: '/beatmaps',
  })
  .handler(async ({ input, context }) => {
    try {
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const filters: SQL<unknown>[] = [];
      let searchRank: SQL<number> | null = null;

      if (input.searchQuery) {
        const searchExpressions = buildBeatmapSearchExpressions(
          input.searchQuery
        );
        if (searchExpressions) {
          filters.push(searchExpressions.condition);
          searchRank = searchExpressions.rank;
        }
      }

      if (input.minSr !== undefined)
        filters.push(gte(schema.beatmaps.sr, input.minSr));
      const effectiveMaxSr = input.maxSr ?? DEFAULT_MAX_SR;
      filters.push(lte(schema.beatmaps.sr, effectiveMaxSr));
      if (input.minBpm !== undefined)
        filters.push(gte(schema.beatmaps.bpm, input.minBpm));
      if (input.maxBpm !== undefined)
        filters.push(lte(schema.beatmaps.bpm, input.maxBpm));
      if (input.minCs !== undefined)
        filters.push(gte(schema.beatmaps.cs, input.minCs));
      if (input.maxCs !== undefined)
        filters.push(lte(schema.beatmaps.cs, input.maxCs));
      if (input.minAr !== undefined)
        filters.push(gte(schema.beatmaps.ar, input.minAr));
      if (input.maxAr !== undefined)
        filters.push(lte(schema.beatmaps.ar, input.maxAr));
      if (input.minOd !== undefined)
        filters.push(gte(schema.beatmaps.od, input.minOd));
      if (input.maxOd !== undefined)
        filters.push(lte(schema.beatmaps.od, input.maxOd));
      if (input.minHp !== undefined)
        filters.push(gte(schema.beatmaps.hp, input.minHp));
      if (input.maxHp !== undefined)
        filters.push(lte(schema.beatmaps.hp, input.maxHp));
      if (input.minLength !== undefined)
        filters.push(gte(schema.beatmaps.totalLength, input.minLength));
      if (input.maxLength !== undefined)
        filters.push(lte(schema.beatmaps.totalLength, input.maxLength));
      const rulesetCondition = buildBeatmapRulesetCondition(
        collectRulesets(input.ruleset, input.rulesets)
      );
      if (rulesetCondition) {
        filters.push(rulesetCondition);
      }

      if (input.minGameCount !== undefined) {
        filters.push(
          gte(
            sql`COALESCE(${schema.beatmapStats.verifiedGameCount}, 0)`,
            input.minGameCount
          )
        );
      }
      if (input.maxGameCount !== undefined) {
        filters.push(
          lte(
            sql`COALESCE(${schema.beatmapStats.verifiedGameCount}, 0)`,
            input.maxGameCount
          )
        );
      }
      if (input.minTournamentCount !== undefined) {
        filters.push(
          gte(
            sql`COALESCE(${schema.beatmapStats.verifiedTournamentCount}, 0)`,
            input.minTournamentCount
          )
        );
      }
      if (input.maxTournamentCount !== undefined) {
        filters.push(
          lte(
            sql`COALESCE(${schema.beatmapStats.verifiedTournamentCount}, 0)`,
            input.maxTournamentCount
          )
        );
      }

      filters.push(beatmapIsVisible());

      const whereClause = filters.length > 0 ? and(...filters) : undefined;

      const sortValue = input.sort;
      const direction = input.descending ? desc : asc;

      const getSortColumn = () => {
        switch (sortValue) {
          case 'sr':
            return schema.beatmaps.sr;
          case 'bpm':
            return schema.beatmaps.bpm;
          case 'cs':
            return schema.beatmaps.cs;
          case 'ar':
            return schema.beatmaps.ar;
          case 'od':
            return schema.beatmaps.od;
          case 'hp':
            return schema.beatmaps.hp;
          case 'length':
            return schema.beatmaps.totalLength;
          // Outer join, so a missing stats row must sort as 0 rather than NULL
          case 'tournamentCount':
            return sql`COALESCE(${schema.beatmapStats.verifiedTournamentCount}, 0)`;
          case 'gameCount':
            return sql`COALESCE(${schema.beatmapStats.verifiedGameCount}, 0)`;
          case 'creator':
            return schema.players.username;
          default:
            return schema.beatmaps.sr;
        }
      };

      const orderBy = [
        direction(getSortColumn()),
        ...(searchRank ? [desc(searchRank)] : []),
        direction(schema.beatmaps.id),
      ];

      // Without `beatmapIds`, the creator lookup groups every creator row
      const buildListQuery = (beatmapIds?: number[]) => {
        const creatorSubquery = context.db
          .select({
            beatmapId: schema.joinBeatmapCreators.createdBeatmapsId,
            creatorId:
              sql<number>`MIN(${schema.joinBeatmapCreators.creatorsId})`.as(
                'creator_id'
              ),
          })
          .from(schema.joinBeatmapCreators)
          .where(
            beatmapIds
              ? inArray(
                  schema.joinBeatmapCreators.createdBeatmapsId,
                  beatmapIds
                )
              : undefined
          )
          .groupBy(schema.joinBeatmapCreators.createdBeatmapsId)
          .as('beatmap_creator');

        return context.db
          .select({
            id: schema.beatmaps.id,
            osuId: schema.beatmaps.osuId,
            diffName: schema.beatmaps.diffName,
            ruleset: schema.beatmaps.ruleset,
            sr: schema.beatmaps.sr,
            bpm: schema.beatmaps.bpm,
            cs: schema.beatmaps.cs,
            ar: schema.beatmaps.ar,
            od: schema.beatmaps.od,
            hp: schema.beatmaps.hp,
            totalLength: schema.beatmaps.totalLength,
            artist:
              sql`coalesce(${schema.beatmaps.artistOverride}, ${schema.beatmapsets.artist})`.as(
                'artist'
              ),
            title:
              sql`coalesce(${schema.beatmaps.titleOverride}, ${schema.beatmapsets.title})`.as(
                'title'
              ),
            beatmapsetOsuId: schema.beatmapsets.osuId,
            creator: schema.players.username,
            verifiedTournamentCount:
              sql<number>`COALESCE(${schema.beatmapStats.verifiedTournamentCount}, 0)`.as(
                'verified_tournament_count'
              ),
            verifiedGameCount:
              sql<number>`COALESCE(${schema.beatmapStats.verifiedGameCount}, 0)`.as(
                'verified_game_count'
              ),
          })
          .from(schema.beatmaps)
          .leftJoin(
            schema.beatmapStats,
            eq(schema.beatmaps.id, schema.beatmapStats.beatmapId)
          )
          .leftJoin(
            schema.beatmapsets,
            eq(schema.beatmaps.beatmapsetId, schema.beatmapsets.id)
          )
          .leftJoin(
            creatorSubquery,
            eq(schema.beatmaps.id, creatorSubquery.beatmapId)
          )
          .leftJoin(
            schema.players,
            sql`"beatmap_creator"."creator_id" = ${schema.players.id}`
          );
      };

      /**
       * A page of the default order, most played first, read from the stats
       * index on the game count instead of sorting every beatmap (#1240).
       * Every beatmap with a verified game has a stats row, so that part of
       * the order comes straight from the index. Beatmaps without verified
       * games, some with no stats row, sort after them, so a page that
       * reaches them returns null and the full sort lists it.
       */
      const listMostPlayedPage = async () => {
        const pageIds = await context.db
          .select({ id: schema.beatmapStats.beatmapId })
          .from(schema.beatmapStats)
          .innerJoin(
            schema.beatmaps,
            eq(schema.beatmaps.id, schema.beatmapStats.beatmapId)
          )
          .where(and(whereClause, gt(schema.beatmapStats.verifiedGameCount, 0)))
          .orderBy(
            desc(schema.beatmapStats.verifiedGameCount),
            desc(schema.beatmapStats.beatmapId)
          )
          .limit(pageSize)
          .offset(offset);

        if (pageIds.length < pageSize) {
          return null;
        }

        const beatmapIds = pageIds.map(({ id }) => id);

        return buildListQuery(beatmapIds)
          .where(inArray(schema.beatmaps.id, beatmapIds))
          .orderBy(...orderBy);
      };

      // A search filter reads beatmapsets, which the stats page doesn't join
      const isMostPlayedOrder =
        sortValue === 'gameCount' && input.descending && !searchRank;

      const rows =
        (isMostPlayedOrder ? await listMostPlayedPage() : null) ??
        (await buildListQuery()
          .where(whereClause)
          .orderBy(...orderBy)
          .limit(pageSize)
          .offset(offset));

      // No filter references the creator, so this skips the list query's creator joins
      const countQuery = context.db
        .select({ count: count() })
        .from(schema.beatmaps)
        .leftJoin(
          schema.beatmapStats,
          eq(schema.beatmaps.id, schema.beatmapStats.beatmapId)
        )
        .leftJoin(
          schema.beatmapsets,
          eq(schema.beatmaps.beatmapsetId, schema.beatmapsets.id)
        );

      const countResult = whereClause
        ? await countQuery.where(whereClause)
        : await countQuery;

      const totalCount = countResult[0]?.count ?? 0;
      const totalPages = Math.ceil(totalCount / pageSize);

      const pageBeatmapIds = rows.map((row) => row.id);
      const groupedModRows =
        pageBeatmapIds.length === 0
          ? []
          : await context.db
              .select({
                beatmapId: schema.games.beatmapId,
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
                  inArray(schema.games.beatmapId, pageBeatmapIds),
                  eq(
                    schema.tournaments.verificationStatus,
                    VerificationStatus.Verified
                  ),
                  eq(
                    schema.matches.verificationStatus,
                    VerificationStatus.Verified
                  ),
                  eq(
                    schema.games.verificationStatus,
                    VerificationStatus.Verified
                  ),
                  eq(
                    schema.gameScores.verificationStatus,
                    VerificationStatus.Verified
                  )
                )
              )
              .groupBy(schema.games.beatmapId, schema.gameScores.mods);

      const groupedModsByBeatmap = new Map<
        number,
        Array<{ mods: number; scoreCount: number }>
      >();

      for (const row of groupedModRows) {
        if (row.beatmapId === null) continue;

        const groupedMods = groupedModsByBeatmap.get(row.beatmapId) ?? [];
        groupedMods.push({
          mods: row.mods,
          scoreCount: Number(row.scoreCount),
        });
        groupedModsByBeatmap.set(row.beatmapId, groupedMods);
      }

      const items = rows.map((row) =>
        BeatmapListItemSchema.parse({
          id: row.id,
          osuId: row.osuId,
          artist: row.artist ?? 'Unknown Artist',
          title: row.title ?? 'Unknown Title',
          diffName: row.diffName,
          ruleset: row.ruleset,
          sr: row.sr,
          bpm: row.bpm,
          cs: row.cs,
          ar: row.ar,
          od: row.od,
          hp: row.hp,
          totalLength: row.totalLength,
          beatmapsetOsuId: row.beatmapsetOsuId ?? null,
          creator: row.creator ?? null,
          verifiedTournamentCount: Number(row.verifiedTournamentCount) || 0,
          verifiedGameCount: Number(row.verifiedGameCount) || 0,
          topMods: filterBeatmapModDistribution(
            calculateBeatmapListModDistribution(
              groupedModsByBeatmap.get(row.id) ?? []
            )
          ).map(({ label, mods, percentage }) => ({
            mod: label,
            mods,
            percentage,
          })),
        })
      );

      return {
        items,
        totalCount,
        page,
        pageSize,
        totalPages,
      };
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }

      logger.error('beatmaps.list failed', { error });

      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to load beatmaps',
      });
    }
  });
