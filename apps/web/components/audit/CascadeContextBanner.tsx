'use client';

import { Fragment, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { ChevronDown } from 'lucide-react';
import { AuditEntityType, VerificationStatus } from '@otr/core/osu';
import type {
  AuditEntry,
  CascadeContext,
  CascadeDescendant,
} from '@/lib/orpc/schema/audit';
import {
  entityTypeToSlug,
  ENTITY_TYPE_PLURALS,
  formatAffectedCount,
} from '@/lib/audit-entity-types';
import { ACTION_NOUNS } from '@/lib/audit-actions';
import { orpc } from '@/lib/orpc/orpc';
import SectionError from '@/components/error/SectionError';
import { Button } from '@/components/kit/controls/Button';
import { RowListSkeleton } from '@/components/kit/feedback/Skeletons';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { formatId } from '@/lib/kit/format/number';
import { VERIFICATION_STATUS_COPY } from '@/lib/kit/status/verification';
import { cn } from '@/lib/utils';
import { getBreakdownSummaryParts } from './ActionBreakdownPhrase';
import { getEntityTypeName, nameOr } from './auditParams';

type CascadeContextBannerProps = {
  context: CascadeContext;
  /** The entity whose page this renders on; a cascade it started reads as impact, not context. */
  viewedEntity?: { entityType: AuditEntityType; entityId: number };
};

/**
 * "85 of 118 matches", or "58 matches: 57 verified, 1 rejected". Each half
 * wraps as a unit, so a level too wide for a phone breaks after the colon.
 */
function CountLabel({ descendant }: { descendant: CascadeDescendant }) {
  const { entityType, affectedCount, totalCount, actionBreakdown } = descendant;
  const parts = actionBreakdown
    ? getBreakdownSummaryParts(actionBreakdown, entityType, totalCount)
    : [formatAffectedCount(entityType, affectedCount, totalCount)];

  return (
    <span>
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 ? ' ' : null}
          <span className="inline-block">{part}</span>
        </Fragment>
      ))}
    </span>
  );
}

type AffectedEntity = {
  id: number;
  entityName: string | null;
  changes: Record<string, unknown>;
};

function statusOf(changes: Record<string, unknown>): VerificationStatus | null {
  const change = changes.verificationStatus as
    { newValue?: unknown } | undefined;
  const value = change?.newValue;
  if (typeof value !== 'number') return null;
  return Object.prototype.hasOwnProperty.call(VERIFICATION_STATUS_COPY, value)
    ? (value as VerificationStatus)
    : null;
}

/** An event writes one audit row per changed field group, so an entity can appear several times. */
function groupByEntity(entries: AuditEntry[]): AffectedEntity[] {
  const byEntity = new Map<number, AffectedEntity>();
  for (const entry of entries) {
    const id = entry.referenceId ?? entry.referenceIdLock;
    const existing = byEntity.get(id);
    if (existing) {
      existing.changes = { ...entry.changes, ...existing.changes };
      existing.entityName ??= entry.entityName ?? null;
    } else {
      byEntity.set(id, {
        id,
        entityName: entry.entityName ?? null,
        changes: { ...entry.changes },
      });
    }
  }
  return [...byEntity.values()];
}

type AffectedEntitiesResponse = {
  entries: AuditEntry[];
  nextCursor: number | null;
  hasMore: boolean;
};

