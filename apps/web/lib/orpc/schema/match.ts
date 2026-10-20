import { z } from 'zod';

import {
  gameScoreSelectSchema,
  gameSelectSchema,
  matchRosterSelectSchema,
  matchSelectSchema,
  playerMatchStatsSelectSchema,
  ratingAdjustmentSelectSchema,
  tournamentSelectSchema,
} from './base';
import { BeatmapSchema } from './beatmap';
import {
  CreatedUpdatedOmit,
  RatingAdjustmentTypeSchema,
  RulesetSchema,
  ScoreGradeSchema,
  ScoringTypeSchema,
  TeamSchema,
  TeamTypeSchema,
  VerificationChildrenChoiceSchema,
  VerificationStatusSchema,
} from './constants';
import { AdminNoteSchema, LazerModSchema } from './common';
import { PlayerSchema } from './player';

const AdminNoteContentSchema = z.string().trim().min(1);

/** Every mod of a lazer game or score; null for stable data. */
const LazerModsSchema = z.array(LazerModSchema).nullable();

const matchTournamentBaseSchema = tournamentSelectSchema.pick({
  id: true,
  name: true,
  abbreviation: true,
  ruleset: true,
});

export const MatchTournamentSchema = matchTournamentBaseSchema
  .omit({
    abbreviation: true,
    ruleset: true,
  })
  .extend({
    abbreviation: matchTournamentBaseSchema.shape.abbreviation.nullable(),
    ruleset: RulesetSchema,
  })
  .nullable();

export const MatchPlayerSchema = PlayerSchema.pick({
  id: true,
  osuId: true,
  username: true,
  country: true,
  defaultRuleset: true,
}).extend({
  userId: z.number().int().nullable().optional(),
});

export const MatchBeatmapSchema = BeatmapSchema.extend({
  creators: z.array(PlayerSchema).default([]),
});

export const MatchRosterSchema = matchRosterSelectSchema
  .pick({
    id: true,
    roster: true,
    team: true,
    score: true,
  })
  .extend({
    team: TeamSchema,
  });

export const GameScoreSchema = gameScoreSelectSchema
  .omit(CreatedUpdatedOmit)
  .extend({
    grade: ScoreGradeSchema,
    team: TeamSchema,
    ruleset: RulesetSchema,
    verificationStatus: VerificationStatusSchema,
    lazerMods: LazerModsSchema,
    adminNotes: z.array(AdminNoteSchema).default([]),
  });

const gameBaseSchema = gameSelectSchema.omit(CreatedUpdatedOmit).extend({
  ruleset: RulesetSchema,
  scoringType: ScoringTypeSchema,
  teamType: TeamTypeSchema,
  verificationStatus: VerificationStatusSchema,
  lazerMods: LazerModsSchema,
  isFreeMod: z.boolean(),
  beatmap: MatchBeatmapSchema.nullable(),
  adminNotes: z.array(AdminNoteSchema).default([]),
  hasAdminNotes: z.boolean().optional(),
  scores: z.array(GameScoreSchema).default([]),
});
export const GameSchema = gameBaseSchema;

export const PlayerMatchStatsSchema = playerMatchStatsSelectSchema.pick({
  id: true,
  playerId: true,
  matchId: true,
  won: true,
  gamesWon: true,
  gamesLost: true,
  gamesPlayed: true,
  averageScore: true,
  averageAccuracy: true,
  averageMisses: true,
  averagePlacement: true,
  matchCost: true,
  teammateIds: true,
  opponentIds: true,
});

export const RatingAdjustmentSchema = ratingAdjustmentSelectSchema
  .omit({
    created: true,
  })
  .extend({
    adjustmentType: RatingAdjustmentTypeSchema,
    ruleset: RulesetSchema,
    ratingDelta: z.number(),
    volatilityDelta: z.number(),
  });

export const MatchWinRecordSchema = z
  .object({
    matchId: z.number().int(),
    isTied: z.boolean(),
    loserRoster: z.array(z.number().int()).nullable(),
    winnerRoster: z.array(z.number().int()).nullable(),
    loserPoints: z.number().int(),
    winnerPoints: z.number().int(),
    loserTeam: TeamSchema.nullable(),
    winnerTeam: TeamSchema.nullable(),
  })
  .nullable();

const matchBaseSchema = matchSelectSchema.omit(CreatedUpdatedOmit).extend({
  games: z.array(GameSchema).default([]),
  players: z.array(MatchPlayerSchema).default([]),
  playerMatchStats: z.array(PlayerMatchStatsSchema).default([]),
  ratingAdjustments: z.array(RatingAdjustmentSchema).default([]),
  adminNotes: z.array(AdminNoteSchema).default([]),
  hasAdminNotes: z.boolean().optional(),
  tournament: MatchTournamentSchema.nullable().default(null),
  winRecord: MatchWinRecordSchema.nullable().default(null),
  rosters: z.array(MatchRosterSchema).default([]),
  verifiedByUsername: z.string().nullable(),
});

export const MatchSchema = matchBaseSchema;

