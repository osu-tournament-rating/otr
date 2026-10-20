'use client';

import type { VerificationStatus } from '@otr/core/osu';
import type { ControllerFieldState } from 'react-hook-form';

import { Button } from '@/components/kit/controls/Button';
import { VerificationStatusGlyph } from '@/components/kit/status/VerificationStatusIcon';
import type { Option } from '@/components/select/multiple-select';
import { SelectContent, SelectItem } from '@/components/ui/select';
import type { EnumLabels } from '@/lib/kit/format/enum-labels';
import { RULESET_NAMES } from '@/lib/kit/format/ruleset';
import {
  VERIFICATION_STATUS_ORDER,
  getVerificationStatusName,
} from '@/lib/kit/status/verification';
import type { VerificationChildrenChoice } from '@/lib/orpc/schema/constants';
import { cn } from '@/lib/utils';

/** Marks a field the admin changed and that is still valid. */
export function changedFieldClass(fieldState: ControllerFieldState) {
  return cn(
    fieldState.isDirty &&
      !fieldState.invalid &&
      'border-warning ring-warning focus-visible:border-warning focus-visible:ring-warning/20'
  );
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return Object.is(a, b);
}

/**
 * The fields of `values` that differ from the ones the dialog loaded. A
 * save sends only these, so a field the admin left alone never writes back
 * a value that someone, or the data worker, has changed since.
 */
export function editedValues<T extends Record<string, unknown>>(
  values: T,
  loaded: { [K in keyof T]?: unknown }
): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([field, value]) => !isSameValue(value, loaded[field as keyof T])
    )
  ) as Partial<T>;
}

/** Every ruleset by its short name, `ManiaOther` included: admin pickers offer it. */
export const ALL_RULESET_LABELS: EnumLabels = Object.fromEntries(
  Object.entries(RULESET_NAMES).map(([value, { label }]) => [value, label])
);

/** Select options for a stored enum, in enum order, named by the kit labels. */
export function LabelSelectContent({ labels }: { labels: EnumLabels }) {
  return (
    <SelectContent>
      {Object.entries(labels)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
    </SelectContent>
  );
}

/**
 * The five verification states, in display order, each with its glyph and
 * its one name. Every admin edit dialog (tournament, match, game, score)
 * picks a status from this list.
 */
export function VerificationStatusSelectContent() {
  return (
    <SelectContent>
      {VERIFICATION_STATUS_ORDER.map((status: VerificationStatus) => (
        <SelectItem key={status} value={String(status)}>
          <VerificationStatusGlyph status={status} className="size-4" />
          {getVerificationStatusName(status)}
        </SelectItem>
      ))}
    </SelectContent>
  );
}

/** Multi-select options for a bitflag enum, leaving out its empty value. */
export function flagOptions(labels: EnumLabels): Option[] {
  return Object.entries(labels)
    .filter(([value]) => Number(value) !== 0)
    .map(([value, label]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en-US'));
}

/** The selected flags of a multi-select, combined into one bitflag value. */
export function combineFlags(values: readonly string[]): number {
  return values.reduce((flags, value) => flags | Number(value), 0);
}

/** Header copy for the step that asks what verifying does to the children. */
export const VERIFY_CHILDREN_TITLE = 'Apply to children';
export const VERIFY_CHILDREN_DESCRIPTION =
  'Rejected children stay rejected unless you verify everything.';

/**
 * The second step of an edit dialog that verifies a match or game: what to
 * do with its games and scores. It replaces the form in the same dialog.
 */
export function VerifyChildrenChoices({
  onChoice,
  pending,
}: {
  onChoice: (choice: VerificationChildrenChoice) => void;
  /** The choice being saved, which shows a spinner. */
  pending: VerificationChildrenChoice | null;
}) {
  const disabled = pending !== null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={() => onChoice('set')}
        pending={pending === 'set'}
        disabled={disabled}
      >
        Verify all children
      </Button>
      <Button
        variant="outline"
        onClick={() => onChoice('accept')}
        pending={pending === 'accept'}
        disabled={disabled}
      >
        Accept pre-statuses
      </Button>
      <Button
        variant="outline"
        onClick={() => onChoice('none')}
        pending={pending === 'none'}
        disabled={disabled}
      >
        Leave children unchanged
      </Button>
    </div>
  );
}

/** The wording the delete confirmations share, from the old delete dialog. */
export const DELETE_CASCADE_DESCRIPTION = (
  <>
    <p>
      This action will cascade to all children. All associated data will be
      permanently removed.
    </p>
    <p>This action cannot be undone.</p>
  </>
);
