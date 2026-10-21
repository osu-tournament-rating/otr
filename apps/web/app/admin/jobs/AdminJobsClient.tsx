'use client';

import { Layers, ListChecks, ListFilter, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import SectionError from '@/components/error/SectionError';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { RowActionsMenu } from '@/components/kit/controls/RowActionsMenu';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { SkeletonText } from '@/components/kit/feedback/Skeletons';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ActiveFilterChips } from '@/components/kit/lists/ActiveFilterChips';
import {
  ChoiceFilter,
  FilterField,
  FilterPanel,
} from '@/components/kit/lists/FilterPanel';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { SortControl } from '@/components/kit/lists/SortControl';
import { JobStateBadge } from '@/components/kit/status/JobStateBadge';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { PaginationFooter } from '@/components/kit/tables/PaginationFooter';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { SortableHeader } from '@/components/kit/tables/SortableHeader';
import { ViewButton } from '@/components/kit/tables/ViewButton';
import { Input } from '@/components/ui/input';
import {
  describeJob,
  getJobQueueLabel,
  toJobQueue,
} from '@/lib/jobs/presentation';
import { formatDuration } from '@/lib/kit/format/date';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import { formatChoiceFilterLabel } from '@/lib/kit/lists/filters';
import { useListState } from '@/lib/kit/lists/use-list-state';
import { getJobStateCopy } from '@/lib/kit/status/job';
import type { JobQueue } from '@otr/core/jobs/enums';
import { orpc } from '@/lib/orpc/orpc';
import {
  JOB_QUEUES,
  JOB_STATES,
  type Job,
  type JobQueueSummary,
} from '@/lib/orpc/schema/jobs';

import {
  JOB_LIST_KEY,
  JOB_SUMMARY_KEY,
  JobDialog,
  retryMessage,
  useRefreshJobs,
} from './JobDialog';
import { JobsTableSkeleton, QueueTableSkeleton } from './AdminJobsFrame';
import {
  ADMIN_JOBS_COLUMNS as COLUMN,
  ADMIN_JOBS_PAGE_SIZE,
  ADMIN_JOBS_PARAMS,
  ADMIN_JOB_SORT_OPTIONS,
  QUEUE_COLUMNS,
  toJobListInput,
} from './list-params';

/** How often the counts and the list refresh while the page is open. */
const SUMMARY_REFRESH_MS = 10_000;
const LIST_REFRESH_MS = 15_000;

/**
 * The admin jobs page: each queue's counts, then every job, filtered by
 * queue, state and tournament in the address. A job opens from its View
 * button into one shared dialog, where admins retry or cancel it.
 */
export default function AdminJobsClient() {
  const list = useListState(ADMIN_JOBS_PARAMS);

  return (
    <>
      <QueuesPanel
        onViewJobs={(queue) => list.setState({ queue: [queue], state: [] })}
      />
      <JobsPanel list={list} />
    </>
  );
}

