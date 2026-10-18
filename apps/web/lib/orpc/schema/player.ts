import { z } from 'zod';

import { playerSelectSchema } from './base';
import { CreatedUpdatedOmit, DefaultRulesetSchema } from './constants';

export const PlayerSchema = playerSelectSchema.omit(CreatedUpdatedOmit).extend({
  defaultRuleset: DefaultRulesetSchema,
  userId: z.number().int().nullable().optional(),
});

export type Player = z.infer<typeof PlayerSchema>;

export const PlayerLookupInputSchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(25).default(10),
});

export const PlayerLookupResultSchema = z.object({
  osuId: z.number().int().positive(),
  username: z.string(),
  /** Null when o!TR has no player record yet. */
  playerId: z.number().int().nullable(),
});

export const PlayerLookupResponseSchema = z.object({
  players: z.array(PlayerLookupResultSchema),
});

export type PlayerLookupResult = z.infer<typeof PlayerLookupResultSchema>;
