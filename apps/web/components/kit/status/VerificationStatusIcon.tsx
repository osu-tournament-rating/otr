import { VerificationStatus } from '@otr/core/osu';
import {
  CircleCheck,
  CircleDashedCheck,
  CircleX,
  Clock,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { CircleDashedX } from '@/components/kit/status/CircleDashedX';
import {
  VerificationStatusTooltip,
  type VerificationStatusDetailsProps,
  type VerificationStatusTooltipMode,
} from '@/components/kit/status/VerificationStatusTooltip';
import {
  getVerificationStatusHue,
  getVerificationStatusLabel,
  type StatusHue,
} from '@/lib/kit/status/verification';
import { cn } from '@/lib/utils';

/** The glyph carries the outcome; a dashed outline means an automated check. */
const GLYPHS: Record<VerificationStatus, LucideIcon> = {
  [VerificationStatus.Verified]: CircleCheck,
  [VerificationStatus.PreVerified]: CircleDashedCheck,
  [VerificationStatus.None]: Clock,
  [VerificationStatus.PreRejected]: CircleDashedX,
  [VerificationStatus.Rejected]: CircleX,
};

// Verification keeps its own palette (globals.css `--verification-*`). The
// pre-states take their outcome's hue; the dashed outline marks them.
const HUE_CLASSES: Record<StatusHue, string> = {
  success: 'text-verification-verified',
  neutral: 'text-verification-neutral',
  destructive: 'text-verification-rejected',
};

export type VerificationStatusIconSize = 'sm' | 'md' | 'lg';

const ICON_SIZES: Record<VerificationStatusIconSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
};

const WARNING_MARKER_SIZES: Record<VerificationStatusIconSize, string> = {
  sm: 'size-2.5',
  md: 'size-3',
  lg: 'size-3.5',
};

/** `default` on any surface; `overlay` on cover art. */
export type VerificationStatusIconVariant = 'default' | 'overlay';

/**
 * The overlay's dark disc. At 80% black it keeps every glyph colour at 3:1
 * or more over white art (tested in `status.test.tsx`), and `dark` gives the
 * glyph the dark theme's lighter colours whatever the page's theme. The
 * padding makes a 24px disc (and tap target) around the 16px glyph.
 */
export const OVERLAY_DISC_ALPHA = 0.8;

const OVERLAY_CLASSES = 'dark rounded-full bg-black/80 ring-1 ring-white/15';

const OVERLAY_PADDING: Record<VerificationStatusIconSize, string> = {
  sm: 'p-0.5',
  md: 'p-1',
  lg: 'p-1',
};

/**
 * The bare status glyph in its status colour, hidden from assistive tech.
 * Use it where the status name is already written next to it, such as a
 * legend; otherwise use `VerificationStatusIcon`.
 */
export function VerificationStatusGlyph({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  const Glyph = GLYPHS[status] ?? Clock;

  return (
    <Glyph
      aria-hidden="true"
      className={cn(
        'shrink-0',
        HUE_CLASSES[getVerificationStatusHue(status)],
        className
      )}
    />
  );
}

/** The small triangle that flags warnings beside a status, never instead of it. */
export function StatusWarningMarker({ className }: { className?: string }) {
  return (
    <TriangleAlert
      aria-hidden="true"
      className={cn('shrink-0 text-warning', className)}
    />
  );
}

/**
 * Verification status as an icon, for table cells, game pips and dense
 * rows. Every state reads in greyscale; warnings add a marker. Pass
 * `tooltip` wherever the name is not written next to it. On cover art, use
 * `variant="overlay"`, which sets the glyph on a dark disc.
 */
export function VerificationStatusIcon({
  status,
  size = 'md',
  variant = 'default',
  warnings,
  rejectionReasons,
  reviewer,
  context,
  showContext,
  pendingRating,
  tooltip,
  decorative = false,
  className,
}: VerificationStatusDetailsProps & {
  /** `sm` for inline text, `md` for rows, `lg` for headers. */
  size?: VerificationStatusIconSize;
  /** `overlay` sets the glyph on a dark disc, for cover art only. */
  variant?: VerificationStatusIconVariant;
  /** `tap` opens on tap, hover and focus; use `hover` only inside a link. */
  tooltip?: VerificationStatusTooltipMode;
  /** Hide it from assistive tech because the name is written beside it. */
  decorative?: boolean;
  className?: string;
}) {
  const hasWarnings = (warnings?.length ?? 0) > 0;
  const label = getVerificationStatusLabel(status, { context, hasWarnings });
  const hidden = decorative || tooltip === 'tap';

  const icon = (
    <span
      data-slot="verification-status-icon"
      data-variant={variant}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 align-middle',
        variant === 'overlay' && [OVERLAY_CLASSES, OVERLAY_PADDING[size]],
        className
      )}
      {...(hidden
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label })}
    >
      <VerificationStatusGlyph status={status} className={ICON_SIZES[size]} />
      {hasWarnings ? (
        <StatusWarningMarker className={WARNING_MARKER_SIZES[size]} />
      ) : null}
    </span>
  );

  if (!tooltip || decorative) {
    return icon;
  }

  return (
    <VerificationStatusTooltip
      mode={tooltip}
      label={label}
      status={status}
      warnings={warnings}
      rejectionReasons={rejectionReasons}
      reviewer={reviewer}
      context={context}
      showContext={showContext}
      pendingRating={pendingRating}
    >
      {icon}
    </VerificationStatusTooltip>
  );
}
