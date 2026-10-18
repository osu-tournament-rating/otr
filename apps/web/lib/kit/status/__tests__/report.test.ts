import { describe, expect, it } from 'bun:test';

import { ReportStatus } from '@otr/core/osu';
import {
  REPORT_STATUS_ORDER,
  getReportStatusCopy,
  getReportStatusTooltip,
} from '../report';

describe('report status copy', () => {
  it('uses the names the report pages already show', () => {
    expect(REPORT_STATUS_ORDER.map((s) => getReportStatusCopy(s).name)).toEqual(
      ['Pending', 'Confirmed', 'Dismissed']
    );
  });

  it('keeps waiting neutral and colours the outcome', () => {
    expect(REPORT_STATUS_ORDER.map((s) => getReportStatusCopy(s).tone)).toEqual(
      ['neutral', 'success', 'destructive']
    );
  });

  it('writes each tooltip as "<name>: <plain-language line>"', () => {
    expect(REPORT_STATUS_ORDER.map(getReportStatusTooltip)).toEqual([
      'Pending: Awaiting admin review',
      'Confirmed: Accepted by an admin',
      'Dismissed: Reviewed by an admin, no changes made',
    ]);
  });

  it('falls back instead of throwing on an unknown value', () => {
    expect(getReportStatusCopy(42 as ReportStatus).name).toBe('Unknown status');
  });
});
