import { z } from 'zod';

export const AdminMassEnqueueInputSchema = z.object({
  beatmapIds: z.array(z.number().int().min(1).max(20_000_000)).default([]),
  matchIds: z.array(z.number().int().positive()).default([]),
  /** osu! user IDs */
  playerIds: z.array(z.number().int().positive()).default([]),
  priority: z.enum(['Low', 'Normal', 'High']).default('Normal'),
});

export const AdminMassEnqueueResponseSchema = z.object({
  beatmapsUpdated: z.number().int().nonnegative(),
  beatmapsSkipped: z.number().int().nonnegative(),
  matchesUpdated: z.number().int().nonnegative(),
  matchesSkipped: z.number().int().nonnegative(),
  playersUpdated: z.number().int().nonnegative(),
  playersSkipped: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1)).optional(),
});

export const AdminMassEnqueueProgressEventSchema = z.discriminatedUnion(
  'type',
  [
    z.object({
      type: z.literal('progress'),
      phase: z.enum(['beatmaps', 'matches', 'players']),
      currentBatch: z.number().int().positive(),
      totalBatches: z.number().int().positive(),
      itemsProcessed: z.number().int().nonnegative(),
      totalItems: z.number().int().nonnegative(),
      message: z.string().min(1),
    }),
    z.object({
      type: z.literal('complete'),
      beatmapsUpdated: z.number().int().nonnegative(),
      beatmapsSkipped: z.number().int().nonnegative(),
      matchesUpdated: z.number().int().nonnegative(),
      matchesSkipped: z.number().int().nonnegative(),
      playersUpdated: z.number().int().nonnegative(),
      playersSkipped: z.number().int().nonnegative(),
      warnings: z.array(z.string().min(1)).optional(),
    }),
  ]
);

export type AdminMassEnqueueInput = z.infer<typeof AdminMassEnqueueInputSchema>;
export type AdminMassEnqueueResponse = z.infer<
  typeof AdminMassEnqueueResponseSchema
>;
export type AdminMassEnqueueProgressEvent = z.infer<
  typeof AdminMassEnqueueProgressEventSchema
>;