function AffectedEntities({
  context,
  entityType,
}: {
  context: CascadeContext;
  entityType: AuditEntityType;
}): React.JSX.Element {
  const { data, size, setSize, isLoading, isValidating, error, mutate } =
    useSWRInfinite(
      (_index: number, previous: AffectedEntitiesResponse | null) => {
        if (previous && !previous.hasMore) return null;
        return [
          'cascade-affected-entities',
          context.eventId,
          context.actionUserId,
          context.created,
          entityType,
          previous?.nextCursor ?? null,
        ] as const;
      },
      async ([, eventId, actionUserId, created, type, cursor]) =>
        orpc.audit.eventDetails({
          eventId: eventId ?? undefined,
          actionUserId,
          created,
          entityType: type,
          cursor: cursor ?? undefined,
          limit: 50,
        }),
      {
        revalidateOnFocus: false,
        revalidateIfStale: false,
        dedupingInterval: 60_000,
      }
    );

  const pages = data ?? [];
  const affected = groupByEntity(pages.flatMap((page) => page.entries));
  const hasMore = pages[pages.length - 1]?.hasMore ?? false;
  const slug = entityTypeToSlug(entityType);

  return (
    <div className="flex flex-col gap-2">
      {isLoading ? (
        <RowListSkeleton
          rows={2}
          leading="none"
          description={false}
          trailing={false}
        />
      ) : null}

      {affected.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {affected.map((entity) => {
            const status = statusOf(entity.changes);
            const name = nameOr(
              entity.entityName,
              `${getEntityTypeName(entityType)} #${formatId(entity.id)}`
            );
            return (
              <li key={entity.id} className="flex items-center gap-2">
                <span className="flex w-4 shrink-0 justify-center">
                  {status !== null ? (
                    <VerificationStatusIcon
                      status={status}
                      size="sm"
                      context={name}
                      tooltip="tap"
                    />
                  ) : null}
                </span>
                <EntityLink href={`/audit/${slug}/${entity.id}`} wrap>
                  {name}
                </EntityLink>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Under the list, so a failed later batch keeps the names above. */}
      {error ? (
        <SectionError
          size="inline"
          title={`${affected.length > 0 ? 'More affected' : 'Affected'} ${ENTITY_TYPE_PLURALS[entityType]} could not load`}
          retrying={isValidating}
          onRetry={() => void mutate()}
        />
      ) : null}

      {hasMore && !error ? (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start"
          pending={isValidating}
          onClick={() => setSize(size + 1)}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The cascade an entry belongs to, as a muted line in its row: the event
 * that caused it, or, on the page of the entity that started it, what else
 * it touched. Each affected level opens a list of those entities.
 */
export default function CascadeContextBanner({
  context,
  viewedEntity,
}: CascadeContextBannerProps): React.JSX.Element {
  const [openLevel, setOpenLevel] = useState<AuditEntityType | null>(null);

  const slug = entityTypeToSlug(context.topEntityType);
  const entityName = nameOr(
    context.topEntityName,
    `#${formatId(context.topEntityId)}`
  );
  const actionLabel = ACTION_NOUNS[context.action];
  const startedHere =
    viewedEntity?.entityType === context.topEntityType &&
    viewedEntity.entityId === context.topEntityId;

  return (
    <div
      data-testid="cascade-context-banner"
      className="flex flex-col gap-2 text-sm"
    >
      <p className="text-muted-foreground">
        {startedHere ? (
          <>
            This {actionLabel} also affected
            {context.descendants.length === 0 ? ' no children' : ':'}
          </>
        ) : (
          <>
            Part of {/* The name keeps the text colour in the muted line. */}
            <EntityLink
              variant="inline"
              href={`/audit/${slug}/${context.topEntityId}`}
              className="text-foreground"
            >
              {entityName}
            </EntityLink>{' '}
            {actionLabel}
            {context.descendants.length > 0 && ' — also affected:'}
          </>
        )}
      </p>

      {context.descendants.length > 0 ? (
        <div
          data-testid="cascade-impact-levels"
          className="flex flex-wrap items-center gap-2"
        >
          {context.descendants.map((descendant) => {
            const isOpen = openLevel === descendant.entityType;
            return (
              <Button
                key={descendant.entityType}
                variant="outline"
                size="sm"
                // Wraps on a phone instead of running past the row.
                wrap
                aria-expanded={isOpen}
                onClick={() =>
                  setOpenLevel(isOpen ? null : descendant.entityType)
                }
                className="font-normal [&_svg]:transition-transform"
              >
                <CountLabel descendant={descendant} />
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'text-muted-foreground',
                    isOpen && 'rotate-180'
                  )}
                />
              </Button>
            );
          })}
        </div>
      ) : null}

      {openLevel !== null ? (
        <AffectedEntities context={context} entityType={openLevel} />
      ) : null}
    </div>
  );
}
