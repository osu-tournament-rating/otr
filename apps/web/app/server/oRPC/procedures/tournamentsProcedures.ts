import { ORPCError } from '@orpc/server';
import {
  SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as schema from '@otr/core/db/schema';
import {
  TournamentDetailSchema,
  TournamentListItemSchema,
  TournamentListPageResponseSchema,
  TournamentListRequestSchema,
  TournamentListResponseSchema,
  TournamentIdInputSchema,
  type TournamentListRequest,
} from '@/lib/orpc/schema/tournament';
import type { DatabaseClient } from '@/lib/db';
import {
  calculateBeatmapListModDistribution,
  filterBeatmapModDistribution,
} from '@/lib/utils/mods';

import {
  fetchTournamentAdminNotes,
  selectAdminNoteFields,
  mapAdminNoteRow,
  type AdminNoteRow,
} from './adminNotesProcedures';

import { publicProcedure, withSearchRateLimit } from './base';
import {
  Mods,
  Ruleset,
  ScoringType,
  Team,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu';

import { defaultRulesetSql } from './shared/defaultRuleset';
import { containsPattern } from './shared/likePattern';
import {
  buildTournamentRulesetCondition,
  collectRulesets,
} from './shared/rulesetFilter';
import { buildTournamentListOrder } from './shared/tournamentListOrder';
import { deriveTournamentWinRecord } from './shared/winRecord';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

const normalizeStatNumber = (value: number) =>
  Number.isFinite(value) ? value : 0;

function resolveTournamentListPaging(input: TournamentListRequest) {
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.max(
    1,
    Math.min(input.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  );

  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** The filters and order the plain and the paged tournament lists share. */
export function buildTournamentListQuery(input: TournamentListRequest) {
  const filters: SQL<unknown>[] = [];
  let searchTerm: string | undefined;

  if (input.verified) {
    filters.push(
      eq(schema.tournaments.verificationStatus, VerificationStatus.Verified)
    );
  }

  const rulesetCondition = buildTournamentRulesetCondition(
    collectRulesets(input.ruleset, input.rulesets)
  );

  if (rulesetCondition) {
    filters.push(rulesetCondition);
  }

  if (input.verificationStatus && input.verificationStatus.length > 0) {
    filters.push(
      inArray(schema.tournaments.verificationStatus, input.verificationStatus)
    );
  }

  if (input.rejectionReason !== undefined) {
    filters.push(
      sql`${schema.tournaments.rejectionReason} & ${input.rejectionReason} > 0`
    );
  }

  if (input.submittedBy !== undefined) {
    filters.push(eq(schema.tournaments.submittedByUserId, input.submittedBy));
  }

  if (input.verifiedBy !== undefined) {
    filters.push(eq(schema.tournaments.verifiedByUserId, input.verifiedBy));
  }

  if (input.lobbySize && input.lobbySize.length > 0) {
    filters.push(inArray(schema.tournaments.lobbySize, input.lobbySize));
  }

  if (input.minRankRange !== undefined) {
    filters.push(
      gte(schema.tournaments.rankRangeLowerBound, input.minRankRange)
    );
  }

  if (input.maxRankRange !== undefined) {
    filters.push(
      lte(schema.tournaments.rankRangeLowerBound, input.maxRankRange)
    );
  }

  if (input.dateMin) {
    filters.push(gte(schema.tournaments.startTime, input.dateMin));
  }

  if (input.dateMax) {
    filters.push(lte(schema.tournaments.endTime, input.dateMax));
  }

  if (input.searchQuery) {
    searchTerm = input.searchQuery.trim();
    if (searchTerm.length > 0) {
      const searchPattern = containsPattern(searchTerm);
      const nameOrAbbreviation = or(
        ilike(schema.tournaments.name, searchPattern),
        ilike(schema.tournaments.abbreviation, searchPattern)
      );

      if (nameOrAbbreviation) {
        filters.push(nameOrAbbreviation);
      }
    }
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const orderBy = buildTournamentListOrder({
    sort: input.sort,
    descending: input.descending,
    searchTerm: searchTerm || undefined,
  });

  return { whereClause, orderBy };
}

/** One page of list items, each with its admin notes. */
async function fetchTournamentListItems(
  db: DatabaseClient,
  {
    whereClause,
    orderBy,
    limit,
    offset,
  }: {
    whereClause: SQL<unknown> | undefined;
    orderBy: SQL<unknown>[];
    limit: number;
    offset: number;
  }
) {
  const submitterUser = alias(schema.users, 'submitterUser');
  const submitterPlayer = alias(schema.players, 'submitterPlayer');
  const verifierUser = alias(schema.users, 'verifierUser');
  const verifierPlayer = alias(schema.players, 'verifierPlayer');

  const baseQuery = db
    .select({
      id: schema.tournaments.id,
      created: schema.tournaments.created,
      name: schema.tournaments.name,
      abbreviation: schema.tournaments.abbreviation,
      forumUrl: schema.tournaments.forumUrl,
      rankRangeLowerBound: schema.tournaments.rankRangeLowerBound,
      ruleset: schema.tournaments.ruleset,
      lobbySize: schema.tournaments.lobbySize,
      startTime: schema.tournaments.startTime,
      endTime: schema.tournaments.endTime,
      verificationStatus: schema.tournaments.verificationStatus,
      rejectionReason: schema.tournaments.rejectionReason,
      isLazer: schema.tournaments.isLazer,
      submittedByUsername: submitterPlayer.username,
      verifiedByUsername: verifierPlayer.username,
    })
    .from(schema.tournaments)
    .leftJoin(
      submitterUser,
      eq(schema.tournaments.submittedByUserId, submitterUser.id)
    )
    .leftJoin(submitterPlayer, eq(submitterUser.playerId, submitterPlayer.id))
    .leftJoin(
      verifierUser,
      eq(schema.tournaments.verifiedByUserId, verifierUser.id)
    )
    .leftJoin(verifierPlayer, eq(verifierUser.playerId, verifierPlayer.id));

  const conditionedQuery =
    whereClause !== undefined ? baseQuery.where(whereClause) : baseQuery;

  const rows = await conditionedQuery
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset);

  const adminNotesByTournamentId = new Map<
    number,
    ReturnType<typeof mapAdminNoteRow>[]
  >();

  if (rows.length > 0) {
    const adminNoteRows = await db
      .select(selectAdminNoteFields(schema.tournamentAdminNotes))
      .from(schema.tournamentAdminNotes)
      .leftJoin(
        schema.users,
        eq(schema.users.id, schema.tournamentAdminNotes.adminUserId)
      )
      .leftJoin(schema.players, eq(schema.players.id, schema.users.playerId))
      .where(
        inArray(
          schema.tournamentAdminNotes.referenceId,
          rows.map((row) => row.id)
        )
      )
      .orderBy(desc(schema.tournamentAdminNotes.created));

    for (const noteRow of adminNoteRows as AdminNoteRow[]) {
      const notes = adminNotesByTournamentId.get(noteRow.referenceId) ?? [];
      notes.push(mapAdminNoteRow(noteRow));
      adminNotesByTournamentId.set(noteRow.referenceId, notes);
    }
  }

  return rows.map((row) =>
    TournamentListItemSchema.parse({
      id: row.id,
      created: row.created,
      name: row.name,
      abbreviation: row.abbreviation,
      forumUrl: row.forumUrl,
      rankRangeLowerBound: row.rankRangeLowerBound,
      ruleset: row.ruleset as Ruleset,
      lobbySize: row.lobbySize,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
      verificationStatus: row.verificationStatus as VerificationStatus,
      rejectionReason: row.rejectionReason,
      isLazer: row.isLazer,
      submittedByUsername: row.submittedByUsername ?? null,
      verifiedByUsername: row.verifiedByUsername ?? null,
      adminNotes: adminNotesByTournamentId.get(row.id) ?? [],
    })
  );
}

export const listTournaments = publicProcedure
  .input(TournamentListRequestSchema)
  .use(withSearchRateLimit, (input) => input.searchQuery)
  .output(TournamentListResponseSchema)
  .route({
    summary: 'List tournaments',
    tags: ['public'],
    method: 'GET',
    path: '/tournaments',
  })
  .handler(async ({ input, context }) => {
    try {
      const { pageSize, offset } = resolveTournamentListPaging(input);
      const { whereClause, orderBy } = buildTournamentListQuery(input);

      return await fetchTournamentListItems(context.db, {
        whereClause,
        orderBy,
        limit: pageSize,
        offset,
      });
    } catch (error) {
      console.error('[orpc] tournaments.list failed', error);

      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message:
          error instanceof Error ? error.message : 'Failed to load tournaments',
      });
    }
  });

/**
 * The site's numbered tournament list: the same filters, sort and pages as
 * `listTournaments`, plus the total the filters match. Not in the public API,
 * whose list response stays a bare array.
 */
export const listTournamentsPage = publicProcedure
  .input(TournamentListRequestSchema)
  .use(withSearchRateLimit, (input) => input.searchQuery)
  .output(TournamentListPageResponseSchema)
  .route({
    summary: 'List one numbered page of tournaments with the total count',
    tags: ['tournaments'],
    method: 'GET',
    path: '/tournaments/list-page',
  })
  .handler(async ({ input, context }) => {
    try {
      const { page, pageSize, offset } = resolveTournamentListPaging(input);
      const { whereClause, orderBy } = buildTournamentListQuery(input);

      const [items, countRows] = await Promise.all([
        fetchTournamentListItems(context.db, {
          whereClause,
          orderBy,
          limit: pageSize,
          offset,
        }),
        context.db
          .select({ count: count() })
          .from(schema.tournaments)
          .where(whereClause),
      ]);

      const totalCount = Number(countRows[0]?.count ?? 0);

      return {
        items,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      };
    } catch (error) {
      console.error('[orpc] tournaments.listPage failed', error);

      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to load tournaments',
      });
    }
  });

