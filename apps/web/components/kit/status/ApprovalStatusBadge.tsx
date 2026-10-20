import { ApprovalStatus } from '@otr/core/osu';
import { CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react';

import { Badge, type BadgeSize } from '@/components/kit/status/Badge';
import { getApprovalStatusCopy } from '@/lib/kit/status/approval';

const ICONS: Record<ApprovalStatus, LucideIcon> = {
  [ApprovalStatus.Pending]: Clock,
  [ApprovalStatus.Approved]: CircleCheck,
  [ApprovalStatus.Denied]: CircleX,
};

/**
 * Where a held tournament submission or filter request stands, for its
 * requester and in the admin queue: Pending, Approved or Denied. It reuses
 * the status language: a clock while waiting, then a green check or a red
 * cross for the admin's decision.
 */
export function ApprovalStatusBadge({
  status,
  size = 'md',
  className,
}: {
  status: ApprovalStatus;
  size?: BadgeSize;
  className?: string;
}) {
  const { name, tone } = getApprovalStatusCopy(status);
  const Icon = ICONS[status] ?? Clock;

  return (
    <Badge
      data-slot="approval-status-badge"
      tone={tone}
      size={size}
      className={className}
    >
      <Icon aria-hidden="true" />
      {name}
    </Badge>
  );
}
