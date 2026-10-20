import type { TableSkeletonColumn } from '@/components/kit/feedback/Skeletons';
import type { SortOption } from '@/components/kit/lists/SortControl';
import {
  arrayParam,
  defineListParams,
  numberParam,
  pageParam,
  sortParam,
  type ListState,
} from '@/lib/kit/lists/params';
import { toDescending } from '@/lib/kit/lists/sort';
import {
  JOB_QUEUES,
  JOB_STATES,
  type JobListInput,
  type JobListSort,
} from '@/lib/orpc/schema/jobs';

/** Jobs per page. */
export const ADMIN_JOBS_PAGE_SIZE = 50;

const SORT_KEYS = ['created', 'updated'] as const satisfies JobListSort[];

/** The jobs list's address: `?queue=data.osu&state=failed&tournament=12&page=2`. */
export const ADMIN_JOBS_PARAMS = defineListParams({
  queue: arrayParam(JOB_QUEUES),
  state: arrayParam(JOB_STATES),
  tournament: numberParam({ min: 1, integer: true }),
  sort: sortParam(SORT_KEYS, { key: 'created', direction: 'desc' }),
  page: pageParam(),
});

export type AdminJobsState = ListState<typeof ADMIN_JOBS_PARAMS>;

const NEWEST_FIRST = { desc: 'Newest first', asc: 'Oldest first' } as const;

export const ADMIN_JOB_SORT_OPTIONS: readonly SortOption<
  (typeof SORT_KEYS)[number]
>[] = [
  { value: 'created', label: 'Queued', directionLabels: NEWEST_FIRST },
  { value: 'updated', label: 'Updated', directionLabels: NEWEST_FIRST },
];

/** The `admin.jobs.list` input for a state of the list. */
export function toJobListInput(state: AdminJobsState): JobListInput {
  return {
    queue: state.queue,
    state: state.state,
    tournamentId: state.tournament,
    page: state.page,
    pageSize: ADMIN_JOBS_PAGE_SIZE,
    ...toDescending(state.sort),
  };
}

/** The list's columns, shared by the table and its loading screen. */
export const ADMIN_JOBS_COLUMNS = {
  id: { label: 'ID', width: 'w-24' },
  job: { label: 'Job' },
  tournament: { label: 'Tournament', width: 'w-56', showFrom: 'lg' },
  state: { label: 'State', width: 'w-32' },
  attempts: { label: 'Attempts', width: 'w-24', align: 'end' },
  date: { label: 'Queued', width: 'w-48', showFrom: 'xl' },
  view: { label: '', width: 'w-24', align: 'end' },
} as const satisfies Record<string, TableSkeletonColumn>;

export const ADMIN_JOBS_SKELETON_COLUMNS: readonly TableSkeletonColumn[] =
  Object.values(ADMIN_JOBS_COLUMNS);

/** The queue table's columns. */
export const QUEUE_COLUMNS = {
  queue: { label: 'Queue' },
  ready: { label: 'Queued', width: 'w-24', align: 'end' },
  delayed: { label: 'Delayed', width: 'w-24', align: 'end', showFrom: 'md' },
  running: { label: 'Running', width: 'w-24', align: 'end', showFrom: 'md' },
  failed: { label: 'Failed', width: 'w-24', align: 'end' },
  oldest: {
    label: 'Oldest waiting',
    width: 'w-32',
    align: 'end',
    showFrom: 'lg',
  },
  actions: { label: '', width: 'w-14', align: 'end' },
} as const satisfies Record<string, TableSkeletonColumn>;

export const QUEUE_SKELETON_COLUMNS: readonly TableSkeletonColumn[] =
  Object.values(QUEUE_COLUMNS);
