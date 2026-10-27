import type * as React from 'react';

import { InfoButton } from '@/components/kit/layout/InfoButton';
import { FormLabel } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { aboutLabel } from '@/lib/kit/layout/about-label';
import { cn } from '@/lib/utils';

// The ui Label's text style, for the group label, which is not a <label>.
const GROUP_LABEL_CLASSES =
  'min-w-0 text-sm leading-none font-medium select-none data-[error=true]:text-destructive';

/**
 * A field label with the one info button for help and an optional muted
 * hint on the right, such as a unit or "One per line". Inside a shadcn
 * FormItem it is that field's FormLabel; outside react-hook-form, pass
 * `htmlFor` with the control's id. For a group of controls, such as a
 * RadioGroup, pass `groupId` instead and point the group's
 * `aria-labelledby` at it.
 */
export function FormFieldLabel({
  children,
  info,
  infoLabel,
  hint,
  hintId,
  htmlFor,
  groupId,
  invalid = false,
  className,
}: {
  /** Sentence case: "Forum post URL". */
  children: React.ReactNode;
  /** How to fill in the field, opened from a circled "i". */
  info?: React.ReactNode;
  /**
   * The info button's name; defaults to "About {label}" for a text label,
   * lower-cased mid-sentence ("About lobby size").
   */
  infoLabel?: string;
  hint?: React.ReactNode;
  /**
   * An id for the hint, so the control can point `aria-describedby` at it
   * (a "Required" hint the label doesn't say otherwise).
   */
  hintId?: string;
  /**
   * The id of the control this labels, for a field outside a react-hook-form
   * FormItem (a filter, a search, a field in plain state). Inside a FormItem
   * leave it out; FormLabel finds the control itself.
   */
  htmlFor?: string;
  /**
   * Labels a group of controls, such as a RadioGroup, that no `<label>` can
   * point at: the label is plain text with this id, in the same row, and the
   * group takes `aria-labelledby={groupId}`. Each option keeps its own label.
   */
  groupId?: string;
  /**
   * Turns the label red, as FormLabel does for a field with an error. Only
   * with `htmlFor` or `groupId`; inside a FormItem the form's own error state
   * does it.
   */
  invalid?: boolean;
  className?: string;
}) {
  const name =
    infoLabel ??
    (typeof children === 'string' ? aboutLabel(children) : 'About this field');

  return (
    <div
      data-slot="form-field-label"
      // One row height with or without the info button or hint, so fields
      // side by side in a FormGrid keep their inputs level.
      className={cn('flex min-h-5 min-w-0 items-center gap-1.5', className)}
    >
      {htmlFor !== undefined ? (
        <Label
          htmlFor={htmlFor}
          data-error={invalid}
          className="min-w-0 data-[error=true]:text-destructive"
        >
          {children}
        </Label>
      ) : groupId !== undefined ? (
        <span
          id={groupId}
          data-slot="label"
          data-error={invalid}
          className={GROUP_LABEL_CLASSES}
        >
          {children}
        </span>
      ) : (
        <FormLabel className="min-w-0">{children}</FormLabel>
      )}
      {info ? (
        // `md` is the size beside 14px text; its 20px box is the row height.
        <InfoButton label={name} side="top" align="start">
          {info}
        </InfoButton>
      ) : null}
      {hint ? (
        <span
          id={hintId}
          className="ml-auto shrink-0 text-xs text-muted-foreground"
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}
