'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import useSWR from 'swr';

import SectionError from '@/components/error/SectionError';
import { ChartLegend } from '@/components/kit/charts/ChartLegend';
import { ChartTooltipContent } from '@/components/kit/charts/ChartTooltip';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ScopeSwitch } from '@/components/kit/lists/ScopeSwitch';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';
import {
  attemptsOf,
  averageRunTimeMs,
  listEndpoints,
  sortEndpointTotals,
  toJobDayRows,
  toRequestDayRows,
} from '@/lib/jobs/daily';
import { getJobQueueLabel } from '@/lib/jobs/presentation';
import {
  CHART_BAR_RADIUS,
  CHART_CURSOR,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import { formatCountTick, formatTimeTick } from '@/lib/kit/charts/format';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getNiceTicks,
  getTimeTicks,
} from '@/lib/kit/charts/ticks';
import { seriesColor } from '@/lib/kit/color/categorical';
import { formatDate, formatRunTime } from '@/lib/kit/format/date';
import {
  API_ENDPOINT_LABELS,
  API_REQUEST_STATUS_LABELS,
  API_SERVICE_LABELS,
  formatTextValue,
} from '@/lib/kit/format/enum-labels';
import { formatCount } from '@/lib/kit/format/number';
import { useListState } from '@/lib/kit/lists/use-list-state';
import { orpc } from '@/lib/orpc/orpc';
import {
  JOB_QUEUES,
  JOB_TOTALS_DAYS,
  type JobDailyTotals,
  type JobQueueSchema,
} from '@/lib/orpc/schema/jobs';
import type { z } from 'zod';

import {
  DailyTotalsFrame,
  DailyTotalsSkeleton,
  PANELS,
} from './DailyTotalsFrame';
import {
  DAILY_TOTALS_PARAMS,
  DAYS_OPTIONS,
  QUEUE_TOTAL_COLUMNS as QUEUE_COLUMN,
  REQUEST_TOTAL_COLUMNS as REQUEST_COLUMN,
} from './params';

const CHART_CLASS = 'aspect-auto h-60 w-full';

const OUTCOMES = [
  { key: 'succeeded', label: 'Succeeded' },
  { key: 'retried', label: 'Retried' },
  { key: 'failed', label: 'Failed' },
  { key: 'discarded', label: 'Discarded' },
] as const;

const ALL_QUEUES = 'all';

const dayTime = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Day ticks on calendar boundaries, as days the chart has. */
function useDayAxis(from: string, to: string) {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const time = getTimeTicks(dayTime(from), dayTime(to), maxTicks);

  return {
    ticks: time.ticks.map((tick) => new Date(tick).toISOString().slice(0, 10)),
    tickFormatter: (day: string) => formatTimeTick(dayTime(day), time.unit),
  };
}

const serviceSuffix = (service: string) =>
  service === 'osu' ? '' : ` (${formatTextValue(service, API_SERVICE_LABELS)})`;

const endpointLabel = (service: string, endpoint: string) =>
  `${formatTextValue(endpoint, API_ENDPOINT_LABELS)}${serviceSuffix(service)}`;

const sumValues = (
  payload: readonly { value?: unknown }[] | undefined
): number =>
  (payload ?? []).reduce(
    (sum, item) => sum + (typeof item.value === 'number' ? item.value : 0),
    0
  );

/**
 * Daily totals of background jobs and of the osu! and osu!track requests
 * they made, for the last 30, 90 or 365 days. The range and the jobs
 * chart's queue live in the address.
 */
export default function DailyTotalsClient() {
  // The page renders nothing on the server, so the address changes in place.
  const { state, setState } = useListState(DAILY_TOTALS_PARAMS, {
    shallow: true,
  });
  const input = { days: state.days, queue: state.queue };

  const { data, error, isValidating, mutate } = useSWR(
    ['admin-job-totals', input],
    () => orpc.admin.jobs.daily(input),
    { keepPreviousData: true, shouldRetryOnError: false }
  );

  return (
    <DailyTotalsFrame
      data-testid="admin-job-totals"
      actions={
        <ScopeSwitch
          label="Days to show"
          value={String(state.days) as (typeof DAYS_OPTIONS)[number]['value']}
          onValueChange={(days) =>
            setState({
              days: JOB_TOTALS_DAYS.find((option) => String(option) === days),
            })
          }
          options={DAYS_OPTIONS}
        />
      }
    >
      {!data && error ? (
        <Panel>
          <SectionError
            title="Daily totals could not load"
            retrying={isValidating}
            onRetry={() => void mutate()}
          />
        </Panel>
      ) : !data ? (
        <DailyTotalsSkeleton />
      ) : (
        <>
          <JobAttemptsPanel
            totals={data}
            queue={state.queue}
            onQueueChange={(queue) => setState({ queue })}
          />
          <QueueTotalsPanel totals={data} />
          <RequestsPanel totals={data} />
          <EndpointTotalsPanel totals={data} />
        </>
      )}
    </DailyTotalsFrame>
  );
}

