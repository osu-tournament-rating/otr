import { ORPCError } from '@orpc/server';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { withAuditUserId } from '@otr/core/db';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';
import { enqueueJobs, JobQueue } from '@otr/core/jobs';
import {
  BeatmapAdminUpdateInputSchema,
  BeatmapAdminUpdateResponseSchema,
  type BeatmapAdminUpdateInput,
} from '@/lib/orpc/schema/beatmap';
import type { DatabaseClient } from '@/lib/db';

import { adminMutationProcedure } from '../base';
import { ensureAdminSession } from '../shared/adminGuard';

const NOW = sql`CURRENT_TIMESTAMP`;

interface UpdateBeatmapAdminContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface UpdateBeatmapAdminArgs {
  input: BeatmapAdminUpdateInput;
  context: UpdateBeatmapAdminContext;
}

export async function updateBeatmapAdminHandler({
  input,
  context,
}: UpdateBeatmapAdminArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const existing = await context.db.query.beatmaps.findFirst({
    columns: {
      id: true,
      dataFetchStatus: true,
    },
    where: eq(schema.beatmaps.id, input.id),
  });

  if (!existing) {
    throw new ORPCError('NOT_FOUND', {
      message: 'Beatmap not found',
    });
  }

  if (existing.dataFetchStatus !== DataFetchStatus.NotFound) {
    throw new ORPCError('CONFLICT', {
      message:
        'Only beatmaps the osu! API no longer serves can be edited by hand',
    });
  }

  const creatorOsuIds = Array.from(new Set(input.creatorOsuIds));

  await context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      const queuedPlayerOsuIds: number[] = [];
      const [setOwnerIdOverride] = input.setOwnerOsuIdOverride
        ? await resolvePlayerIds(
            tx,
            [input.setOwnerOsuIdOverride],
            queuedPlayerOsuIds
          )
        : [];

      if (input.setOwnerOsuIdOverride && setOwnerIdOverride == null) {
        throw new ORPCError('NOT_FOUND', {
          message: `No player could be resolved for osu! id ${input.setOwnerOsuIdOverride}`,
        });
      }

      await tx
        .update(schema.beatmaps)
        .set({
          diffName: input.diffName,
          ruleset: input.ruleset,
          rankedStatus: input.rankedStatus,
          totalLength: input.totalLength,
          drainLength: input.drainLength,
          bpm: input.bpm,
          countCircle: input.countCircle,
          countSlider: input.countSlider,
          countSpinner: input.countSpinner,
          cs: input.cs,
          hp: input.hp,
          od: input.od,
          ar: input.ar,
          sr: input.sr,
          maxCombo: input.maxCombo,
          titleOverride: input.titleOverride || null,
          artistOverride: input.artistOverride || null,
          setOwnerIdOverride: setOwnerIdOverride ?? null,
          manualOverride: true,
          updated: NOW,
        })
        .where(eq(schema.beatmaps.id, input.id));

      const previousCreators = await tx
        .select({ osuId: schema.players.osuId })
        .from(schema.joinBeatmapCreators)
        .innerJoin(
          schema.players,
          eq(schema.players.id, schema.joinBeatmapCreators.creatorsId)
        )
        .where(eq(schema.joinBeatmapCreators.createdBeatmapsId, input.id));

      const creatorPlayerIds = await resolvePlayerIds(
        tx,
        creatorOsuIds,
        queuedPlayerOsuIds
      );

      await tx
        .delete(schema.joinBeatmapCreators)
        .where(
          and(
            eq(schema.joinBeatmapCreators.createdBeatmapsId, input.id),
            creatorPlayerIds.length > 0
              ? notInArray(
                  schema.joinBeatmapCreators.creatorsId,
                  creatorPlayerIds
                )
              : undefined
          )
        );

      if (creatorPlayerIds.length > 0) {
        await tx
          .insert(schema.joinBeatmapCreators)
          .values(
            creatorPlayerIds.map((creatorsId) => ({
              createdBeatmapsId: input.id,
              creatorsId,
            }))
          )
          .onConflictDoNothing();
      }

      await recordCreatorAudit(
        tx,
        input.id,
        adminUserId,
        previousCreators.map((row) => row.osuId).sort((a, b) => a - b),
        [...creatorOsuIds].sort((a, b) => a - b)
      );

      await enqueueJobs(
        tx,
        JobQueue.OsuFetch,
        queuedPlayerOsuIds.map((osuPlayerId) => ({
          payload: { type: 'player', osuPlayerId },
          requestedByUserId: adminUserId,
          explicit: true,
        }))
      );
    })
  );

  return { success: true };
}

export const updateBeatmapAdmin = adminMutationProcedure
  .input(BeatmapAdminUpdateInputSchema)
  .output(BeatmapAdminUpdateResponseSchema)
  .route({
    summary: 'Update a deleted beatmap',
    tags: ['admin'],
    method: 'PATCH',
    path: '/beatmaps/{id}',
  })
  .handler(async ({ input, context }) =>
    updateBeatmapAdminHandler({ input, context })
  );

type TransactionClient = Parameters<
  Parameters<DatabaseClient['transaction']>[0]
>[0];

/** Creates a placeholder for any player o!TR has never seen. */
const resolvePlayerIds = async (
  tx: TransactionClient,
  osuIds: number[],
  queuedPlayerOsuIds: number[]
): Promise<number[]> => {
  if (osuIds.length === 0) {
    return [];
  }

  const known = await tx
    .select({ id: schema.players.id, osuId: schema.players.osuId })
    .from(schema.players)
    .where(inArray(schema.players.osuId, osuIds));

  const idByOsuId = new Map(known.map((row) => [row.osuId, row.id]));
  const missing = osuIds.filter((osuId) => !idByOsuId.has(osuId));

  if (missing.length > 0) {
    const inserted = await tx
      .insert(schema.players)
      .values(missing.map((osuId) => ({ osuId })))
      .onConflictDoNothing()
      .returning({ id: schema.players.id, osuId: schema.players.osuId });

    for (const row of inserted) {
      idByOsuId.set(row.osuId, row.id);
      queuedPlayerOsuIds.push(row.osuId);
    }

    const conflicted = missing.filter((osuId) => !idByOsuId.has(osuId));

    if (conflicted.length > 0) {
      const rows = await tx
        .select({ id: schema.players.id, osuId: schema.players.osuId })
        .from(schema.players)
        .where(inArray(schema.players.osuId, conflicted));

      for (const row of rows) {
        idByOsuId.set(row.osuId, row.id);
      }
    }
  }

  return osuIds
    .map((osuId) => idByOsuId.get(osuId))
    .filter((id): id is number => id != null);
};

// No audit trigger on the creator join table
const recordCreatorAudit = async (
  tx: TransactionClient,
  beatmapId: number,
  adminUserId: number,
  before: number[],
  after: number[]
) => {
  if (
    before.length === after.length &&
    before.every((osuId, index) => osuId === after[index])
  ) {
    return;
  }

  await tx.execute(sql`
    insert into beatmap_audits (
      event_id,
      reference_id_lock,
      reference_id,
      action_user_id,
      action_type,
      changes
    )
    values (
      public.resolve_audit_event_id(${adminUserId}),
      ${beatmapId},
      ${beatmapId},
      ${adminUserId},
      1,
      jsonb_build_object(
        'creators',
        jsonb_build_object(
          'originalValue', ${JSON.stringify(before)}::jsonb,
          'newValue', ${JSON.stringify(after)}::jsonb
        )
      )
    )
  `);
};
