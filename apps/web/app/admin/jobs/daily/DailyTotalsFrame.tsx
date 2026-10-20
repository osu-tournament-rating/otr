import { ChartColumn, ChartColumnStacked, Globe, Layers } from 'lucide-react';
import type * as React from 'react';

import {
  ChartPlotSkeleton,
  PanelSkeleton,
  PhoneRowListSkeleton,
  SectionHeaderSkeleton,
  SkeletonBlock,
  TableSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';

import { QUEUE_TOTAL_COLUMNS, REQUEST_TOTAL_COLUMNS } from './params';

export const PANELS = {
  jobs: { icon: ChartColumnStacked, title: 'Job attempts by day' },
  queues: { icon: Layers, title: 'Totals by queue' },
  requests: { icon: ChartColumn, title: 'Requests by day' },
  endpoints: { icon: Globe, title: 'Requests by endpoint' },
} as const;

/** The page's frame and header; `actions` holds the range switch. */
export function DailyTotalsFrame({
  actions,
  children,
  ...props
}: React.ComponentProps<typeof PageFrame> & { actions: React.ReactNode }) {
  return (
    <PageFrame {...props}>
      <PageHeader
        icon={ChartColumn}
        title={<span data-testid="admin-job-totals-heading">Daily totals</span>}
        description="Jobs run and osu! and osu!track requests made per UTC day."
        back={{ href: '/admin/jobs', label: 'Jobs' }}
        actions={actions}
      />
      {children}
    </PageFrame>
  );
}

/** The range switch's place while the page loads. */
export function RangeSwitchSkeleton() {
  return <SkeletonBlock className="h-8 w-full rounded-lg sm:w-60" />;
}

const CHART_HEIGHT = 'h-60';

export function ChartPanelSkeleton({
  panel,
  label,
}: {
  panel: (typeof PANELS)[keyof typeof PANELS];
  label?: string;
}) {
  return (
    <PanelSkeleton label={label}>
      <SectionHeaderSkeleton icon={panel.icon} title={panel.title} />
      <div className="flex flex-col gap-3 p-4">
        <SkeletonBlock className="h-4 w-64 max-w-full" />
        <ChartPlotSkeleton className={CHART_HEIGHT} />
      </div>
    </PanelSkeleton>
  );
}

export function QueueTotalsTableSkeleton() {
  return (
    <TableSkeleton
      columns={Object.values(QUEUE_TOTAL_COLUMNS)}
      rows={5}
      cellHeight="h-9"
      phoneRows={<PhoneRowListSkeleton rows={5} />}
    />
  );
}

export function RequestTotalsTableSkeleton() {
  return (
    <TableSkeleton
      columns={Object.values(REQUEST_TOTAL_COLUMNS)}
      rows={6}
      cellHeight="h-9"
      phoneRows={<PhoneRowListSkeleton rows={6} />}
    />
  );
}

/** Every panel while the totals load. */
export function DailyTotalsSkeleton() {
  return (
    <>
      <ChartPanelSkeleton panel={PANELS.jobs} label="Loading daily totals" />
      <PanelSkeleton>
        <SectionHeaderSkeleton
          icon={PANELS.queues.icon}
          title={PANELS.queues.title}
          meta={false}
        />
        <QueueTotalsTableSkeleton />
      </PanelSkeleton>
      <ChartPanelSkeleton panel={PANELS.requests} />
      <PanelSkeleton>
        <SectionHeaderSkeleton
          icon={PANELS.endpoints.icon}
          title={PANELS.endpoints.title}
          meta={false}
        />
        <RequestTotalsTableSkeleton />
      </PanelSkeleton>
    </>
  );
}