type Queue = z.infer<typeof JobQueueSchema>;

function JobAttemptsPanel({
  totals,
  queue,
  onQueueChange,
}: {
  totals: JobDailyTotals;
  queue: Queue | undefined;
  onQueueChange: (queue: Queue | undefined) => void;
}) {
  const rows = toJobDayRows(totals);
  const axis = useDayAxis(totals.from, totals.to);
  const attempts = totals.jobsByDay.reduce(
    (sum, row) => sum + attemptsOf(row),
    0
  );
  const peak = Math.max(
    0,
    ...rows.map((row) => OUTCOMES.reduce((sum, { key }) => sum + row[key], 0))
  );
  const labels = Object.fromEntries(
    OUTCOMES.map(({ key, label }) => [key, label])
  );

  return (
    <Panel data-testid="admin-job-totals-jobs">
      <SectionHeader
        icon={PANELS.jobs.icon}
        title={PANELS.jobs.title}
        meta={`${formatCount(attempts)} attempts`}
        actions={
          <Select
            value={queue ?? ALL_QUEUES}
            onValueChange={(next) =>
              onQueueChange(
                next === ALL_QUEUES
                  ? undefined
                  : JOB_QUEUES.find((option) => option === next)
              )
            }
          >
            <SelectTrigger
              aria-label="Queue"
              className="h-8 w-44 bg-background dark:bg-input/50 dark:shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_QUEUES}>All queues</SelectItem>
              {JOB_QUEUES.map((option) => (
                <SelectItem key={option} value={option}>
                  {getJobQueueLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {attempts === 0 ? (
        <EmptyState
          size="compact"
          icon={PANELS.jobs.icon}
          title="No jobs ran in this range"
        />
      ) : (
        <PanelBody className="flex flex-col gap-3">
          <ChartLegend
            items={OUTCOMES.map(({ key, label }, index) => ({
              key,
              label,
              color: seriesColor(index),
            }))}
          />
          <ChartContainer config={{}} className={CHART_CLASS}>
            <BarChart data={rows} margin={CHART_MARGIN}>
              <CartesianGrid {...chartGridProps} />
              <XAxis
                {...chartAxisProps}
                dataKey="day"
                ticks={axis.ticks}
                interval={0}
                tickFormatter={axis.tickFormatter}
              />
              <YAxis
                {...chartValueAxisProps}
                {...niceAxisProps(getNiceTicks(0, peak, { integer: true }))}
                tickFormatter={formatCountTick}
              />
              <ChartTooltip
                cursor={CHART_CURSOR.bar}
                content={
                  <ChartTooltipContent
                    reverse
                    labelFormatter={(label) => formatDate(String(label))}
                    nameFormatter={(name) => labels[name] ?? name}
                    valueFormatter={formatCountTick}
                    footer={(payload) => {
                      const row = payload[0]?.payload as
                        { averageRunTimeMs: number | null } | undefined;
                      return row?.averageRunTimeMs == null
                        ? `Total ${formatCountTick(sumValues(payload))}`
                        : `Total ${formatCountTick(sumValues(payload))} · average ${formatRunTime(row.averageRunTimeMs)}`;
                    }}
                  />
                }
              />
              {OUTCOMES.map(({ key }, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="outcomes"
                  fill={seriesColor(index)}
                  stroke="var(--card)"
                  strokeWidth={1}
                  radius={index === OUTCOMES.length - 1 ? CHART_BAR_RADIUS : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </PanelBody>
      )}
    </Panel>
  );
}

function QueueTotalsPanel({ totals }: { totals: JobDailyTotals }) {
  const rows = totals.jobsByQueue;

  return (
    <Panel data-testid="admin-job-totals-queues">
      <SectionHeader icon={PANELS.queues.icon} title={PANELS.queues.title} />
      {rows.length === 0 ? (
        <EmptyState
          size="compact"
          icon={PANELS.queues.icon}
          title="No jobs ran in this range"
        />
      ) : (
        <DataTable
          fixed
          aria-label={PANELS.queues.title}
          phoneRows={
            <PhoneRowList aria-label={PANELS.queues.title}>
              {rows.map((row) => (
                <PhoneRow
                  key={row.queue}
                  title={
                    <span className="truncate font-medium">
                      {getJobQueueLabel(row.queue)}
                    </span>
                  }
                  description={[
                    `${formatCount(row.retried)} retried`,
                    `${formatCount(row.failed)} failed`,
                    `average ${formatRunTime(averageRunTimeMs(row))}`,
                  ].join(' · ')}
                  value={formatCount(row.succeeded)}
                  valueDescription="succeeded"
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>{QUEUE_COLUMN.queue.label}</DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMN.enqueued.width}
                showFrom={QUEUE_COLUMN.enqueued.showFrom}
                numeric
                info="Jobs created, not counting requests merged into a waiting job"
              >
                {QUEUE_COLUMN.enqueued.label}
              </DataTableHead>
              <DataTableHead className={QUEUE_COLUMN.succeeded.width} numeric>
                {QUEUE_COLUMN.succeeded.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMN.retried.width}
                numeric
                info="Attempts that failed and were tried again"
              >
                {QUEUE_COLUMN.retried.label}
              </DataTableHead>
              <DataTableHead className={QUEUE_COLUMN.failed.width} numeric>
                {QUEUE_COLUMN.failed.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMN.cancelled.width}
                showFrom={QUEUE_COLUMN.cancelled.showFrom}
                numeric
              >
                {QUEUE_COLUMN.cancelled.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMN.average.width}
                showFrom={QUEUE_COLUMN.average.showFrom}
                numeric
                info="Run time of a finished attempt"
              >
                {QUEUE_COLUMN.average.label}
              </DataTableHead>
              <DataTableHead
                className={QUEUE_COLUMN.max.width}
                showFrom={QUEUE_COLUMN.max.showFrom}
                numeric
              >
                {QUEUE_COLUMN.max.label}
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {rows.map((row) => (
              <DataTableRow key={row.queue}>
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
                <DataTableCell
                  numeric
                  showFrom={QUEUE_COLUMN.enqueued.showFrom}
                >
                  {formatCount(row.enqueued)}
                </DataTableCell>
                <DataTableCell numeric>
                  {formatCount(row.succeeded)}
                </DataTableCell>
                <DataTableCell numeric>
                  {formatCount(row.retried)}
                </DataTableCell>
                <DataTableCell numeric>{formatCount(row.failed)}</DataTableCell>
                <DataTableCell
                  numeric
                  showFrom={QUEUE_COLUMN.cancelled.showFrom}
                >
                  {formatCount(row.cancelled)}
                </DataTableCell>
                <DataTableCell numeric showFrom={QUEUE_COLUMN.average.showFrom}>
                  {formatRunTime(averageRunTimeMs(row))}
                </DataTableCell>
                <DataTableCell numeric showFrom={QUEUE_COLUMN.max.showFrom}>
                  {attemptsOf(row) > 0
                    ? formatRunTime(row.maxDurationMs)
                    : null}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </Panel>
  );
}

function RequestsPanel({ totals }: { totals: JobDailyTotals }) {
  const endpoints = listEndpoints(totals);
  const rows = toRequestDayRows(totals, endpoints);
  const axis = useDayAxis(totals.from, totals.to);
  const total = totals.requestsByDay.reduce((sum, row) => sum + row.count, 0);
  const peak = Math.max(
    0,
    ...rows.map((row) =>
      endpoints.reduce((sum, { key }) => sum + Number(row[key] ?? 0), 0)
    )
  );
  const labels = Object.fromEntries(
    endpoints.map(({ key, service, endpoint }) => [
      key,
      endpointLabel(service, endpoint),
    ])
  );

  return (
    <Panel data-testid="admin-job-totals-requests">
      <SectionHeader
        icon={PANELS.requests.icon}
        title={PANELS.requests.title}
        meta={`${formatCount(total)} requests`}
      />
      {total === 0 ? (
        <EmptyState
          size="compact"
          icon={PANELS.requests.icon}
          title="No requests in this range"
        />
      ) : (
        <PanelBody className="flex flex-col gap-3">
          <ChartLegend
            items={endpoints.map(({ key }, index) => ({
              key,
              label: labels[key],
              color: seriesColor(index),
            }))}
          />
          <ChartContainer config={{}} className={CHART_CLASS}>
            <BarChart data={rows} margin={CHART_MARGIN}>
              <CartesianGrid {...chartGridProps} />
              <XAxis
                {...chartAxisProps}
                dataKey="day"
                ticks={axis.ticks}
                interval={0}
                tickFormatter={axis.tickFormatter}
              />
              <YAxis
                {...chartValueAxisProps}
                {...niceAxisProps(getNiceTicks(0, peak, { integer: true }))}
                tickFormatter={formatCountTick}
              />
              <ChartTooltip
                cursor={CHART_CURSOR.bar}
                content={
                  <ChartTooltipContent
                    reverse
                    labelFormatter={(label) => formatDate(String(label))}
                    nameFormatter={(name) => labels[name] ?? name}
                    valueFormatter={formatCountTick}
                    footer={(payload) =>
                      `Total ${formatCountTick(sumValues(payload))}`
                    }
                  />
                }
              />
              {endpoints.map(({ key }, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="endpoints"
                  fill={seriesColor(index)}
                  stroke="var(--card)"
                  strokeWidth={1}
                  radius={index === endpoints.length - 1 ? CHART_BAR_RADIUS : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </PanelBody>
      )}
    </Panel>
  );
}

function EndpointTotalsPanel({ totals }: { totals: JobDailyTotals }) {
  const rows = sortEndpointTotals(totals.requestsByEndpoint);
  const statusLabel = (status: string) =>
    formatTextValue(status, API_REQUEST_STATUS_LABELS);

  return (
    <Panel data-testid="admin-job-totals-endpoints">
      <SectionHeader
        icon={PANELS.endpoints.icon}
        title={PANELS.endpoints.title}
      />
      {rows.length === 0 ? (
        <EmptyState
          size="compact"
          icon={PANELS.endpoints.icon}
          title="No requests in this range"
        />
      ) : (
        <DataTable
          fixed
          aria-label={PANELS.endpoints.title}
          phoneRows={
            <PhoneRowList aria-label={PANELS.endpoints.title}>
              {rows.map((row) => (
                <PhoneRow
                  key={`${row.service}:${row.endpoint}:${row.status}`}
                  title={
                    <span className="truncate font-medium">
                      {endpointLabel(row.service, row.endpoint)}
                    </span>
                  }
                  description={`${statusLabel(row.status)} · average ${formatRunTime(
                    row.count > 0 ? row.totalDurationMs / row.count : null
                  )}`}
                  value={formatCount(row.count)}
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>{REQUEST_COLUMN.endpoint.label}</DataTableHead>
              <DataTableHead className={REQUEST_COLUMN.status.width}>
                {REQUEST_COLUMN.status.label}
              </DataTableHead>
              <DataTableHead className={REQUEST_COLUMN.count.width} numeric>
                {REQUEST_COLUMN.count.label}
              </DataTableHead>
              <DataTableHead
                className={REQUEST_COLUMN.average.width}
                showFrom={REQUEST_COLUMN.average.showFrom}
                numeric
              >
                {REQUEST_COLUMN.average.label}
              </DataTableHead>
              <DataTableHead
                className={REQUEST_COLUMN.max.width}
                showFrom={REQUEST_COLUMN.max.showFrom}
                numeric
              >
                {REQUEST_COLUMN.max.label}
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {rows.map((row) => (
              <DataTableRow
                key={`${row.service}:${row.endpoint}:${row.status}`}
              >
                <DataTableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {endpointLabel(row.service, row.endpoint)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatTextValue(row.service, API_SERVICE_LABELS)} ·{' '}
                      {row.endpoint}
                    </span>
                  </span>
                </DataTableCell>
                <DataTableCell>{statusLabel(row.status)}</DataTableCell>
                <DataTableCell numeric>{formatCount(row.count)}</DataTableCell>
                <DataTableCell
                  numeric
                  showFrom={REQUEST_COLUMN.average.showFrom}
                >
                  {formatRunTime(
                    row.count > 0 ? row.totalDurationMs / row.count : null
                  )}
                </DataTableCell>
                <DataTableCell numeric showFrom={REQUEST_COLUMN.max.showFrom}>
                  {formatRunTime(row.maxDurationMs)}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </Panel>
  );
}
