import { z } from 'zod';

import { playerSelectSchema } from './base';
import { CreatedUpdatedOmit, DefaultRulesetSchema } from './constants';

/**
 * A player as other responses embed them: a match's players, a tournament's
 * submitter, a note's author. Whether they are restricted is left out.
 */
export const PlayerSchema = playerSelectSchema
  .omit({ ...CreatedUpdatedOmit, restricted: true })
  .extend({
    defaultRuleset: DefaultRulesetSchema,
    userId: z.number().int().nullable().optional(),
  });

export type Player = z.infer<typeof PlayerSchema>;

/** A player on their own, as `/players/{id}` returns them. */
export const PlayerDetailSchema = PlayerSchema.extend({
  restricted: z
    .boolean()
    .describe(
      'True when the player is restricted on osu!. Restricted players are on no leaderboard.'
    ),
});

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
