import { ORPCError } from '@orpc/server';
import { eq, inArray, sql } from 'drizzle-orm';

import * as schema from '@otr/core/db/schema';
import { mergeMatchesInto, withAuditUserId } from '@otr/core/db';
import { cascadeMatchRejection } from '@otr/core/db/rejection-cascade';
import { cascadeMatchVerification } from '@otr/core/db/verification-cascade';
import { resolveMatchVerification } from '@otr/core/db/verification-resolve';
import type {
  MatchAdminMergeInput,
  MatchAdminUpdateInput,
} from '@/lib/orpc/schema/match';
import type { DatabaseClient } from '@/lib/db';
import { MatchWarningFlags, VerificationStatus } from '@otr/core/osu';

import { ensureAdminSession } from '../shared/adminGuard';

// No `../base` import here, so handler unit tests skip the auth/db module graph

const NOW = sql`CURRENT_TIMESTAMP`;

interface UpdateMatchAdminContext {
  db: DatabaseClient;
  session: {
    dbUser?: {
      id: number;
      scopes?: string[] | null;
    } | null;
  } | null;
}

export interface UpdateMatchAdminArgs {
  input: MatchAdminUpdateInput;
  context: UpdateMatchAdminContext;
}

export async function updateMatchAdminHandler({
  input,
  context,
}: UpdateMatchAdminArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const existing = await context.db.query.matches.findFirst({
    columns: {
      id: true,
      verifiedByUserId: true,
      verificationStatus: true,
    },
    where: eq(schema.matches.id, input.id),
  });

  if (!existing) {
    throw new ORPCError('NOT_FOUND', {
      message: 'Match not found',
    });
  }

  // A field the admin did not edit is not sent, and stays as stored.
  const verificationStatusChanged =
    input.verificationStatus !== undefined &&
    input.verificationStatus !== existing.verificationStatus;

  const newStatusRequiresReviewer =
    input.verificationStatus === VerificationStatus.Verified ||
    input.verificationStatus === VerificationStatus.Rejected;

  await context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      const verifiedByUserId = (() => {
        if (input.verificationStatus === undefined) {
          return undefined;
        }

        if (!verificationStatusChanged) {
          return existing.verifiedByUserId;
        }

        if (newStatusRequiresReviewer) {
          return adminUserId;
        }

        return null;
      })();

      const shouldClearWarnings =
        input.verificationStatus === VerificationStatus.Verified ||
        input.verificationStatus === VerificationStatus.Rejected;

      const nextWarningFlags = shouldClearWarnings
        ? MatchWarningFlags.None
        : input.warningFlags;

      await tx
        .update(schema.matches)
        .set({
          name: input.name,
          verificationStatus: input.verificationStatus,
          rejectionReason: input.rejectionReason,
          warningFlags: nextWarningFlags,
          startTime: input.startTime,
          endTime: input.endTime,
          verifiedByUserId,
          updated: NOW,
        })
        .where(eq(schema.matches.id, input.id));

      if (input.verificationStatus === VerificationStatus.Verified) {
        if (input.children === 'set') {
          await cascadeMatchVerification(tx, [input.id], { updatedAt: NOW });
        } else if (input.children === 'accept') {
          await resolveMatchVerification(tx, input.id, { updatedAt: NOW });
        }
      }

      if (input.verificationStatus === VerificationStatus.Rejected) {
        await cascadeMatchRejection(tx, [input.id], {
          updatedAt: NOW,
        });
      }
    })
  );

  return { success: true } as const;
}

export interface MergeMatchAdminArgs {
  input: MatchAdminMergeInput;
  context: UpdateMatchAdminContext;
}

export async function mergeMatchAdminHandler({
  input,
  context,
}: MergeMatchAdminArgs) {
  const { adminUserId } = ensureAdminSession(context.session);

  const childIds = Array.from(new Set(input.childMatchIds));

  if (childIds.includes(input.id)) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Cannot merge a match into itself',
    });
  }

  if (childIds.length === 0) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'At least one child match is required',
    });
  }

  return context.db.transaction((tx) =>
    withAuditUserId(tx, adminUserId, async () => {
      const parentMatch = await tx.query.matches.findFirst({
        columns: {
          id: true,
          tournamentId: true,
        },
        where: eq(schema.matches.id, input.id),
      });

      if (!parentMatch) {
        throw new ORPCError('NOT_FOUND', {
          message: 'Parent match not found',
        });
      }

      const childMatches = await tx.query.matches.findMany({
        columns: {
          id: true,
          osuId: true,
          isLazer: true,
          name: true,
          tournamentId: true,
        },
        where: inArray(schema.matches.id, childIds),
      });

      if (childMatches.length !== childIds.length) {
        const foundIds = new Set(childMatches.map((match) => match.id));
        const missingIds = childIds.filter((id) => !foundIds.has(id));

        throw new ORPCError('NOT_FOUND', {
          message: `Matches not found: ${missingIds.join(', ')}`,
        });
      }

      const mismatchedTournament = childMatches.find(
        (match) => match.tournamentId !== parentMatch.tournamentId
      );

      if (mismatchedTournament) {
        throw new ORPCError('BAD_REQUEST', {
          message:
            'All child matches must belong to the same tournament as the parent match to merge',
        });
      }

      const rehomedGameCount = await mergeMatchesInto(
        tx,
        parentMatch.id,
        childMatches
      );

      return {
        success: true,
        mergedMatchCount: childIds.length,
        rehomedGameCount,
      } as const;
    })
  );
}
