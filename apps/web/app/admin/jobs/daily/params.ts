import type { TableSkeletonColumn } from '@/components/kit/feedback/Skeletons';
import { defineListParams, enumParam } from '@/lib/kit/lists/params';
import { JOB_QUEUES, JOB_TOTALS_DAYS } from '@/lib/orpc/schema/jobs';

/**
 * The daily totals page's address: `?days=90&queue=data.osu`. Both are
 * always in view, so they are scopes.
 */
export const DAILY_TOTALS_PARAMS = defineListParams({
  days: enumParam<(typeof JOB_TOTALS_DAYS)[number]>(JOB_TOTALS_DAYS, {
    default: 30,
    role: 'scope',
  }),
  queue: enumParam(JOB_QUEUES, { role: 'scope' }),
});

export const DAYS_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
] as const;

/** The queue totals table's columns, shared with its loading screen. */
export const QUEUE_TOTAL_COLUMNS = {
  queue: { label: 'Queue' },
  enqueued: { label: 'Queued', width: 'w-24', align: 'end', showFrom: 'xl' },
  succeeded: { label: 'Succeeded', width: 'w-24', align: 'end' },
  retried: { label: 'Retried', width: 'w-24', align: 'end' },
  failed: { label: 'Failed', width: 'w-20', align: 'end' },
  cancelled: {
    label: 'Cancelled',
    width: 'w-24',
    align: 'end',
    showFrom: 'xl',
  },
  average: { label: 'Average', width: 'w-24', align: 'end', showFrom: 'lg' },
  max: { label: 'Longest', width: 'w-24', align: 'end', showFrom: 'lg' },
} as const satisfies Record<string, TableSkeletonColumn>;

/** The request totals table's columns, shared with its loading screen. */
export const REQUEST_TOTAL_COLUMNS = {
  endpoint: { label: 'Endpoint' },
  status: { label: 'Status', width: 'w-32' },
  count: { label: 'Requests', width: 'w-28', align: 'end' },
  average: { label: 'Average', width: 'w-24', align: 'end', showFrom: 'md' },
  max: { label: 'Longest', width: 'w-24', align: 'end', showFrom: 'md' },
} as const satisfies Record<string, TableSkeletonColumn>;
