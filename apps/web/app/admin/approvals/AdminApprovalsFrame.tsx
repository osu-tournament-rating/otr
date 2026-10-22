import { Filter, ListChecks, Upload } from 'lucide-react';
import type * as React from 'react';

import {
  PanelSkeleton,
  PhoneRowListSkeleton,
  SectionHeaderSkeleton,
  TableSkeleton,
  type TableSkeletonColumn,
} from '@/components/kit/feedback/Skeletons';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';

export const SUBMISSION_COLUMNS = {
  tournament: { label: 'Tournament' },
  submitter: { label: 'Submitter', width: 'w-44', showFrom: 'md' },
  matches: { label: 'Matches', width: 'w-24', align: 'end' },
  submitted: { label: 'Submitted', width: 'w-32', showFrom: 'sm' },
  view: { label: '', width: 'w-20', align: 'end' },
} as const satisfies Record<string, TableSkeletonColumn>;

export const FILTER_REQUEST_COLUMNS = {
  requester: { label: 'Requester' },
  players: { label: 'Players', width: 'w-24', align: 'end' },
  unknown: {
    label: 'Not in o!TR',
    width: 'w-36',
    align: 'end',
    showFrom: 'md',
  },
  submitted: { label: 'Submitted', width: 'w-32', showFrom: 'sm' },
  view: { label: '', width: 'w-20', align: 'end' },
} as const satisfies Record<string, TableSkeletonColumn>;

/** The approval queue's frame and header, shared by the page and its loading screen. */
export function AdminApprovalsFrame({
  children,
  ...props
}: React.ComponentProps<typeof PageFrame>) {
  return (
    <PageFrame {...props}>
      <PageHeader
        icon={ListChecks}
        title="Approvals"
        description="Review tournament submissions and registrant filter requests that wait for an admin."
      />
      {children}
    </PageFrame>
  );
}

/** One queue's rows while they load. */
export function ApprovalTableSkeleton({
  columns,
}: {
  columns: Record<string, TableSkeletonColumn>;
}) {
  return (
    <TableSkeleton
      rows={3}
      columns={Object.values(columns)}
      cellHeight="h-9"
      phoneRows={<PhoneRowListSkeleton rows={3} value="button" />}
    />
  );
}

/** Both queues while the page loads. */
export function AdminApprovalsSkeleton() {
  return (
    <>
      <PanelSkeleton label="Loading tournament submissions">
        <SectionHeaderSkeleton icon={Upload} title="Tournament submissions" />
        <ApprovalTableSkeleton columns={SUBMISSION_COLUMNS} />
      </PanelSkeleton>
      <PanelSkeleton label="Loading filter requests">
        <SectionHeaderSkeleton icon={Filter} title="Filter requests" />
        <ApprovalTableSkeleton columns={FILTER_REQUEST_COLUMNS} />
      </PanelSkeleton>
    </>
  );
}