export const getTournament = publicProcedure
  .input(TournamentIdInputSchema)
  .output(TournamentDetailSchema)
  .route({
    summary: 'Get tournament details',
    tags: ['public'],
    method: 'GET',
    path: '/tournaments/{id}',
  })
  .handler(async ({ input, context }) => {
    try {
      const tournament = await context.db.query.tournaments.findFirst({
        where: eq(schema.tournaments.id, input.id),
      });

      if (!tournament) {
        throw new ORPCError('NOT_FOUND', {
          message: 'Tournament not found',
        });
      }

      const submitterUser = alias(schema.users, 'submitterUser');
      const submitterPlayer = alias(schema.players, 'submitterPlayer');
      const verifierUser = alias(schema.users, 'verifierUser');
      const verifierPlayer = alias(schema.players, 'verifierPlayer');

      const submittedByUsername = tournament.submittedByUserId
        ? await context.db
            .select({ username: submitterPlayer.username })
            .from(submitterUser)
            .innerJoin(
              submitterPlayer,
              eq(submitterUser.playerId, submitterPlayer.id)
            )
            .where(eq(submitterUser.id, tournament.submittedByUserId))
            .limit(1)
            .then((rows) => rows[0]?.username ?? null)
        : null;

      const verifiedByUsername = tournament.verifiedByUserId
        ? await context.db
            .select({ username: verifierPlayer.username })
            .from(verifierUser)
            .innerJoin(
              verifierPlayer,
              eq(verifierUser.playerId, verifierPlayer.id)
            )
            .where(eq(verifierUser.id, tournament.verifiedByUserId))
            .limit(1)
            .then((rows) => rows[0]?.username ?? null)
        : null;

      const beatmapsetCreator = alias(schema.players, 'beatmapsetCreator');

      const pooledBeatmapRows = await context.db
        .select({
          beatmapId: schema.beatmaps.id,
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
          titleOverride: schema.beatmaps.titleOverride,
          artistOverride: schema.beatmaps.artistOverride,
          setOwnerIdOverride: schema.beatmaps.setOwnerIdOverride,
          beatmapsetDbId: schema.beatmapsets.id,
          beatmapsetOsuId: schema.beatmapsets.osuId,
          beatmapsetArtist: schema.beatmapsets.artist,
          beatmapsetTitle: schema.beatmapsets.title,
          beatmapsetRankedStatus: schema.beatmapsets.rankedStatus,
          beatmapsetRankedDate: schema.beatmapsets.rankedDate,
          beatmapsetSubmittedDate: schema.beatmapsets.submittedDate,
          beatmapsetCreatorId: schema.beatmapsets.creatorId,
          beatmapsetCreatorPlayerId: beatmapsetCreator.id,
          beatmapsetCreatorOsuId: beatmapsetCreator.osuId,
          beatmapsetCreatorUsername: beatmapsetCreator.username,
          beatmapsetCreatorCountry: beatmapsetCreator.country,
          beatmapsetCreatorDefaultRuleset: defaultRulesetSql(
            beatmapsetCreator.id
          ),
          beatmapsetCreatorOsuLastFetch: beatmapsetCreator.osuLastFetch,
          beatmapsetCreatorOsuTrackLastFetch:
            beatmapsetCreator.osuTrackLastFetch,
          beatmapsetCreatorOsuTrackDataFetchStatus:
            beatmapsetCreator.osuTrackDataFetchStatus,
          beatmapsetCreatorDataFetchStatus: beatmapsetCreator.dataFetchStatus,
        })
        .from(schema.joinPooledBeatmaps)
        .innerJoin(
          schema.beatmaps,
          eq(schema.beatmaps.id, schema.joinPooledBeatmaps.pooledBeatmapsId)
        )
        .leftJoin(
          schema.beatmapsets,
          eq(schema.beatmapsets.id, schema.beatmaps.beatmapsetId)
        )
        .leftJoin(
          beatmapsetCreator,
          eq(beatmapsetCreator.id, schema.beatmapsets.creatorId)
        )
        .where(
          eq(schema.joinPooledBeatmaps.tournamentsPooledInId, tournament.id)
        );

      const beatmapIds = pooledBeatmapRows.map((row) => row.beatmapId);

      // Counts every score the tournament has, verified or not.
      const pooledModRows = beatmapIds.length
        ? await context.db
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
            .where(
              and(
                eq(schema.matches.tournamentId, tournament.id),
                inArray(schema.games.beatmapId, beatmapIds)
              )
            )
            .groupBy(schema.games.beatmapId, schema.gameScores.mods)
        : [];

      const pooledModsByBeatmapId = new Map<
        number,
        Array<{ mods: number; scoreCount: number }>
      >();

      for (const row of pooledModRows) {
        if (row.beatmapId === null) continue;

        const rows = pooledModsByBeatmapId.get(row.beatmapId) ?? [];
        rows.push({ mods: row.mods, scoreCount: Number(row.scoreCount) });
        pooledModsByBeatmapId.set(row.beatmapId, rows);
      }

      // Attributes are osu! standard values, so a convert pooled in another
      // ruleset's tournament gets none.
      const beatmapAttributeRows =
        beatmapIds.length && tournament.ruleset === Ruleset.Osu
          ? await context.db
              .select({
                beatmapId: schema.beatmapAttributes.beatmapId,
                id: schema.beatmapAttributes.id,
                mods: schema.beatmapAttributes.mods,
                sr: schema.beatmapAttributes.sr,
                ar: schema.beatmapAttributes.ar,
                cs: schema.beatmapAttributes.cs,
                od: schema.beatmapAttributes.od,
                hp: schema.beatmapAttributes.hp,
                created: schema.beatmapAttributes.created,
              })
              .from(schema.beatmapAttributes)
              .where(inArray(schema.beatmapAttributes.beatmapId, beatmapIds))
              .orderBy(asc(schema.beatmapAttributes.mods))
          : [];

      const attributesByBeatmapId = new Map<
        number,
        Omit<(typeof beatmapAttributeRows)[number], 'beatmapId'>[]
      >();

      for (const { beatmapId, ...attribute } of beatmapAttributeRows) {
        const rows = attributesByBeatmapId.get(beatmapId) ?? [];
        rows.push(attribute);
        attributesByBeatmapId.set(beatmapId, rows);
      }

      const beatmapCreatorsRows = beatmapIds.length
        ? await context.db
            .select({
              beatmapId: schema.joinBeatmapCreators.createdBeatmapsId,
              playerId: schema.players.id,
              osuId: schema.players.osuId,
              username: schema.players.username,
              country: schema.players.country,
              defaultRuleset: defaultRulesetSql(schema.players.id),
              osuLastFetch: schema.players.osuLastFetch,
              osuTrackLastFetch: schema.players.osuTrackLastFetch,
              osuTrackDataFetchStatus: schema.players.osuTrackDataFetchStatus,
              dataFetchStatus: schema.players.dataFetchStatus,
            })
            .from(schema.joinBeatmapCreators)
            .innerJoin(
              schema.players,
              eq(schema.players.id, schema.joinBeatmapCreators.creatorsId)
            )
            .where(
              inArray(schema.joinBeatmapCreators.createdBeatmapsId, beatmapIds)
            )
        : [];

      const creatorsByBeatmapId = new Map<
        number,
        {
          id: number;
          osuId: number;
          username: string;
          country: string;
          defaultRuleset: Ruleset;
          osuLastFetch: string;
          osuTrackLastFetch: string;
          osuTrackDataFetchStatus: number;
          dataFetchStatus: number;
        }[]
      >();

      for (const creator of beatmapCreatorsRows) {
        const beatmapId = creator.beatmapId;
        const current = creatorsByBeatmapId.get(beatmapId) ?? [];
        current.push({
          id: creator.playerId,
          osuId: creator.osuId,
          username: creator.username,
          country: creator.country,
          defaultRuleset: creator.defaultRuleset as Ruleset,
          osuLastFetch: creator.osuLastFetch,
          osuTrackLastFetch: creator.osuTrackLastFetch ?? '2007-09-17 00:00:00',
          osuTrackDataFetchStatus: creator.osuTrackDataFetchStatus ?? 0,
          dataFetchStatus: creator.dataFetchStatus ?? 0,
        });
        creatorsByBeatmapId.set(beatmapId, current);
      }

      const matchVerifierUser = alias(schema.users, 'matchVerifierUser');
      const matchVerifierPlayer = alias(schema.players, 'matchVerifierPlayer');

      const matchRows = await context.db
        .select({
          id: schema.matches.id,
          osuId: schema.matches.osuId,
          tournamentId: schema.matches.tournamentId,
          name: schema.matches.name,
          startTime: schema.matches.startTime,
          endTime: schema.matches.endTime,
          verificationStatus: schema.matches.verificationStatus,
          rejectionReason: schema.matches.rejectionReason,
          warningFlags: schema.matches.warningFlags,
          isLazer: schema.matches.isLazer,
          submittedByUserId: schema.matches.submittedByUserId,
          verifiedByUserId: schema.matches.verifiedByUserId,
          verifiedByUsername: matchVerifierPlayer.username,
          dataFetchStatus: schema.matches.dataFetchStatus,
        })
        .from(schema.matches)
        .leftJoin(
          matchVerifierUser,
          eq(schema.matches.verifiedByUserId, matchVerifierUser.id)
        )
        .leftJoin(
          matchVerifierPlayer,
          eq(matchVerifierUser.playerId, matchVerifierPlayer.id)
        )
        .where(eq(schema.matches.tournamentId, tournament.id))
        .orderBy(desc(schema.matches.startTime), desc(schema.matches.id));

      const matchIds = matchRows.map((match) => match.id);

      const gameRows = matchIds.length
        ? await context.db
            .select({
              id: schema.games.id,
              osuId: schema.games.osuId,
              matchId: schema.games.matchId,
              beatmapId: schema.games.beatmapId,
              ruleset: schema.games.ruleset,
              scoringType: schema.games.scoringType,
              teamType: schema.games.teamType,
              startTime: schema.games.startTime,
              endTime: schema.games.endTime,
              verificationStatus: schema.games.verificationStatus,
              rejectionReason: schema.games.rejectionReason,
              warningFlags: schema.games.warningFlags,
              mods: schema.games.mods,
              lazerMods: schema.games.lazerMods,
              beatmapDbId: schema.beatmaps.id,
              beatmapOsuId: schema.beatmaps.osuId,
              beatmapRuleset: schema.beatmaps.ruleset,
              beatmapRankedStatus: schema.beatmaps.rankedStatus,
              beatmapDiffName: schema.beatmaps.diffName,
              beatmapTotalLength: schema.beatmaps.totalLength,
              beatmapDrainLength: schema.beatmaps.drainLength,
              beatmapBpm: schema.beatmaps.bpm,
              beatmapCountCircle: schema.beatmaps.countCircle,
              beatmapCountSlider: schema.beatmaps.countSlider,
              beatmapCountSpinner: schema.beatmaps.countSpinner,
              beatmapCs: schema.beatmaps.cs,
              beatmapHp: schema.beatmaps.hp,
              beatmapOd: schema.beatmaps.od,
              beatmapAr: schema.beatmaps.ar,
              beatmapSr: schema.beatmaps.sr,
              beatmapMaxCombo: schema.beatmaps.maxCombo,
              beatmapBeatmapsetId: schema.beatmaps.beatmapsetId,
              beatmapDataFetchStatus: schema.beatmaps.dataFetchStatus,
              beatmapManualOverride: schema.beatmaps.manualOverride,
              beatmapTitleOverride: schema.beatmaps.titleOverride,
              beatmapArtistOverride: schema.beatmaps.artistOverride,
              beatmapSetOwnerIdOverride: schema.beatmaps.setOwnerIdOverride,
            })
            .from(schema.games)
            .leftJoin(
              schema.beatmaps,
              eq(schema.beatmaps.id, schema.games.beatmapId)
            )
            .where(inArray(schema.games.matchId, matchIds))
            .orderBy(asc(schema.games.startTime), asc(schema.games.id))
        : [];

      type GameRow = (typeof gameRows)[number];

      const gamesByMatchId = new Map<number, GameRow[]>();

      for (const game of gameRows) {
        const items = gamesByMatchId.get(game.matchId) ?? [];
        items.push(game);
        gamesByMatchId.set(game.matchId, items);
      }

      const matchAdminNotesRows = matchIds.length
        ? await context.db
            .select(selectAdminNoteFields(schema.matchAdminNotes))
            .from(schema.matchAdminNotes)
            .leftJoin(
              schema.users,
              eq(schema.users.id, schema.matchAdminNotes.adminUserId)
            )
            .leftJoin(
              schema.players,
              eq(schema.players.id, schema.users.playerId)
            )
            .where(inArray(schema.matchAdminNotes.referenceId, matchIds))
            .orderBy(desc(schema.matchAdminNotes.created))
        : [];

      type AdminNote = ReturnType<typeof mapAdminNoteRow>;
      const matchAdminNotesByMatchId = new Map<number, AdminNote[]>();
      for (const row of matchAdminNotesRows as AdminNoteRow[]) {
        const notes = matchAdminNotesByMatchId.get(row.referenceId) ?? [];
        notes.push(mapAdminNoteRow(row));
        matchAdminNotesByMatchId.set(row.referenceId, notes);
      }

      const gameIds = gameRows.map((g) => g.id);
      const gameAdminNotesRows = gameIds.length
        ? await context.db
            .select(selectAdminNoteFields(schema.gameAdminNotes))
            .from(schema.gameAdminNotes)
            .leftJoin(
              schema.users,
              eq(schema.users.id, schema.gameAdminNotes.adminUserId)
            )
            .leftJoin(
              schema.players,
              eq(schema.players.id, schema.users.playerId)
            )
            .where(inArray(schema.gameAdminNotes.referenceId, gameIds))
            .orderBy(desc(schema.gameAdminNotes.created))
        : [];

      const gameAdminNotesByGameId = new Map<number, AdminNote[]>();
      for (const row of gameAdminNotesRows as AdminNoteRow[]) {
        const notes = gameAdminNotesByGameId.get(row.referenceId) ?? [];
        notes.push(mapAdminNoteRow(row));
        gameAdminNotesByGameId.set(row.referenceId, notes);
      }

      const rosterRows = matchIds.length
        ? await context.db
            .select({
              matchId: schema.matchRosters.matchId,
              roster: schema.matchRosters.roster,
              team: schema.matchRosters.team,
              score: schema.matchRosters.score,
            })
            .from(schema.matchRosters)
            .where(inArray(schema.matchRosters.matchId, matchIds))
        : [];

      const rostersByMatchId = new Map<
        number,
        { roster: number[]; team: Team; score: number }[]
      >();
      for (const row of rosterRows) {
        const rosters = rostersByMatchId.get(row.matchId) ?? [];
        rosters.push({
          roster: row.roster ?? [],
          team: row.team as Team,
          score: row.score,
        });
        rostersByMatchId.set(row.matchId, rosters);
      }

      const normalizedMatches = matchRows.map((match) => ({
        id: match.id,
        osuId: match.osuId,
        tournamentId: match.tournamentId,
        name: match.name,
        startTime: match.startTime ?? null,
        endTime: match.endTime ?? null,
        verificationStatus: match.verificationStatus as VerificationStatus,
        rejectionReason: match.rejectionReason,
        warningFlags: match.warningFlags,
        isLazer: match.isLazer,
        submittedByUserId: match.submittedByUserId ?? null,
        verifiedByUserId: match.verifiedByUserId ?? null,
        verifiedByUsername: match.verifiedByUsername ?? null,
        dataFetchStatus: match.dataFetchStatus,
        adminNotes: matchAdminNotesByMatchId.get(match.id) ?? [],
        winRecord: deriveTournamentWinRecord(
          match.id,
          match.verificationStatus,
          rostersByMatchId.get(match.id) ?? []
        ),
        games: (gamesByMatchId.get(match.id) ?? []).map((game) => ({
          id: game.id,
          osuId: game.osuId,
          matchId: game.matchId,
          beatmapId: game.beatmapId ?? null,
          ruleset: game.ruleset as Ruleset,
          scoringType: game.scoringType as ScoringType,
          teamType: game.teamType as TeamType,
          startTime: game.startTime ?? null,
          endTime: game.endTime ?? null,
          verificationStatus: game.verificationStatus as VerificationStatus,
          rejectionReason: game.rejectionReason,
          warningFlags: game.warningFlags,
          mods: game.mods,
          lazerMods: game.lazerMods,
          // TODO: This is actually an incorrect calculation.
          // We should create a set of rules which determines this,
          // i.e. mods set at the game level = generally no freemod allowed.
          // Need to investigate.
          isFreeMod: (game.mods & Mods.FreeModAllowed) === Mods.FreeModAllowed,
          adminNotes: gameAdminNotesByGameId.get(game.id) ?? [],
          beatmap:
            game.beatmapDbId != null && game.beatmapOsuId != null
              ? {
                  id: game.beatmapDbId,
                  osuId: game.beatmapOsuId,
                  ruleset: (game.beatmapRuleset ?? game.ruleset) as Ruleset,
                  rankedStatus: game.beatmapRankedStatus ?? 0,
                  diffName: game.beatmapDiffName ?? 'Unknown difficulty',
                  totalLength: game.beatmapTotalLength ?? 0,
                  drainLength: game.beatmapDrainLength ?? 0,
                  bpm: game.beatmapBpm ?? 0,
                  countCircle: game.beatmapCountCircle ?? 0,
                  countSlider: game.beatmapCountSlider ?? 0,
                  countSpinner: game.beatmapCountSpinner ?? 0,
                  cs: game.beatmapCs ?? 0,
                  hp: game.beatmapHp ?? 0,
                  od: game.beatmapOd ?? 0,
                  ar: game.beatmapAr ?? 0,
                  sr: game.beatmapSr ?? 0,
                  maxCombo: game.beatmapMaxCombo ?? null,
                  beatmapsetId: game.beatmapBeatmapsetId ?? null,
                  dataFetchStatus: game.beatmapDataFetchStatus ?? 0,
                  manualOverride: game.beatmapManualOverride ?? false,
                  titleOverride: game.beatmapTitleOverride ?? null,
                  artistOverride: game.beatmapArtistOverride ?? null,
                  setOwnerIdOverride: game.beatmapSetOwnerIdOverride ?? null,
                }
              : null,
        })),
      }));

      const adminNotes = await fetchTournamentAdminNotes(
        context.db,
        tournament.id
      );

      const playerStatsRows = await context.db
        .select({
          id: schema.playerTournamentStats.id,
          playerId: schema.playerTournamentStats.playerId,
          tournamentId: schema.playerTournamentStats.tournamentId,
          matchesPlayed: schema.playerTournamentStats.matchesPlayed,
          matchesWon: schema.playerTournamentStats.matchesWon,
          matchesLost: schema.playerTournamentStats.matchesLost,
          gamesPlayed: schema.playerTournamentStats.gamesPlayed,
          gamesWon: schema.playerTournamentStats.gamesWon,
          gamesLost: schema.playerTournamentStats.gamesLost,
          averageMatchCost: schema.playerTournamentStats.averageMatchCost,
          averageRatingDelta: schema.playerTournamentStats.averageRatingDelta,
          averageScore: schema.playerTournamentStats.averageScore,
          averagePlacement: schema.playerTournamentStats.averagePlacement,
          averageAccuracy: schema.playerTournamentStats.averageAccuracy,
          teammateIds: schema.playerTournamentStats.teammateIds,
          matchWinRate: schema.playerTournamentStats.matchWinRate,
          statsPlayerId: schema.players.id,
          statsPlayerOsuId: schema.players.osuId,
          statsPlayerUsername: schema.players.username,
          statsPlayerCountry: schema.players.country,
          statsPlayerDefaultRuleset: defaultRulesetSql(schema.players.id),
          statsPlayerOsuLastFetch: schema.players.osuLastFetch,
          statsPlayerOsuTrackLastFetch: schema.players.osuTrackLastFetch,
          statsPlayerDataFetchStatus: schema.players.dataFetchStatus,
          statsPlayerOsuTrackDataFetchStatus:
            schema.players.osuTrackDataFetchStatus,

          // correlated subqueries as raw SQL
          ratingBefore: sql<number>`
            (
              SELECT ra.rating_before
              FROM rating_adjustments ra
              INNER JOIN matches m2 ON m2.id = ra.match_id
              WHERE ra.player_id = ${schema.players.id}
                AND m2.tournament_id = ${schema.playerTournamentStats.tournamentId}
              ORDER BY ra.timestamp ASC
              LIMIT 1
            )
          `,
          ratingAfter: sql<number>`
            (
              SELECT ra.rating_after
              FROM rating_adjustments ra
              INNER JOIN matches m2 ON m2.id = ra.match_id
              WHERE ra.player_id = ${schema.players.id}
                AND m2.tournament_id = ${schema.playerTournamentStats.tournamentId}
              ORDER BY ra.timestamp DESC
              LIMIT 1
            )
          `,
        })
        .from(schema.playerTournamentStats)
        .leftJoin(
          schema.players,
          eq(schema.players.id, schema.playerTournamentStats.playerId)
        )
        .where(eq(schema.playerTournamentStats.tournamentId, tournament.id))
        .orderBy(desc(schema.playerTournamentStats.averageMatchCost));

      const playerStats = playerStatsRows.map((stat) => ({
        id: stat.id,
        playerId: stat.playerId,
        tournamentId: stat.tournamentId,
        matchesPlayed: stat.matchesPlayed,
        matchesWon: stat.matchesWon,
        matchesLost: stat.matchesLost,
        gamesPlayed: stat.gamesPlayed,
        gamesWon: stat.gamesWon,
        gamesLost: stat.gamesLost,
        averageMatchCost: normalizeStatNumber(stat.averageMatchCost),
        averageRatingDelta: normalizeStatNumber(stat.averageRatingDelta),
        averageScore: Math.trunc(normalizeStatNumber(stat.averageScore)),
        averagePlacement: normalizeStatNumber(stat.averagePlacement),
        averageAccuracy: normalizeStatNumber(stat.averageAccuracy),
        teammateIds: stat.teammateIds ?? [],
        matchWinRate: stat.matchWinRate,
        ratingBefore: stat.ratingBefore ?? 0,
        ratingAfter: stat.ratingAfter ?? 0,
        player:
          stat.statsPlayerId != null
            ? {
                id: stat.statsPlayerId,
                osuId: stat.statsPlayerOsuId ?? -1,
                username: stat.statsPlayerUsername,
                country: stat.statsPlayerCountry,
                defaultRuleset: (stat.statsPlayerDefaultRuleset ??
                  Ruleset.Osu) as Ruleset,
                osuLastFetch: stat.statsPlayerOsuLastFetch,
                osuTrackLastFetch:
                  stat.statsPlayerOsuTrackLastFetch ?? '2007-09-17 00:00:00',
                osuTrackDataFetchStatus:
                  stat.statsPlayerOsuTrackDataFetchStatus ?? 0,
                dataFetchStatus: stat.statsPlayerDataFetchStatus ?? 0,
              }
            : {
                id: -1,
                osuId: -1,
                username: 'Unknown',
                country: '',
                defaultRuleset: Ruleset.Osu,
                osuLastFetch: '2007-09-17 00:00:00',
                osuTrackLastFetch: '2007-09-17 00:00:00',
                osuTrackDataFetchStatus: 0,
                dataFetchStatus: 0,
              },
      }));

      const pooledBeatmaps = pooledBeatmapRows.map((beatmap) => {
        const beatmapsetCreator =
          beatmap.beatmapsetCreatorPlayerId == null
            ? null
            : {
                id: beatmap.beatmapsetCreatorPlayerId,
                osuId: beatmap.beatmapsetCreatorOsuId ?? -1,
                username: beatmap.beatmapsetCreatorUsername ?? 'Unknown',
                country: beatmap.beatmapsetCreatorCountry,
                defaultRuleset: (beatmap.beatmapsetCreatorDefaultRuleset ??
                  Ruleset.Osu) as Ruleset,
                osuLastFetch:
                  beatmap.beatmapsetCreatorOsuLastFetch ??
                  '2007-09-17 00:00:00',
                osuTrackLastFetch:
                  beatmap.beatmapsetCreatorOsuTrackLastFetch ??
                  '2007-09-17 00:00:00',
                osuTrackDataFetchStatus:
                  beatmap.beatmapsetCreatorOsuTrackDataFetchStatus ?? 0,
                dataFetchStatus: beatmap.beatmapsetCreatorDataFetchStatus ?? 0,
              };

        const beatmapset =
          beatmap.beatmapsetDbId == null
            ? null
            : {
                id: beatmap.beatmapsetDbId,
                osuId: beatmap.beatmapsetOsuId ?? 0,
                artist: beatmap.beatmapsetArtist ?? 'Unknown Artist',
                title: beatmap.beatmapsetTitle ?? 'Unknown Title',
                rankedStatus: beatmap.beatmapsetRankedStatus ?? 0,
                rankedDate: beatmap.beatmapsetRankedDate ?? null,
                submittedDate: beatmap.beatmapsetSubmittedDate ?? null,
                creatorId: beatmap.beatmapsetCreatorId ?? null,
                creator: beatmapsetCreator,
              };

        const creators = (creatorsByBeatmapId.get(beatmap.beatmapId) ?? []).map(
          (creator) => ({
            id: creator.id,
            osuId: creator.osuId,
            username: creator.username,
            country: creator.country,
            defaultRuleset: (creator.defaultRuleset ?? Ruleset.Osu) as Ruleset,
            osuLastFetch: creator.osuLastFetch,
            osuTrackLastFetch:
              creator.osuTrackLastFetch ?? '2007-09-17 00:00:00',
            osuTrackDataFetchStatus: creator.osuTrackDataFetchStatus ?? 0,
            dataFetchStatus: creator.dataFetchStatus ?? 0,
          })
        );

        return {
          id: beatmap.beatmapId,
          osuId: beatmap.osuId,
          ruleset: beatmap.ruleset as Ruleset,
          rankedStatus: beatmap.rankedStatus,
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
          maxCombo: beatmap.maxCombo ?? null,
          beatmapsetId: beatmap.beatmapsetId ?? null,
          dataFetchStatus: beatmap.dataFetchStatus ?? 0,
          manualOverride: beatmap.manualOverride ?? false,
          titleOverride: beatmap.titleOverride ?? null,
          artistOverride: beatmap.artistOverride ?? null,
          setOwnerIdOverride: beatmap.setOwnerIdOverride ?? null,
          beatmapset,
          attributes: attributesByBeatmapId.get(beatmap.beatmapId) ?? [],
          creators,
          topMods: filterBeatmapModDistribution(
            calculateBeatmapListModDistribution(
              pooledModsByBeatmapId.get(beatmap.beatmapId) ?? []
            )
          ).map(({ label, mods, percentage }) => ({
            mod: label,
            mods,
            percentage,
          })),
        };
      });

      return TournamentDetailSchema.parse({
        id: tournament.id,
        name: tournament.name,
        abbreviation: tournament.abbreviation,
        forumUrl: tournament.forumUrl,
        rankRangeLowerBound: tournament.rankRangeLowerBound,
        ruleset: tournament.ruleset as Ruleset,
        lobbySize: tournament.lobbySize,
        startTime: tournament.startTime ?? null,
        endTime: tournament.endTime ?? null,
        verificationStatus: tournament.verificationStatus as VerificationStatus,
        rejectionReason: tournament.rejectionReason,
        isLazer: tournament.isLazer,
        submittedByUserId: tournament.submittedByUserId ?? null,
        verifiedByUserId: tournament.verifiedByUserId ?? null,
        submittedByUsername,
        verifiedByUsername,
        matches: normalizedMatches,
        adminNotes,
        playerTournamentStats: playerStats,
        pooledBeatmaps,
      });
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }

      console.error('[orpc] tournaments.get failed', error);

      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message:
          error instanceof Error
            ? error.message
            : 'Failed to load tournament details',
      });
    }
  });
