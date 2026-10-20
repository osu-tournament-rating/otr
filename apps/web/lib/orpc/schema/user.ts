import { users } from '@otr/core/db/schema';
import { Ruleset } from '@otr/core/osu';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { RulesetSchema } from './constants';

export const UserSchema = createSelectSchema(users).pick({
  id: true,
  lastLogin: true,
  scopes: true,
  playerId: true,
  lastViewedReportsAt: true,
});

export const PublicUserSchema = z.object({
  id: z.number().int(),
  player: z
    .object({
      id: z.number().int(),
      osuId: z.number().int(),
      username: z.string(),
      country: z.string(),
    })
    .nullable(),
});

export const CurrentUserSchema = z.object({
  player: z.object({
    id: z.number().int(),
    username: z.string(),
    osuId: z.number().int(),
    country: z.string(),
  }),
  scopes: z.array(z.string()),
  userId: z.number().int().nullable(),
});

export type CurrentUser = z.infer<typeof CurrentUserSchema>;

/** A ruleset a player can choose in their settings: one they can be rated in. */
export const RatedRulesetSchema = z
  .literal([
    Ruleset.Osu,
    Ruleset.Taiko,
    Ruleset.Catch,
    Ruleset.Mania4k,
    Ruleset.Mania7k,
  ])
  .describe('Ruleset: 0=Osu, 1=Taiko, 2=Catch, 4=Mania4k, 5=Mania7k');

export type RatedRuleset = z.infer<typeof RatedRulesetSchema>;

/** The signed-in player's ruleset settings. Null means most played. */
export const UserSettingsSchema = z.object({
  profileRuleset: RulesetSchema.nullable(),
  browsingRuleset: RulesetSchema.nullable(),
  /**
   * The ruleset they have played most, which a null setting follows. Null
   * with no verified tournaments.
   */
  mostPlayedRuleset: RulesetSchema.nullable(),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** The settings to change; a key left out keeps its value, null clears it. */
export const UpdateUserSettingsInputSchema = z
  .object({
    profileRuleset: RatedRulesetSchema.nullable().optional(),
    browsingRuleset: RatedRulesetSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.profileRuleset !== undefined || input.browsingRuleset !== undefined,
    { message: 'At least one setting is required' }
  );

export type UpdateUserSettingsInput = z.infer<
  typeof UpdateUserSettingsInputSchema
>;

export const ADMIN_BAN_REASONS = [
  'API abuse',
  'Submissions abuse',
  'Requests abuse',
] as const;

export const AdminBanReasonSchema = z.enum(ADMIN_BAN_REASONS);

export const AdminBanUserInputSchema = z.object({
  playerId: z.number().int().positive(),
  reason: AdminBanReasonSchema,
});

export const AdminBanUserResponseSchema = z.object({
  success: z.boolean(),
});

export const AdminAuthUserSchema = z.object({
  id: z.string(),
  playerId: z.number().int(),
  banned: z.boolean(),
  banReason: z.string().nullable(),
  banExpires: z.string().nullable(),
});

export const AdminBanUserLookupResponseSchema = z.object({
  exists: z.boolean(),
  authUser: AdminAuthUserSchema.nullable(),
});

export const AdminUserApiKeysInputSchema = z.object({
  playerId: z.number().int().positive(),
});

export type AdminUserApiKeysInput = z.infer<typeof AdminUserApiKeysInputSchema>;

export type AdminBanReason = z.infer<typeof AdminBanReasonSchema>;
export type AdminAuthUser = z.infer<typeof AdminAuthUserSchema>;
export type AdminBanUserLookupResponse = z.infer<
  typeof AdminBanUserLookupResponseSchema
>;

export const AdminPlayerSearchInputSchema = z.object({
  query: z.string().trim().min(2).max(100),
});

export const AdminPlayerSearchResultSchema = z.object({
  playerId: z.number().int(),
  username: z.string(),
  osuId: z.number().int(),
  banned: z.boolean(),
  banReason: z.string().nullable(),
  /** The former username the query hit, or null when the current one did. */
  matchedPreviousUsername: z.string().nullable(),
});

export const AdminPlayerSearchResponseSchema =
  AdminPlayerSearchResultSchema.array();

export type AdminPlayerSearchInput = z.infer<
  typeof AdminPlayerSearchInputSchema
>;
export type AdminPlayerSearchResult = z.infer<
  typeof AdminPlayerSearchResultSchema
>;
