'use client';

import { ChevronDown } from 'lucide-react';
import type * as React from 'react';
import { AuditEntityType, VerificationStatus } from '@otr/core/osu';

import {
  IconButton,
  type IconButtonProps,
} from '@/components/kit/controls/IconButton';
import {
  AuditChangeList,
  AuditFieldChange,
} from '@/components/kit/format/AuditFieldChange';
import {
  VerificationStatusGlyph,
  VerificationStatusIcon,
} from '@/components/kit/status/VerificationStatusIcon';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import type {
  AuditActionUser,
  AuditEventAction,
} from '@/lib/orpc/schema/audit';
import type { FormattedAuditValue } from '@/lib/kit/format/audit';
import { formatId } from '@/lib/kit/format/number';
import { cn } from '@/lib/utils';

/** Who made the change: their avatar and name as one link, or "System". */
export function AuditActor({
  user,
  fallback,
}: {
  user: AuditActionUser | null;
  /** "System" for automated changes, "Unknown" when the user is gone. */
  fallback: string;
}) {
  if (!user) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  // As the report queue names a user without a username.
  const name = user.username ?? `User #${formatId(user.id)}`;
  const avatar = user.osuId ? (
    <OsuAvatar osuId={user.osuId} username={user.username} size={20} />
  ) : null;

  if (user.playerId) {
    return (
      <EntityLink
        variant="inline"
        href={`/players/${user.playerId}`}
        leading={avatar}
      >
        {name}
      </EntityLink>
    );
  }

  // No profile to open: the same avatar and name, unlinked. The avatar's
  // wrapper copies the inline EntityLink's, so both rows keep the line's
  // height and centre the avatar on it.
  return (
    <span>
      {avatar ? (
        <span
          aria-hidden="true"
          className="mr-1.5 inline-flex h-lh items-center align-top"
        >
          {avatar}
        </span>
      ) : null}
      {name}
    </span>
  );
}

/** The status an event leaves behind, for its one status icon. */
const ACTION_STATUS: Partial<Record<AuditEventAction, VerificationStatus>> = {
  verification: VerificationStatus.Verified,
  pre_verification: VerificationStatus.PreVerified,
  rejection: VerificationStatus.Rejected,
  pre_rejection: VerificationStatus.PreRejected,
};

/**
 * The column every audit row starts with: the status icon for a
 * verification event, empty for anything else, so the sentences line up.
 */
export function AuditStatusSlot({
  action,
  icon,
}: {
  action?: AuditEventAction;
  /** A muted glyph for rows that are not changes, such as admin notes. */
  icon?: React.ReactNode;
}) {
  const status = action ? ACTION_STATUS[action] : undefined;

  return (
    <span className="flex h-5 w-4 shrink-0 items-center justify-center">
      {status !== undefined ? (
        // The sentence beside it names the change, so the icon only marks it.
        <VerificationStatusIcon status={status} decorative />
      ) : (
        icon
      )}
    </span>
  );
}

/**
 * One row's first line: the status column, the sentence, the time (under
 * the sentence on phones) and the expand button, or a spacer in its place so
 * the times line up.
 */
export function AuditRowLine({
  action,
  icon,
  sentence,
  meta,
  toggle,
  sentenceTestId,
}: {
  action?: AuditEventAction;
  icon?: React.ReactNode;
  sentence: React.ReactNode;
  /** The time, and any short note before it. */
  meta: React.ReactNode;
  toggle?: React.ReactNode;
  sentenceTestId?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <AuditStatusSlot action={action} icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-4">
        <p
          data-testid={sentenceTestId}
          className="min-w-0 flex-1 text-sm leading-5 [overflow-wrap:anywhere]"
        >
          {sentence}
        </p>
        {/* The time ticks in place, so its digits keep their width. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 text-xs leading-5 text-muted-foreground tabular-nums">
          {meta}
        </div>
      </div>
      {toggle ?? (
        <span aria-hidden="true" className="-my-1.5 size-8 shrink-0" />
      )}
    </div>
  );
}

/**
 * The disclosure button that opens a row's details. Put it inside
 * `CollapsibleTrigger asChild`. The turned chevron and `aria-expanded` say
 * the row is open; as a disclosure it keeps its resting look, so the many
 * rows that open on their own don't each carry a filled square.
 */
export function AuditRowToggle({
  open,
  className,
  ...props
}: Omit<IconButtonProps, 'label' | 'icon' | 'expanded'> & { open: boolean }) {
  return (
    <IconButton
      label="Details"
      icon={ChevronDown}
      expanded={open}
      className={cn(
        '-my-1.5 shrink-0 [&>svg]:transition-transform aria-expanded:[&>svg]:rotate-180',
        className
      )}
      {...props}
    />
  );
}

/** A row's details, indented to the sentence. */
export function AuditRowDetails({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-3 flex flex-col gap-3 pl-7', className)}
      {...props}
    />
  );
}

type ReferencedUsers = Record<string, { username: string | null }>;

/** A verification status keeps its glyph beside its name in a diff. */
function renderStatusValue(value: FormattedAuditValue): React.ReactNode {
  if (value.status === undefined) return value.text;

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <VerificationStatusGlyph status={value.status} className="size-3.5" />
      {value.text}
    </span>
  );
}

/** The changed fields of one entry, as the kit's audit diff lines. */
export function AuditChanges({
  entityType,
  changes,
  users,
  className,
}: {
  entityType: AuditEntityType;
  changes: Record<string, { originalValue: unknown; newValue: unknown }>;
  users?: ReferencedUsers;
  className?: string;
}) {
  return (
    <AuditChangeList data-testid="audit-diff" className={className}>
      {Object.entries(changes).map(([field, change]) => (
        <AuditFieldChange
          key={field}
          entityType={entityType}
          field={field}
          change={change}
          users={users}
          renderValue={renderStatusValue}
        />
      ))}
    </AuditChangeList>
  );
}

/** An entry's changes, typed for the diff, or null after a deletion. */
export function readChanges(
  changes: Record<string, unknown> | null | undefined
): Record<string, { originalValue: unknown; newValue: unknown }> | null {
  return (
    (changes as Record<
      string,
      { originalValue: unknown; newValue: unknown }
    > | null) ?? null
  );
}
