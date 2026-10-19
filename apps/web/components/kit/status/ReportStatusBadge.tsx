import { ReportStatus } from '@otr/core/osu';
import { CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react';

import { Badge, type BadgeSize } from '@/components/kit/status/Badge';
import { getReportStatusCopy } from '@/lib/kit/status/report';

const ICONS: Record<ReportStatus, LucideIcon> = {
  [ReportStatus.Pending]: Clock,
  [ReportStatus.Approved]: CircleCheck,
  [ReportStatus.Rejected]: CircleX,
};

/**
 * A data report's state on My reports and the admin queue: Pending,
 * Confirmed or Dismissed. It reuses the status language: a clock while
 * waiting, then a green check or a red cross for the admin's outcome.
 */
export function ReportStatusBadge({
  status,
  size = 'md',
  className,
}: {
  status: ReportStatus;
  size?: BadgeSize;
  className?: string;
}) {
  const { name, tone } = getReportStatusCopy(status);
  const Icon = ICONS[status] ?? Clock;

  return (
    <Badge
      data-slot="report-status-badge"
      tone={tone}
      size={size}
      className={className}
    >
      <Icon aria-hidden="true" />
      {name}
    </Badge>
  );
}
