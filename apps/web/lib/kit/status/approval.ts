import { ApprovalStatus } from '@otr/core/osu';

export interface ApprovalStatusCopy {
  /** The state's one name, used by the requester and in the admin queue. */
  name: string;
  /** Waiting is neutral; the admin's decision is green or red. */
  tone: 'neutral' | 'success' | 'destructive';
}

export const APPROVAL_STATUS_COPY: Record<ApprovalStatus, ApprovalStatusCopy> =
  {
    [ApprovalStatus.Pending]: { name: 'Pending', tone: 'neutral' },
    [ApprovalStatus.Approved]: { name: 'Approved', tone: 'success' },
    [ApprovalStatus.Denied]: { name: 'Denied', tone: 'destructive' },
  };

const UNKNOWN_APPROVAL_STATUS_COPY: ApprovalStatusCopy = {
  name: 'Unknown status',
  tone: 'neutral',
};

/** Lists and legends show approval states in this order. */
export const APPROVAL_STATUS_ORDER: readonly ApprovalStatus[] = [
  ApprovalStatus.Pending,
  ApprovalStatus.Approved,
  ApprovalStatus.Denied,
];

export function getApprovalStatusCopy(
  status: ApprovalStatus
): ApprovalStatusCopy {
  return APPROVAL_STATUS_COPY[status] ?? UNKNOWN_APPROVAL_STATUS_COPY;
}