/** A match deleted by merging its games into another match. */
export const MatchMergeSchema = z.object({
  mergedMatchId: z.number().int(),
  osuId: z.number().int(),
  isLazer: z.boolean(),
  name: z.string(),
  created: z.string(),
});

export const MatchDetailSchema = MatchSchema.extend({
  mergedMatches: z.array(MatchMergeSchema).default([]),
});

/** A merged match and the match its games went into. */
export const MatchMergeLookupSchema = MatchMergeSchema.extend({
  match: matchSelectSchema.pick({ id: true, name: true }),
});

export const MatchIdInputSchema = z.object({
  id: z.number().int().positive(),
});

const PositiveIntSchema = z.number().int().positive();
const BitmaskEnumValueSchema = z.number().int().min(0);
const NonNegativeIntSchema = z.number().int().min(0);

/** A save names only the fields the admin edited; the rest stay as stored. */
export const MatchAdminUpdateInputSchema = z
  .object({
    id: PositiveIntSchema,
    name: z.string().min(1),
    verificationStatus: VerificationStatusSchema,
    rejectionReason: BitmaskEnumValueSchema,
    warningFlags: BitmaskEnumValueSchema,
    startTime: z.string().datetime().nullable(),
    endTime: z.string().datetime().nullable(),
    children: VerificationChildrenChoiceSchema,
  })
  .partial()
  .required({ id: true });

export const MatchAdminMutationResponseSchema = z.object({
  success: z.boolean(),
});

export const MatchAdminMergeInputSchema = z.object({
  id: PositiveIntSchema,
  childMatchIds: z.array(PositiveIntSchema).min(1),
});

export const MatchAdminMergeResponseSchema = z.object({
  success: z.boolean(),
  mergedMatchCount: NonNegativeIntSchema,
  rehomedGameCount: NonNegativeIntSchema,
});

/** A save names only the fields the admin edited; the rest stay as stored. */
export const GameAdminUpdateInputSchema = z
  .object({
    id: PositiveIntSchema,
    ruleset: RulesetSchema,
    scoringType: ScoringTypeSchema,
    teamType: TeamTypeSchema,
    mods: BitmaskEnumValueSchema,
    verificationStatus: VerificationStatusSchema,
    rejectionReason: BitmaskEnumValueSchema,
    warningFlags: BitmaskEnumValueSchema,
    startTime: z.string().datetime().nullable(),
    endTime: z.string().datetime().nullable(),
    children: VerificationChildrenChoiceSchema,
  })
  .partial()
  .required({ id: true });

export const GameAdminMutationResponseSchema = z.object({
  success: z.boolean(),
});

export const GameAdminMergeInputSchema = z.object({
  id: PositiveIntSchema,
  childGameIds: z.array(PositiveIntSchema).min(1),
});

export const GameAdminMergeResponseSchema = z.object({
  success: z.boolean(),
  mergedGameCount: NonNegativeIntSchema,
  movedScoreCount: NonNegativeIntSchema,
});

export const GameAdminLookupInputSchema = z.object({
  ids: z.array(PositiveIntSchema).min(1),
});

export const GameAdminPreviewSchema = z.object({
  id: PositiveIntSchema,
  matchId: PositiveIntSchema,
  beatmapOsuId: NonNegativeIntSchema.nullable(),
  beatmapTitle: z.string().nullable(),
  beatmapDifficulty: z.string().nullable(),
  scoresCount: NonNegativeIntSchema,
  startTime: z.string().datetime().nullable(),
});

/** A save names only the fields the admin edited; the rest stay as stored. */
export const GameScoreAdminUpdateInputSchema = z
  .object({
    id: PositiveIntSchema,
    scoreOverride: NonNegativeIntSchema.nullable(),
    placement: NonNegativeIntSchema,
    maxCombo: NonNegativeIntSchema,
    statGreat: NonNegativeIntSchema.nullable(),
    statOk: NonNegativeIntSchema.nullable(),
    statMeh: NonNegativeIntSchema.nullable(),
    statMiss: NonNegativeIntSchema.nullable(),
    statGood: NonNegativeIntSchema.nullable(),
    statPerfect: NonNegativeIntSchema.nullable(),
    accuracy: z.number().nonnegative().max(1.0),
    grade: ScoreGradeSchema,
    mods: BitmaskEnumValueSchema,
    ruleset: RulesetSchema,
    verificationStatus: VerificationStatusSchema,
    rejectionReason: BitmaskEnumValueSchema,
    team: TeamSchema,
  })
  .partial()
  .required({ id: true });

export const GameScoreAdminMutationResponseSchema = z.object({
  success: z.boolean(),
});

export const MatchAdminDeleteInputSchema = MatchIdInputSchema;

export const MatchAdminDeletePlayerScoresInputSchema = z.object({
  matchId: PositiveIntSchema,
  playerId: PositiveIntSchema,
});

export const MatchAdminDeletePlayerScoresResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: NonNegativeIntSchema,
});

export const GameAdminDeleteInputSchema = z.object({
  id: PositiveIntSchema,
});

export const GameScoreAdminDeleteInputSchema = z.object({
  id: PositiveIntSchema,
});

