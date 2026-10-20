'use client';

import { ListChecks } from 'lucide-react';

import SectionError from '@/components/error/SectionError';
import { DateText } from '@/components/kit/format/DateText';
import { Panel } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ApprovalStatusBadge } from '@/components/kit/status/ApprovalStatusBadge';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { formatCountOf, formatId } from '@/lib/kit/format/number';
import type { FilterRequest } from '@/lib/orpc/schema/filtering';

import { formatUnknownShare } from './unknownShare';

export const MY_FILTER_REQUESTS_KEY = 'my-filter-requests';

/** A held request's report once approval made one, linked. */
function RequestReport({ request }: { request: FilterRequest }) {
  return request.filterReportId ? (
    <EntityLink href={`/tools/filter-reports?report=${request.filterReportId}`}>
      Report #{formatId(request.filterReportId)}
    </EntityLink>
  ) : null;
}

/**
 * The signed-in user's filter requests held for an admin, newest first,
 * under the filter: each one's state, and its report once approved. It
 * renders nothing until the user has one.
 */
export default function MyFilterRequests({
  requests,
  error,
  retrying,
  onRetry,
}: {
  requests: FilterRequest[] | undefined;
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (!requests && error) {
    return (
      <Panel>
        <SectionHeader icon={ListChecks} title="Your filter requests" />
        <SectionError
          title="Your filter requests could not load"
          retrying={retrying}
          onRetry={onRetry}
        />
      </Panel>
    );
  }

  if (!requests || requests.length === 0) {
    return null;
  }

  return (
    <Panel data-testid="my-filter-requests">
      <SectionHeader
        icon={ListChecks}
        title="Your filter requests"
        meta={formatCountOf(requests.length, 'request')}
      />
      <DataTable
        fixed
        aria-label="Your filter requests"
        phoneRows={
          <PhoneRowList aria-label="Your filter requests">
            {requests.map((request) => (
              <PhoneRow
                key={request.id}
                title={`Request #${formatId(request.id)}`}
                description={
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ApprovalStatusBadge status={request.status} size="sm" />
                    <DateText date={request.created} />
                  </span>
                }
                value={<RequestReport request={request} />}
              />
            ))}
          </PhoneRowList>
        }
      >
        <DataTableHeader>
          <DataTableRow>
            <DataTableHead className="w-28">Request</DataTableHead>
            <DataTableHead className="w-32">Status</DataTableHead>
            <DataTableHead numeric>Not in o!TR</DataTableHead>
            <DataTableHead className="w-32">Submitted</DataTableHead>
            <DataTableHead className="w-32">Report</DataTableHead>
          </DataTableRow>
        </DataTableHeader>
        <DataTableBody>
          {requests.map((request) => (
            <DataTableRow key={request.id}>
              <DataTableCell className="tabular-nums">
                #{formatId(request.id)}
              </DataTableCell>
              <DataTableCell>
                <ApprovalStatusBadge status={request.status} size="sm" />
              </DataTableCell>
              <DataTableCell numeric>
                {formatUnknownShare(
                  request.unknownPlayerCount,
                  request.playerCount
                )}
              </DataTableCell>
              <DataTableCell muted>
                <DateText date={request.created} />
              </DataTableCell>
              <DataTableCell>
                {request.filterReportId ? (
                  <RequestReport request={request} />
                ) : null}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </Panel>
  );
}
