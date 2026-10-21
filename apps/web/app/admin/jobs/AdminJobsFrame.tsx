import { ChartColumn, Layers, ListChecks } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';

import { Button } from '@/components/kit/controls/Button';
import {
  ListToolbarSkeleton,
  PanelSkeleton,
  PhoneRowListSkeleton,
  SectionHeaderSkeleton,
  TableSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';

import {
  ADMIN_JOBS_SKELETON_COLUMNS,
  QUEUE_SKELETON_COLUMNS,
} from './list-params';

/** The jobs page's icon, also its header menu item's. */
export const JOBS_ICON = ListChecks;

/** The jobs page's frame and header, shared by the page and its loading screen. */
export function AdminJobsFrame({
  children,
  ...props
}: React.ComponentProps<typeof PageFrame>) {
  return (
    <PageFrame {...props}>
      <PageHeader
        icon={JOBS_ICON}
        title={<span data-testid="admin-jobs-heading">Jobs</span>}
        description="Background work the data worker runs, by queue."
        actions={
          <Button asChild variant="outline" icon={ChartColumn}>
            <Link href="/admin/jobs/daily">Daily totals</Link>
          </Button>
        }
      />
      {children}
    </PageFrame>
  );
}

/** The queue table's rows while it loads. */
export function QueueTableSkeleton() {
  return (
    <TableSkeleton
      columns={QUEUE_SKELETON_COLUMNS}
      rows={5}
      cellHeight="h-8"
      phoneRows={<PhoneRowListSkeleton rows={5} value="button" align="start" />}
    />
  );
}

export function QueuesPanelSkeleton() {
  return (
    <PanelSkeleton label="Loading queues">
      <SectionHeaderSkeleton icon={Layers} title="Queues" meta="w-28" />
      <QueueTableSkeleton />
    </PanelSkeleton>
  );
}

/** The jobs table's rows while a page of jobs loads. */
export function JobsTableSkeleton() {
  return (
    <TableSkeleton
      columns={ADMIN_JOBS_SKELETON_COLUMNS}
      cellHeight="h-9"
      phoneRows={
        <PhoneRowListSkeleton
          description="badge"
          value="button"
          align="start"
        />
      }
    />
  );
}

export function JobsPanelSkeleton() {
  return (
    <PanelSkeleton>
      <ListToolbarSkeleton sort filters count />
      <JobsTableSkeleton />
    </PanelSkeleton>
  );
}