function QueuesPanel({
  onViewJobs,
}: {
  onViewJobs: (queue: JobQueue) => void;
}) {
  const { data, error, isValidating, mutate } = useSWR(
    JOB_SUMMARY_KEY,
    () => orpc.admin.jobs.summary(),
    { refreshInterval: SUMMARY_REFRESH_MS, shouldRetryOnError: false }
  );
  const refreshJobs = useRefreshJobs();

  // Kept after the dialog closes, so it does not empty while it fades out.
  const [retrying, setRetrying] = useState<{
    queue: JobQueue;
    failed: number;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const waiting = data?.reduce((sum, row) => sum + row.ready, 0);

  /** The row's menu; a queue this release does not know has none. */
  const menuFor = (row: JobQueueSummary) => {
    const queue = toJobQueue(row.queue);
    if (!queue) return null;

    return (
      <RowActionsMenu
        itemName={getJobQueueLabel(queue)}
        actions={[
          {
            label: 'View jobs',
            icon: ListFilter,
            onSelect: () => onViewJobs(queue),
          },
          {
            label: 'Retry failed jobs',
            icon: RotateCcw,
            group: 'admin',
            disabled: row.failed === 0,
            description: row.failed === 0 ? 'No failed jobs' : undefined,
            onSelect: () => {
              setRetrying({ queue, failed: row.failed });
              setConfirmOpen(true);
            },
          },
        ]}
      />
    );
  };

  return (
    <Panel data-testid="admin-jobs-queues">
      <SectionHeader
        icon={Layers}
        title="Queues"
        meta={
          waiting === undefined ? undefined : `${formatCount(waiting)} queued`
        }
      />
      {!data && error ? (
        <SectionError
          title="Queues could not load"
          retrying={isValidating}
          onRetry={() => void mutate()}
        />
      ) : !data ? (
        <div role="status" aria-label="Loading queues">
          <QueueTableSkeleton />
        </div>
      ) : (
        <DataTable
          fixed
          aria-label="Queues"
          phoneRows={
            <PhoneRowList aria-label="Queues">
              {data.map((row) => (
                <PhoneRow
                  key={row.queue}
                  align="start"
                  title={
                    <span className="truncate font-medium">
                      {getJobQueueLabel(row.queue)}
                    </span>
                  }
                  description={[
                    `${formatCount(row.ready)} queued`,
                    `${formatCount(row.delayed)} delayed`,
                    `${formatCount(row.running)} running`,
                    `${formatCount(row.failed)} failed`,
                  ].join(' · ')}
                  value={menuFor(row)}
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>{QUEUE_COLUMNS.queue.label}</DataTableHead>
              <DataTableHead className={QUEUE_COLUMNS.ready.width} numeric>
                {QUEUE_COLUMNS.ready.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMNS.delayed.width}
                showFrom={QUEUE_COLUMNS.delayed.showFrom}
                numeric
                info="Waiting until later, such as a retry after an error"
              >
                {QUEUE_COLUMNS.delayed.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMNS.running.width}
                showFrom={QUEUE_COLUMNS.running.showFrom}
                numeric
              >
                {QUEUE_COLUMNS.running.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMNS.failed.width}
                numeric
                info="Kept for 14 days after they fail"
              >
                {QUEUE_COLUMNS.failed.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMNS.oldest.width}
                showFrom={QUEUE_COLUMNS.oldest.showFrom}
                numeric
              >
                {QUEUE_COLUMNS.oldest.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMNS.actions.width}
                align="end"
              >
                <span className="sr-only">Actions</span>
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {data.map((row) => (
              <DataTableRow key={row.queue} data-testid="admin-jobs-queue-row">
                <DataTableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {getJobQueueLabel(row.queue)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {row.queue}
                    </span>
                  </span>
                </DataTableCell>
                <DataTableCell numeric>{formatCount(row.ready)}</DataTableCell>
                <DataTableCell
                  numeric
                  showFrom={QUEUE_COLUMNS.delayed.showFrom}
                >
                  {formatCount(row.delayed)}
                </DataTableCell>
                <DataTableCell
                  numeric
                  showFrom={QUEUE_COLUMNS.running.showFrom}
                >
                  {formatCount(row.running)}
                </DataTableCell>
                <DataTableCell numeric>{formatCount(row.failed)}</DataTableCell>
                <DataTableCell numeric showFrom={QUEUE_COLUMNS.oldest.showFrom}>
                  {row.ready > 0
                    ? formatDuration(row.oldestReadySeconds)
                    : null}
                </DataTableCell>
                <DataTableCell align="end" empty={false}>
                  {menuFor(row)}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="default"
        title="Retry failed jobs?"
        description={
          retrying ? (
            <p>
              Queues {formatCountOf(retrying.failed, 'failed job')} in{' '}
              <span className="font-medium text-foreground">
                {getJobQueueLabel(retrying.queue)}
              </span>{' '}
              to run again now. A job whose work another job is already doing is
              skipped.
            </p>
          ) : null
        }
        confirmLabel="Retry jobs"
        pendingLabel="Retrying…"
        errorText="Failed to retry the jobs"
        onConfirm={async () => {
          if (!retrying) return;
          const result = await orpc.admin.jobs.retry({
            queue: retrying.queue,
          });
          toast.success(retryMessage(result));
          void refreshJobs();
        }}
      />
    </Panel>
  );
}

type JobsList = ReturnType<typeof useListState<typeof ADMIN_JOBS_PARAMS>>;

function JobsPanel({ list }: { list: JobsList }) {
  const { state, setState } = list;
  const input = toJobListInput(state);

  const { data, error, isValidating, mutate } = useSWR(
    [JOB_LIST_KEY, input],
    () => orpc.admin.jobs.list(input),
    {
      refreshInterval: LIST_REFRESH_MS,
      keepPreviousData: true,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  // Kept after the dialog closes, so it does not empty while it fades out.
  const [selected, setSelected] = useState<Job | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // An old link to a page past the end shows the last page instead.
  useEffect(() => {
    if (data && data.totalCount > 0) {
      const lastPage = Math.ceil(data.totalCount / ADMIN_JOBS_PAGE_SIZE);
      if (state.page > lastPage) {
        setState({ page: lastPage }, { history: 'replace' });
      }
    }
  }, [data, setState, state.page]);

  const openJob = useCallback((job: Job) => {
    setSelected(job);
    setDialogOpen(true);
  }, []);

  const jobs = data?.jobs ?? [];
  const filtered = list.activeFilterCount > 0;
  const dateColumn =
    state.sort.key === 'updated'
      ? { key: 'updated' as const, label: 'Updated' }
      : { key: 'created' as const, label: COLUMN.date.label };

  return (
    <>
      <Panel data-testid="admin-jobs-list">
        <ListToolbar
          label="Sort and filter jobs"
          sort={
            <SortControl
              label="Sort jobs by"
              options={ADMIN_JOB_SORT_OPTIONS}
              value={state.sort}
              onValueChange={(sort) => setState({ sort })}
            />
          }
          filters={
            <FilterPanel
              title="Filter jobs"
              activeCount={list.activeFilterCount}
              onClearAll={list.clearFilters}
            >
              <ChoiceFilter
                label="Queue"
                options={JOB_QUEUES.map((queue) => ({
                  value: queue,
                  label: getJobQueueLabel(queue),
                }))}
                value={state.queue}
                onValueChange={(queue) => setState({ queue })}
              />
              <ChoiceFilter
                label="State"
                options={JOB_STATES.map((jobState) => ({
                  value: jobState,
                  label: getJobStateCopy(jobState).name,
                }))}
                value={state.state}
                onValueChange={(next) => setState({ state: next })}
              />
              <TournamentIdFilter
                value={state.tournament}
                onValueChange={(tournament) => setState({ tournament })}
              />
            </FilterPanel>
          }
          count={
            data ? (
              formatCountOf(data.totalCount, 'job')
            ) : error ? undefined : (
              <SkeletonText className="h-3 w-16" />
            )
          }
          activeFilters={
            <ActiveFilterChips
              onClearAll={list.clearFilters}
              filters={[
                {
                  key: 'queue',
                  label: formatChoiceFilterLabel(
                    'Queue',
                    state.queue.map(getJobQueueLabel)
                  ),
                  onRemove: () => setState({ queue: [] }),
                },
                {
                  key: 'state',
                  label: formatChoiceFilterLabel(
                    'State',
                    state.state.map((value) => getJobStateCopy(value).name)
                  ),
                  onRemove: () => setState({ state: [] }),
                },
                {
                  key: 'tournament',
                  label:
                    state.tournament === undefined
                      ? ''
                      : `Tournament ${formatId(state.tournament)}`,
                  onRemove: () => setState({ tournament: undefined }),
                },
              ]}
            />
          }
        />

        {error && !data ? (
          <SectionError
            title="Jobs could not load"
            retrying={isValidating}
            onRetry={() => void mutate()}
          />
        ) : !data ? (
          <div role="status" aria-label="Loading jobs">
            <JobsTableSkeleton />
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={filtered ? 'No jobs match' : 'No jobs yet'}
            description={
              filtered
                ? 'Try another queue, state or tournament.'
                : 'Finished jobs are kept for 14 days.'
            }
            clearFilters={filtered ? { onClick: list.clearFilters } : undefined}
            data-testid="admin-jobs-empty"
          />
        ) : (
          <>
            <DataTable
              fixed
              stickyHeader
              aria-label="Jobs"
              phoneRows={
                <PhoneRowList aria-label="Jobs">
                  {jobs.map((job) => {
                    const subject = describeJob(job.queue, job.payload);
                    return (
                      <PhoneRow
                        key={job.id}
                        align="start"
                        title={
                          <span className="truncate font-medium">
                            {subject.title}
                          </span>
                        }
                        description={
                          <span className="flex min-w-0 items-center gap-1.5">
                            <JobStateBadge state={job.state} />
                            <span className="truncate">
                              #{formatId(job.id)} ·{' '}
                              {getJobQueueLabel(job.queue)}
                            </span>
                          </span>
                        }
                        value={
                          <ViewButton
                            subject={`job #${formatId(job.id)}`}
                            onClick={() => openJob(job)}
                          />
                        }
                      />
                    );
                  })}
                </PhoneRowList>
              }
            >
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead className={COLUMN.id.width}>
                    {COLUMN.id.label}
                  </DataTableHead>
                  <DataTableHead>{COLUMN.job.label}</DataTableHead>
                  <DataTableHead
                    className={COLUMN.tournament.width}
                    showFrom={COLUMN.tournament.showFrom}
                  >
                    {COLUMN.tournament.label}
                  </DataTableHead>
                  <DataTableHead className={COLUMN.state.width}>
                    {COLUMN.state.label}
                  </DataTableHead>
                  <DataTableHead className={COLUMN.attempts.width} numeric>
                    {COLUMN.attempts.label}
                  </DataTableHead>
                  <SortableHeader
                    sortKey={dateColumn.key}
                    sort={state.sort}
                    getSortHref={(sort) => list.hrefFor({ sort })}
                    className={COLUMN.date.width}
                    showFrom={COLUMN.date.showFrom}
                  >
                    {dateColumn.label}
                  </SortableHeader>
                  <DataTableHead
                    className={COLUMN.view.width}
                    align={COLUMN.view.align}
                  >
                    <span className="sr-only">Actions</span>
                  </DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {jobs.map((job) => {
                  const subject = describeJob(job.queue, job.payload);
                  return (
                    <DataTableRow
                      key={job.id}
                      data-testid="admin-jobs-row"
                      data-job-id={job.id}
                    >
                      <DataTableCell className="text-muted-foreground tabular-nums">
                        {formatId(job.id)}
                      </DataTableCell>
                      <DataTableCell>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {subject.title}
                            {subject.detail ? (
                              <span className="font-normal text-muted-foreground">
                                {' '}
                                · {subject.detail}
                              </span>
                            ) : null}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {getJobQueueLabel(job.queue)}
                          </span>
                        </span>
                      </DataTableCell>
                      <DataTableCell showFrom={COLUMN.tournament.showFrom}>
                        {job.tournament ? (
                          <EntityLink
                            href={`/tournaments/${job.tournament.id}`}
                            title={job.tournament.name}
                          >
                            {job.tournament.name}
                          </EntityLink>
                        ) : null}
                      </DataTableCell>
                      <DataTableCell>
                        <JobStateBadge state={job.state} />
                      </DataTableCell>
                      <DataTableCell numeric>
                        {formatCount(job.attempts)} of{' '}
                        {formatCount(job.maxAttempts)}
                      </DataTableCell>
                      <DataTableCell muted showFrom={COLUMN.date.showFrom}>
                        <Timestamp
                          date={
                            dateColumn.key === 'updated'
                              ? (job.updated ?? job.created)
                              : job.created
                          }
                        />
                      </DataTableCell>
                      <DataTableCell align="end" empty={false}>
                        <ViewButton
                          subject={`job #${formatId(job.id)}`}
                          data-testid="admin-jobs-view"
                          onClick={() => openJob(job)}
                        />
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
            <PaginationFooter
              page={state.page}
              pageSize={ADMIN_JOBS_PAGE_SIZE}
              totalCount={data.totalCount}
              getPageHref={(page) => list.hrefFor({ page })}
              label="Job pages"
            />
          </>
        )}
      </Panel>

      <JobDialog
        job={selected}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

/**
 * A tournament's ID, applied on Enter or when the box loses focus. An empty
 * box clears the filter; anything that is not an ID puts back the last one.
 */
function TournamentIdFilter({
  value,
  onValueChange,
}: {
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === '') {
      onValueChange(undefined);
      return;
    }
    const id = Number(trimmed);
    if (Number.isSafeInteger(id) && id > 0 && /^\d+$/.test(trimmed)) {
      onValueChange(id);
    }
  };

  return (
    <FilterField label="Tournament ID">
      <Input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Tournament ID"
        placeholder="Any"
        value={draft ?? (value === undefined ? '' : String(value))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && draft !== null) {
            event.stopPropagation();
            setDraft(null);
          }
        }}
        className="h-8 tabular-nums placeholder:text-muted-foreground"
      />
    </FilterField>
  );
}
