import type { VerificationStatus } from '@otr/core/osu';
import { TriangleAlert } from 'lucide-react';
import type * as React from 'react';

import SimpleTooltip from '@/components/simple-tooltip';
import TapTooltip from '@/components/tap-tooltip';
import { getVerificationStatusLine } from '@/lib/kit/status/verification';
import { cn } from '@/lib/utils';

export type VerificationStatusTooltipMode = 'tap' | 'hover';

export interface VerificationStatusDetailsProps {
  status: VerificationStatus;
  /** Warning texts; any warning adds the marker. See `getWarningTexts`. */
  warnings?: readonly string[];
  /** Rejection reason texts. See `getRejectionReasonTexts`. */
  rejectionReasons?: readonly string[];
  /** Who verified or rejected it; shown for those two states only. */
  reviewer?: string | null;
  /**
   * Which item this is when several sit together, such as "Game 3". It
   * always starts the accessible name; the bubble shows it only with
   * `showContext`.
   */
  context?: string;
  /**
   * Heads the bubble with `context`, for icons in a row of look-alikes such
   * as game pips. Leave it off where the row beside the icon names it.
   */
  showContext?: boolean;
  /** A verified item the Tuesday update has not rated yet. */
  pendingRating?: boolean;
}

/**
 * The tooltip body: the status line, then one line per rejection reason
 * and per warning. A colon ends the status line when a list follows.
 */
export function VerificationStatusDetails({
  status,
  warnings,
  rejectionReasons,
  reviewer,
  context,
  showContext = false,
  pendingRating = false,
}: VerificationStatusDetailsProps) {
  const reasons = rejectionReasons ?? [];
  const warningList = warnings ?? [];
  const hasList = reasons.length > 0 || warningList.length > 0;
  const line = getVerificationStatusLine(status, { reviewer, pendingRating });

  return (
    <div className="flex max-w-64 flex-col gap-0.5 text-left text-pretty">
      {showContext && context ? (
        <p className="font-semibold">{context}</p>
      ) : null}
      <p>
        {line}
        {hasList ? ':' : null}
      </p>
      {reasons.length > 0 ? (
        <ul className="list-disc pl-4">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {warningList.length > 0 ? (
        <ul aria-label="Warnings">
          {warningList.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <TriangleAlert
                aria-hidden="true"
                className="mt-px size-3.5 shrink-0 text-warning"
              />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Wraps a status icon or badge in its explanation. `tap` opens on tap,
 * hover and focus and is the default; `hover` adds no button, for use
 * inside a link.
 */
export function VerificationStatusTooltip({
  mode = 'tap',
  label,
  side = 'top',
  triggerClassName,
  children,
  ...details
}: VerificationStatusDetailsProps & {
  mode?: VerificationStatusTooltipMode;
  /** Accessible name for the tap trigger, from `getVerificationStatusLabel`. */
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  const content = <VerificationStatusDetails {...details} />;

  if (mode === 'hover') {
    return (
      <SimpleTooltip side={side} content={content}>
        {children}
      </SimpleTooltip>
    );
  }

  return (
    <TapTooltip
      side={side}
      content={content}
      triggerAriaLabel={label}
      triggerClassName={cn(
        'inline-flex w-auto shrink-0 rounded-full align-middle',
        triggerClassName
      )}
    >
      {children}
    </TapTooltip>
  );
}
