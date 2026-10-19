import { ReportStatus } from '@otr/core/osu';

export interface ReportStatusCopy {
  /** The state's one name, used on My reports and the admin queue. */
  name: string;
  /** Waiting is neutral; the admin's outcome is green or red. */
  tone: 'neutral' | 'success' | 'destructive';
}

export const REPORT_STATUS_COPY: Record<ReportStatus, ReportStatusCopy> = {
  [ReportStatus.Pending]: {
    name: 'Pending',
    tone: 'neutral',
  },
  [ReportStatus.Approved]: {
    name: 'Confirmed',
    tone: 'success',
  },
  [ReportStatus.Rejected]: {
    name: 'Dismissed',
    tone: 'destructive',
  },
};

const UNKNOWN_REPORT_STATUS_COPY: ReportStatusCopy = {
  name: 'Unknown status',
  tone: 'neutral',
};

/** Filters and legends list report states in this order. */
export const REPORT_STATUS_ORDER: readonly ReportStatus[] = [
  ReportStatus.Pending,
  ReportStatus.Approved,
  ReportStatus.Rejected,
];

export function getReportStatusCopy(status: ReportStatus): ReportStatusCopy {
  return REPORT_STATUS_COPY[status] ?? UNKNOWN_REPORT_STATUS_COPY;
}
