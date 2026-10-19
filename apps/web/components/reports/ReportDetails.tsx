import type * as React from 'react';

import { Timestamp } from '@/components/kit/format/Timestamp';
import { Eyebrow } from '@/components/kit/layout/Typography';
import { ReportStatusBadge } from '@/components/kit/status/ReportStatusBadge';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { cn } from '@/lib/utils';

import {
  formatReportEntityRef,
  getLegacySuggestedChanges,
  getReportEntityHref,
  getSuggestedChangeLabel,
  type ReportSummary,
} from './report-presentation';

const LONG_TEXT = 'wrap-anywhere whitespace-pre-wrap';

/**
 * One label and its value in a report's details. Labels sit beside their
 * values from `sm` and above them on phones, where the dialog is narrow.
 */
export function ReportDetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-baseline sm:gap-x-4">
      <dt>
        <Eyebrow>{label}</Eyebrow>
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/**
 * A report as My reports and the admin queue show it in their "Report
 * details" dialog: its state, reason, entity, times and the reporter's
 * words. Each page adds its own rows through `reporter` and `reviewer`.
 */
export function ReportDetails({
  report,
  reporter,
  reviewer,
  showComment = true,
  className,
}: {
  report: ReportSummary;
  /** Who filed it; the admin queue only. */
  reporter?: React.ReactNode;
  /** Who closed it, after the review time; the admin queue only. */
  reviewer?: React.ReactNode;
  /** Shows the admin's comment once the report is closed. */
  showComment?: boolean;
  className?: string;
}) {
  const entityHref = getReportEntityHref(report);
  const legacyChanges = Object.entries(getLegacySuggestedChanges(report));

  return (
    <dl
      className={cn(
        'grid gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4',
        className
      )}
      data-testid="report-details"
    >
      <ReportDetailRow label="Status">
        <ReportStatusBadge status={report.status} size="sm" />
      </ReportDetailRow>
      <ReportDetailRow label="Reason">
        <span className="font-medium">{report.reason.label}</span>
      </ReportDetailRow>
      <ReportDetailRow label="Entity">
        <span className="flex min-w-0 flex-col">
          {entityHref ? (
            <EntityLink href={entityHref} wrap className="self-start">
              {report.entityDisplayName}
            </EntityLink>
          ) : (
            <span className="font-medium wrap-anywhere">
              {report.entityDisplayName}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatReportEntityRef(report)}
          </span>
        </span>
      </ReportDetailRow>
      {reporter ? (
        <ReportDetailRow label="Reporter">{reporter}</ReportDetailRow>
      ) : null}
      <ReportDetailRow label="Submitted">
        <Timestamp date={report.created} />
      </ReportDetailRow>
      {report.resolvedAt ? (
        <ReportDetailRow label="Reviewed">
          <Timestamp date={report.resolvedAt} />
          {reviewer ? <> by {reviewer}</> : null}
        </ReportDetailRow>
      ) : null}
      <ReportDetailRow label="Additional information">
        {report.additionalInformation ? (
          <span className={LONG_TEXT}>{report.additionalInformation}</span>
        ) : (
          <span className="text-muted-foreground">
            No additional information was provided.
          </span>
        )}
      </ReportDetailRow>
      {legacyChanges.length > 0 ? (
        <ReportDetailRow label="Original report details">
          <ul className="flex flex-col gap-1">
            {legacyChanges.map(([field, value]) => (
              <li key={field} className={LONG_TEXT}>
                <span className="font-medium">
                  {getSuggestedChangeLabel(field)}:
                </span>{' '}
                {value ? value : <MissingValue />}
              </li>
            ))}
          </ul>
        </ReportDetailRow>
      ) : null}
      {showComment && report.adminNote ? (
        <ReportDetailRow label="Comment">
          <span className={LONG_TEXT}>{report.adminNote}</span>
        </ReportDetailRow>
      ) : null}
    </dl>
  );
}
