import {
  Badge,
  type BadgeSize,
  type BadgeTone,
} from '@/components/kit/status/Badge';
import {
  StatusWarningMarker,
  VerificationStatusGlyph,
} from '@/components/kit/status/VerificationStatusIcon';
import {
  VerificationStatusTooltip,
  type VerificationStatusDetailsProps,
  type VerificationStatusTooltipMode,
} from '@/components/kit/status/VerificationStatusTooltip';
import {
  getVerificationStatusHue,
  getVerificationStatusLabel,
  getVerificationStatusName,
  isAutomatedCheckStatus,
  type StatusHue,
} from '@/lib/kit/status/verification';
import { cn } from '@/lib/utils';

const HUE_TONES: Record<StatusHue, BadgeTone> = {
  success: 'success',
  neutral: 'neutral',
  destructive: 'destructive',
};

const MARKER_SIZES: Record<BadgeSize, string> = {
  sm: 'size-2.5',
  md: 'size-3',
  lg: 'size-3.5',
};

/**
 * Verification status as icon plus name, for heroes, headers, dialogs and
 * any place with room for the word. The hue follows the outcome (green,
 * neutral or red); an admin's decision is filled, an automated check is a
 * dashed outline with no fill.
 */
export function VerificationStatusBadge({
  status,
  size = 'md',
  variant = 'soft',
  warnings,
  rejectionReasons,
  reviewer,
  context,
  showContext,
  pendingRating,
  tooltip,
  className,
}: VerificationStatusDetailsProps & {
  size?: BadgeSize;
  /** `overlay` only on cover art. */
  variant?: 'soft' | 'overlay';
  /** Adds the status line with its reviewer, then reasons and warnings. */
  tooltip?: VerificationStatusTooltipMode;
  className?: string;
}) {
  const hasWarnings = (warnings?.length ?? 0) > 0;
  const name = getVerificationStatusName(status);
  const automated = isAutomatedCheckStatus(status);

  const badge = (
    <Badge
      data-slot="verification-status-badge"
      size={size}
      className={cn(automated && 'border-dashed', className)}
      {...(variant === 'overlay'
        ? { variant: 'overlay' as const }
        : {
            variant: automated ? ('outline' as const) : ('soft' as const),
            tone: HUE_TONES[getVerificationStatusHue(status)],
          })}
    >
      <VerificationStatusGlyph status={status} />
      <span>{name}</span>
      {hasWarnings ? (
        <span className="inline-flex">
          <StatusWarningMarker className={MARKER_SIZES[size]} />
          <span className="sr-only">, with warnings</span>
        </span>
      ) : null}
    </Badge>
  );

  if (!tooltip) {
    return badge;
  }

  return (
    <VerificationStatusTooltip
      mode={tooltip}
      label={getVerificationStatusLabel(status, { context, hasWarnings })}
      status={status}
      warnings={warnings}
      rejectionReasons={rejectionReasons}
      reviewer={reviewer}
      context={context}
      showContext={showContext}
      pendingRating={pendingRating}
    >
      {badge}
    </VerificationStatusTooltip>
  );
}
