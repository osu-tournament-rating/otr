import { z } from 'zod';

import {
  RatingAdjustmentType,
  Ruleset,
  ScoreGrade,
  ScoringType,
  Team,
  TeamType,
  VerificationStatus,
} from '@otr/core/osu';

export const CreatedUpdatedOmit = {
  created: true,
  updated: true,
} as const;

export const RulesetSchema = z
  .enum(Ruleset)
  .describe(
    'Ruleset: 0=Osu, 1=Taiko, 2=Catch, 3=ManiaOther, 4=Mania4k, 5=Mania7k'
  );
// A second describe() replaces the first, so this one restates the values.
export const DefaultRulesetSchema = RulesetSchema.describe(
  'The ruleset the player chose for their profile in their settings. Without one, the ruleset they have played the most verified tournaments in, then the most verified matches, then most recently, and osu! when they have none. 0=Osu, 1=Taiko, 2=Catch, 3=ManiaOther, 4=Mania4k, 5=Mania7k'
);
export const ScoringTypeSchema = z
  .enum(ScoringType)
  .describe('ScoringType: 0=Score, 1=Accuracy, 2=Combo, 3=ScoreV2');
export const TeamTypeSchema = z
  .enum(TeamType)
  .describe('TeamType: 0=HeadToHead, 1=TagCoop, 2=TeamVs, 3=TagTeamVs');
export const TeamSchema = z
  .enum(Team)
  .describe('Team: 0=NoTeam, 1=Blue, 2=Red');
export const ScoreGradeSchema = z
  .enum(ScoreGrade)
  .describe('ScoreGrade: 0=SSH, 1=SH, 2=SS, 3=S, 4=A, 5=B, 6=C, 7=D');
export const RatingAdjustmentTypeSchema = z
  .enum(RatingAdjustmentType)
  .describe('RatingAdjustmentType: 0=Initial, 1=Decay, 2=Match');
export const VerificationStatusSchema = z
  .enum(VerificationStatus)
  .describe(
    'VerificationStatus: 0=None, 1=PreRejected, 2=PreVerified, 3=Rejected, 4=Verified'
  );

export type RulesetValue = z.infer<typeof RulesetSchema>;
export type ScoringTypeValue = z.infer<typeof ScoringTypeSchema>;
export type TeamTypeValue = z.infer<typeof TeamTypeSchema>;
export type TeamValue = z.infer<typeof TeamSchema>;
export type ScoreGradeValue = z.infer<typeof ScoreGradeSchema>;
export type RatingAdjustmentTypeValue = z.infer<
  typeof RatingAdjustmentTypeSchema
>;
export type VerificationStatusValue = z.infer<typeof VerificationStatusSchema>;

export const VerificationChildrenChoiceSchema = z
  .enum(['set', 'accept', 'none'])
  .optional()
  .describe(
    'What a verified parent does to its children: set=verify all, accept=resolve pre-statuses, none=leave unchanged (default)'
  );

export type VerificationChildrenChoice = NonNullable<
  z.infer<typeof VerificationChildrenChoiceSchema>
>;
