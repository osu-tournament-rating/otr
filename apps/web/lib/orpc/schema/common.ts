import { z } from 'zod';

import { tournamentAdminNoteSelectSchema, userSelectSchema } from './base';
import { PlayerSchema } from './player';

const adminNoteUserBaseSchema = userSelectSchema.pick({
  id: true,
  lastLogin: true,
});

export const AdminNoteUserSchema = adminNoteUserBaseSchema.extend({
  player: PlayerSchema,
});

const adminNoteBaseSchema = tournamentAdminNoteSelectSchema.pick({
  id: true,
  referenceId: true,
  note: true,
  created: true,
  updated: true,
});

export const AdminNoteSchema = adminNoteBaseSchema.extend({
  adminUser: AdminNoteUserSchema,
});

export const AdminNotePreviewSchema = adminNoteBaseSchema
  .pick({
    id: true,
    note: true,
    created: true,
  })
  .extend({
    adminUser: z.object({
      player: PlayerSchema.pick({
        id: true,
        username: true,
      }),
    }),
  });

export type AdminNotePreview = z.infer<typeof AdminNotePreviewSchema>;

/** A mod as osu!lazer reports it, with the settings the player changed. */
export const LazerModSchema = z.object({
  acronym: z.string(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