export const MatchAdminNoteCreateInputSchema = z.object({
  matchId: z.number().int().positive(),
  note: AdminNoteContentSchema,
});

export const MatchAdminNoteUpdateInputSchema = z.object({
  noteId: z.number().int().positive(),
  note: AdminNoteContentSchema,
});

export const MatchAdminNoteDeleteInputSchema = z.object({
  noteId: z.number().int().positive(),
});

export const GameAdminNoteCreateInputSchema = z.object({
  gameId: z.number().int().positive(),
  note: AdminNoteContentSchema,
});

export const GameAdminNoteUpdateInputSchema = z.object({
  noteId: z.number().int().positive(),
  note: AdminNoteContentSchema,
});

export const GameAdminNoteDeleteInputSchema = z.object({
  noteId: z.number().int().positive(),
});

export const GameScoreAdminNoteCreateInputSchema = z.object({
  scoreId: z.number().int().positive(),
  note: AdminNoteContentSchema,
});

export const GameScoreAdminNoteUpdateInputSchema = z.object({
  noteId: z.number().int().positive(),
  note: AdminNoteContentSchema,
});

export const GameScoreAdminNoteDeleteInputSchema = z.object({
  noteId: z.number().int().positive(),
});

export type MatchTournament = z.infer<typeof MatchTournamentSchema>;
export type MatchPlayer = z.infer<typeof MatchPlayerSchema>;
export type MatchBeatmap = z.infer<typeof MatchBeatmapSchema>;
export type MatchRoster = z.infer<typeof MatchRosterSchema>;
export type GameScore = z.infer<typeof GameScoreSchema>;
export type Game = z.infer<typeof GameSchema>;
export type PlayerMatchStats = z.infer<typeof PlayerMatchStatsSchema>;
export type RatingAdjustment = z.infer<typeof RatingAdjustmentSchema>;
export type MatchWinRecord = z.infer<typeof MatchWinRecordSchema>;
export type Match = z.infer<typeof MatchSchema>;
export type MatchDetail = z.infer<typeof MatchDetailSchema>;
export type MatchMerge = z.infer<typeof MatchMergeSchema>;
export type MatchMergeLookup = z.infer<typeof MatchMergeLookupSchema>;
export type MatchAdminUpdateInput = z.infer<typeof MatchAdminUpdateInputSchema>;
export type MatchAdminMutationResponse = z.infer<
  typeof MatchAdminMutationResponseSchema
>;
export type MatchAdminMergeInput = z.infer<typeof MatchAdminMergeInputSchema>;
export type MatchAdminMergeResponse = z.infer<
  typeof MatchAdminMergeResponseSchema
>;
export type MatchAdminDeleteInput = z.infer<typeof MatchAdminDeleteInputSchema>;
export type MatchAdminDeletePlayerScoresInput = z.infer<
  typeof MatchAdminDeletePlayerScoresInputSchema
>;
export type MatchAdminDeletePlayerScoresResponse = z.infer<
  typeof MatchAdminDeletePlayerScoresResponseSchema
>;
export type MatchAdminNoteCreateInput = z.infer<
  typeof MatchAdminNoteCreateInputSchema
>;
export type MatchAdminNoteUpdateInput = z.infer<
  typeof MatchAdminNoteUpdateInputSchema
>;
export type MatchAdminNoteDeleteInput = z.infer<
  typeof MatchAdminNoteDeleteInputSchema
>;
export type GameAdminUpdateInput = z.infer<typeof GameAdminUpdateInputSchema>;
export type GameAdminMutationResponse = z.infer<
  typeof GameAdminMutationResponseSchema
>;
export type GameAdminMergeInput = z.infer<typeof GameAdminMergeInputSchema>;
export type GameAdminMergeResponse = z.infer<
  typeof GameAdminMergeResponseSchema
>;
export type GameAdminLookupInput = z.infer<typeof GameAdminLookupInputSchema>;
export type GameAdminPreview = z.infer<typeof GameAdminPreviewSchema>;
export type GameAdminDeleteInput = z.infer<typeof GameAdminDeleteInputSchema>;
export type GameAdminNoteCreateInput = z.infer<
  typeof GameAdminNoteCreateInputSchema
>;
export type GameAdminNoteUpdateInput = z.infer<
  typeof GameAdminNoteUpdateInputSchema
>;
export type GameAdminNoteDeleteInput = z.infer<
  typeof GameAdminNoteDeleteInputSchema
>;
export type GameScoreAdminUpdateInput = z.infer<
  typeof GameScoreAdminUpdateInputSchema
>;
export type GameScoreAdminMutationResponse = z.infer<
  typeof GameScoreAdminMutationResponseSchema
>;
export type GameScoreAdminDeleteInput = z.infer<
  typeof GameScoreAdminDeleteInputSchema
>;
export type GameScoreAdminNoteCreateInput = z.infer<
  typeof GameScoreAdminNoteCreateInputSchema
>;
export type GameScoreAdminNoteUpdateInput = z.infer<
  typeof GameScoreAdminNoteUpdateInputSchema
>;
export type GameScoreAdminNoteDeleteInput = z.infer<
  typeof GameScoreAdminNoteDeleteInputSchema
>;
