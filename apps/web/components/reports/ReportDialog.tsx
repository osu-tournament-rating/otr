'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ReportEntityType } from '@otr/core/osu';
import { useState } from 'react';
import type * as React from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import useSWR from 'swr';
import { z } from 'zod';

import SectionError from '@/components/error/SectionError';
import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/lib/hooks/useSession';
import { notifyReportChange } from '@/lib/hooks/useReportCount';
import { formatCount } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';

import { getReportEntityTypeName } from './report-presentation';

/** The longest note `reports.create` accepts. */
export const MAX_ADDITIONAL_INFORMATION_LENGTH = 2_000;

/** The field's own name, as the server's message names it. */
export const REASON_REQUIRED_MESSAGE = 'Reason is required';
export const ADDITIONAL_INFORMATION_TOO_LONG_MESSAGE = `Additional information cannot exceed ${formatCount(MAX_ADDITIONAL_INFORMATION_LENGTH)} characters`;

const reportFormSchema = z.object({
  reasonKey: z.string().min(1, REASON_REQUIRED_MESSAGE),
  additionalInformation: z
    .string()
    .max(
      MAX_ADDITIONAL_INFORMATION_LENGTH,
      ADDITIONAL_INFORMATION_TOO_LONG_MESSAGE
    ),
});

type ReportFormData = z.infer<typeof reportFormSchema>;

export interface ReportDialogProps {
  entityType: ReportEntityType;
  entityId: number;
  /** The entity's name as the dialog and the report list show it. */
  entityDisplayName: string;
  /** Controlled open state, for a dialog opened from a menu item. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The button that opens it. Leave it out when a menu item opens it. */
  trigger?: React.ReactElement;
}

/**
 * "Report a data issue": the form that files a report on a tournament,
 * match, game or score, with the server's report reasons for that kind of
 * entity. Signed-in visitors only; it renders nothing for everyone else.
 *
 * Self-contained with a `trigger` (ReportButton passes its flag button), or
 * controlled with `open` and `onOpenChange` from an AdminMenu or
 * RowActionsMenu item ("Report an issue").
 */
export function ReportDialog({
  entityType,
  entityId,
  entityDisplayName,
  open: openProp,
  onOpenChange,
  trigger,
}: ReportDialogProps) {
  const session = useSession();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;

  const form = useForm<ReportFormData>({
    resolver: zodResolver(reportFormSchema) as Resolver<ReportFormData>,
    defaultValues: { reasonKey: '', additionalInformation: '' },
  });

  const {
    data: templateData,
    error: templateError,
    isLoading: templatesLoading,
    isValidating: templatesValidating,
    mutate: reloadTemplates,
  } = useSWR(
    open && session ? ['report-templates', entityType] : null,
    () => orpc.reports.templates({ entityType }),
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  if (!session) {
    return null;
  }

  const entityTypeName = getReportEntityTypeName(entityType);
  const templates = templateData?.templates ?? [];
  const isLoadingTemplates =
    templates.length === 0 &&
    (templatesLoading || (templatesValidating && !templateData));
  const failedToLoadTemplates = Boolean(
    templateError && templates.length === 0 && !isLoadingTemplates
  );
  const hasNoTemplates = Boolean(
    templateData && templates.length === 0 && !templateError
  );
  const templatesUnavailable =
    isLoadingTemplates || failedToLoadTemplates || hasNoTemplates;
  const isSubmitting = form.formState.isSubmitting;

  const setOpen = (next: boolean) => {
    if (isSubmitting) return;
    // A closed dialog keeps what was typed, but not a stale "Reason is
    // required" from an earlier attempt.
    if (!next) form.clearErrors();
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  async function onSubmit(data: ReportFormData) {
    const additionalInformation = data.additionalInformation.trim();

    try {
      await orpc.reports.create({
        entityType,
        entityId,
        reasonKey: data.reasonKey,
        additionalInformation: additionalInformation || undefined,
      });
      notifyReportChange();

      form.reset();
      if (openProp === undefined) setUncontrolledOpen(false);
      onOpenChange?.(false);
      toast.success('Report submitted successfully');
    } catch {
      toast.error('Failed to submit report. Please try again.');
    }
  }

  return (
    <Form {...form}>
      <DialogTemplate
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
        title="Report a data issue"
        description={
          <>
            Report an issue with{' '}
            <span className="font-medium text-foreground">
              {entityDisplayName}
            </span>{' '}
            ({entityTypeName})
          </>
        }
        onSubmit={form.handleSubmit(onSubmit)}
        data-testid="report-dialog"
        data-entity-type={entityType}
        data-entity-id={entityId}
        footer={
          <>
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                form.reset();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              pending={isSubmitting}
              disabled={templatesUnavailable}
            >
              {isSubmitting ? 'Submitting…' : 'Submit report'}
            </Button>
          </>
        }
      >
        <FormField
          control={form.control}
          name="reasonKey"
          render={({ field }) => (
            <FormItem>
              <FormFieldLabel>Reason</FormFieldLabel>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={templatesUnavailable || isSubmitting}
              >
                <FormControl>
                  <SelectTrigger
                    aria-required="true"
                    className="w-full"
                    onBlur={field.onBlur}
                  >
                    <SelectValue
                      placeholder={
                        isLoadingTemplates
                          ? 'Loading reasons…'
                          : 'Select a reason'
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.key} value={template.key}>
                      {template.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {failedToLoadTemplates ? (
                <SectionError
                  size="inline"
                  title="Report reasons could not load"
                  retrying={templatesValidating}
                  onRetry={() => void reloadTemplates()}
                />
              ) : isLoadingTemplates || hasNoTemplates ? (
                <FormDescription
                  role={hasNoTemplates ? 'alert' : 'status'}
                  aria-live="polite"
                  className={hasNoTemplates ? 'text-destructive' : undefined}
                >
                  {isLoadingTemplates
                    ? 'Loading report reasons…'
                    : 'No report reasons are available.'}
                </FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="additionalInformation"
          render={({ field }) => (
            <FormItem>
              <FormFieldLabel hint="Optional">
                Additional information
              </FormFieldLabel>
              <FormControl>
                <Textarea
                  placeholder="Add corrections, supporting links, or other context"
                  className="min-h-28 resize-y"
                  maxLength={MAX_ADDITIONAL_INFORMATION_LENGTH}
                  disabled={isSubmitting}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </DialogTemplate>
    </Form>
  );
}
