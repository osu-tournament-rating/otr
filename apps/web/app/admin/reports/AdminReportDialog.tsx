'use client';

import { ReportStatus } from '@otr/core/osu';
import { Check, RotateCcw, X } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { ReportDetails } from '@/components/reports/ReportDetails';
import { getReportEntityTypeName } from '@/components/reports/report-presentation';
import { Textarea } from '@/components/ui/textarea';
import { notifyReportChange } from '@/lib/hooks/useReportCount';
import { formatId } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type { Report } from '@/lib/orpc/schema/report';

/** The longest comment `reports.resolve` accepts. */
const MAX_COMMENT_LENGTH = 500;

type ReportUser = NonNullable<Report['reporter']>;

/** A reporter or reviewer: their profile link, or "Deleted user". */
export function ReportUserName({
  user,
  wrap = false,
}: {
  user: ReportUser | null;
  /** Wraps a long name instead of truncating it, as in the dialog. */
  wrap?: boolean;
}) {
  if (!user) {
    return <span className="text-muted-foreground">Deleted user</span>;
  }

  return (
    // Baseline-aligned, so "by Name" after a timestamp sits on one line.
    <EntityLink
      href={`/players/${user.player.id}`}
      wrap={wrap}
      className="align-baseline"
    >
      {user.player.username || `User #${formatId(user.id)}`}
    </EntityLink>
  );
}

type PendingAction = 'confirm' | 'dismiss' | 'reopen';

/**
 * One report in the admin queue, opened from its row's View button: the
 * report's details, then a required comment with Dismiss and Confirm report
 * while it is open, or Reopen once it is closed. The page keeps one of
 * these and the report in state, so the dialog keeps its content while it
 * fades out.
 */
export function AdminReportDialog({
  report,
  open,
  onOpenChange,
  onReportChange,
}: {
  report: Report | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the report as it now stands after a resolve or reopen. */
  onReportChange: (report: Report) => void;
}) {
  const commentId = useId();
  const commentHintId = useId();
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Each opening starts from the report's saved comment, as the queue did before.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setComment(report?.adminNote ?? '');
  }

  const isOpenReport = report?.status === ReportStatus.Pending;
  const trimmedComment = comment.trim();

  const resolve = async (
    status: ReportStatus.Approved | ReportStatus.Rejected
  ) => {
    if (!report || !trimmedComment) return;

    setPending(status === ReportStatus.Approved ? 'confirm' : 'dismiss');
    try {
      await orpc.reports.resolve({
        reportId: report.id,
        status,
        adminNote: trimmedComment,
      });
      notifyReportChange();
      onReportChange({ ...report, status, adminNote: trimmedComment });
      toast.success(
        `Report ${status === ReportStatus.Approved ? 'confirmed' : 'dismissed'}`
      );
      onOpenChange(false);
    } catch (error) {
      console.error('[admin-reports] failed to resolve report', error);
      toast.error('Failed to resolve report');
    } finally {
      setPending(null);
    }
  };

  const reopen = async () => {
    if (!report) return;

    setPending('reopen');
    try {
      await orpc.reports.reopen({ reportId: report.id });
      notifyReportChange();
      onReportChange({
        ...report,
        status: ReportStatus.Pending,
        resolvedAt: null,
        resolvedBy: null,
      });
      toast.success('Report reopened');
    } catch (error) {
      console.error('[admin-reports] failed to reopen report', error);
      toast.error('Failed to reopen report');
    } finally {
      setPending(null);
    }
  };

  const busy = pending !== null;

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title="Report details"
      description={
        report
          ? `Report #${formatId(report.id)} · ${getReportEntityTypeName(report.entityType)} · ${report.entityDisplayName}`
          : undefined
      }
      data-testid="admin-report-detail"
      footer={
        report ? (
          isOpenReport ? (
            <>
              <Button
                variant="outline"
                icon={X}
                pending={pending === 'dismiss'}
                disabled={busy || !trimmedComment}
                onClick={() => void resolve(ReportStatus.Rejected)}
              >
                Dismiss
              </Button>
              <Button
                icon={Check}
                pending={pending === 'confirm'}
                disabled={busy || !trimmedComment}
                onClick={() => void resolve(ReportStatus.Approved)}
              >
                Confirm report
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              icon={RotateCcw}
              pending={pending === 'reopen'}
              disabled={busy}
              onClick={() => void reopen()}
            >
              Reopen
            </Button>
          )
        ) : null
      }
    >
      {report ? (
        <>
          <ReportDetails
            report={report}
            reporter={<ReportUserName user={report.reporter} wrap />}
            reviewer={
              report.resolvedBy ? (
                <ReportUserName user={report.resolvedBy} wrap />
              ) : undefined
            }
            // A reopened report keeps its old comment; the field below
            // already holds it, so it is not listed twice.
            showComment={!isOpenReport}
          />
          {isOpenReport ? (
            <div className="flex flex-col gap-2 border-t pt-4">
              {/* Confirm report and Dismiss stay disabled until it has text. */}
              <FormFieldLabel
                htmlFor={commentId}
                hint="Required"
                hintId={commentHintId}
              >
                Comment
              </FormFieldLabel>
              <Textarea
                id={commentId}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Enter a comment"
                className="field-sizing-fixed"
                rows={3}
                maxLength={MAX_COMMENT_LENGTH}
                required
                aria-describedby={commentHintId}
                disabled={busy}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </DialogTemplate>
  );
}
