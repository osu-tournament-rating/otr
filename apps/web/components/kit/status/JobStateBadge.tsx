import {
  Ban,
  CalendarClock,
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { Badge, type BadgeSize } from '@/components/kit/status/Badge';
import { getJobStateCopy, type JobBadgeState } from '@/lib/kit/status/job';

const ICONS: Record<JobBadgeState, LucideIcon> = {
  queued: Clock,
  delayed: CalendarClock,
  retrying: RotateCcw,
  running: LoaderCircle,
  succeeded: CircleCheck,
  failed: CircleX,
  cancelled: Ban,
  stalled: TriangleAlert,
};

/**
 * A background job's state on the admin jobs page, and the state of a
 * tournament's fetches and jobs in its progress panel. The glyph carries the
 * state, so it reads without its colour.
 */
export function JobStateBadge({
  state,
  size = 'sm',
  className,
}: {
  state: JobBadgeState;
  size?: BadgeSize;
  className?: string;
}) {
  const { name, tone } = getJobStateCopy(state);
  const Icon = ICONS[state];

  return (
    <Badge
      data-slot="job-state-badge"
      tone={tone}
      size={size}
      className={className}
    >
      <Icon aria-hidden="true" />
      {name}
    </Badge>
  );
}
