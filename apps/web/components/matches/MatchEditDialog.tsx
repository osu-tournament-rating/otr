'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  MatchRejectionReason,
  MatchWarningFlags,
  VerificationStatus,
} from '@otr/core/osu';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import type { z } from 'zod';

import {
  EDITED_FIELD_HINT,
  VERIFY_CHILDREN_DESCRIPTION,
  VERIFY_CHILDREN_TITLE,
  VerificationStatusSelectContent,
  VerifyChildrenChoices,
  changedFieldClass,
  combineFlags,
  flagOptions,
} from '@/components/admin-forms/adminFormFields';
import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { MultipleSelect } from '@/components/select/multiple-select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getEnumFlags } from '@/lib/enum-helpers';
import {
  MATCH_REJECTION_REASON_LABELS,
  MATCH_WARNING_FLAG_LABELS,
} from '@/lib/kit/format/enum-labels';
import { orpc } from '@/lib/orpc/orpc';
import type {
  VerificationChildrenChoice,
  VerificationStatusValue,
} from '@/lib/orpc/schema/constants';
import type { MatchDetail } from '@/lib/orpc/schema/match';
import { errorSaveToast, saveToast } from '@/lib/utils/toasts';
import { matchEditFormSchema } from '@/lib/validation-schema';

import { getMatchDisplayName } from './matchName';

type MatchEditValues = z.infer<typeof matchEditFormSchema>;

type EditableMatch = Pick<
  MatchDetail,
  | 'id'
  | 'name'
  | 'verificationStatus'
  | 'rejectionReason'
  | 'warningFlags'
  | 'startTime'
  | 'endTime'
  | 'editedFields'
>;

const rejectionReasonOptions = flagOptions(MATCH_REJECTION_REASON_LABELS);
const warningFlagOptions = flagOptions(MATCH_WARNING_FLAG_LABELS);

/**
 * The admin's edit dialog for a match, opened from the match hero's Admin
 * menu. Verifying the match asks, in the same dialog, what to do with its
 * games and scores.
 */
export default function MatchEditDialog({
  match,
  open,
  onOpenChange,
}: {
  match: EditableMatch;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pendingValues, setPendingValues] = useState<MatchEditValues | null>(
    null
  );
  const [savingChoice, setSavingChoice] =
    useState<VerificationChildrenChoice | null>(null);

  const form = useForm<MatchEditValues>({
    resolver: zodResolver(matchEditFormSchema) as Resolver<MatchEditValues>,
    defaultValues: {
      name: match.name,
      verificationStatus: match.verificationStatus ?? 0,
      rejectionReason: match.rejectionReason ?? 0,
      warningFlags: match.warningFlags ?? 0,
      startTime: match.startTime ? new Date(match.startTime) : undefined,
      endTime: match.endTime ? new Date(match.endTime) : undefined,
    },
    mode: 'all',
  });

  async function submit(
    values: MatchEditValues,
    children?: VerificationChildrenChoice
  ) {
    const toNullableIso = (value: Date | null | undefined) =>
      value instanceof Date ? value.toISOString() : null;

    try {
      await orpc.matches.admin.update({
        id: match.id,
        name: values.name,
        verificationStatus:
          values.verificationStatus as VerificationStatusValue,
        rejectionReason: values.rejectionReason,
        warningFlags: values.warningFlags,
        startTime: toNullableIso(
          values.startTime ??
            (match.startTime ? new Date(match.startTime) : null)
        ),
        endTime: toNullableIso(
          values.endTime ?? (match.endTime ? new Date(match.endTime) : null)
        ),
        children,
      });

      form.reset(values);
      saveToast();
      setPendingValues(null);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      errorSaveToast(error);
    }
  }

  async function onSubmit(values: MatchEditValues) {
    if (
      values.verificationStatus === VerificationStatus.Verified &&
      values.verificationStatus !== match.verificationStatus
    ) {
      setPendingValues(values);
      return;
    }

    await submit(values);
  }

  async function chooseChildren(choice: VerificationChildrenChoice) {
    if (!pendingValues) return;

    setSavingChoice(choice);
    try {
      await submit(pendingValues, choice);
    } finally {
      setSavingChoice(null);
    }
  }

  const choosing = pendingValues !== null;

  return (
    <Form {...form}>
      <DialogTemplate
        open={open}
        onOpenChange={(next) => {
          if (!next) setPendingValues(null);
          onOpenChange(next);
        }}
        title={choosing ? VERIFY_CHILDREN_TITLE : 'Edit match'}
        description={
          choosing
            ? VERIFY_CHILDREN_DESCRIPTION
            : `Editing ${getMatchDisplayName(match)}`
        }
        onSubmit={choosing ? undefined : form.handleSubmit(onSubmit)}
        footer={
          choosing ? (
            <Button
              variant="outline"
              onClick={() => setPendingValues(null)}
              disabled={savingChoice !== null}
            >
              Back
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => form.reset()}
                disabled={
                  !form.formState.isDirty || form.formState.isSubmitting
                }
              >
                Reset
              </Button>
              <Button
                type="submit"
                pending={form.formState.isSubmitting}
                disabled={!form.formState.isValid || !form.formState.isDirty}
              >
                Save changes
              </Button>
            </>
          )
        }
      >
        {choosing ? (
          <VerifyChildrenChoices
            onChoice={(choice) => void chooseChildren(choice)}
            pending={savingChoice}
          />
        ) : (
          <>
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormFieldLabel
                    hint={
                      match.editedFields?.includes('name')
                        ? EDITED_FIELD_HINT
                        : undefined
                    }
                  >
                    Name
                  </FormFieldLabel>
                  <FormControl>
                    <Input
                      className={changedFieldClass(fieldState)}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rejectionReason"
              render={({ field: { value, onChange }, fieldState }) => (
                <FormItem>
                  <FormLabel>Rejection reason</FormLabel>
                  <FormControl>
                    <MultipleSelect
                      className={changedFieldClass(fieldState)}
                      placeholder="No rejection reason"
                      selected={getEnumFlags(value, MatchRejectionReason).map(
                        String
                      )}
                      options={rejectionReasonOptions}
                      onChange={(values: string[]) =>
                        onChange(combineFlags(values))
                      }
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="warningFlags"
              render={({ field: { value, onChange }, fieldState }) => (
                <FormItem>
                  <FormLabel>Warning flags</FormLabel>
                  <FormControl>
                    <MultipleSelect
                      className={changedFieldClass(fieldState)}
                      placeholder="No warnings"
                      disabled
                      selected={getEnumFlags(value, MatchWarningFlags).map(
                        String
                      )}
                      options={warningFlagOptions}
                      onChange={(values: string[]) =>
                        onChange(combineFlags(values))
                      }
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="verificationStatus"
              render={({ field: { value, onChange }, fieldState }) => (
                <FormItem>
                  <FormLabel>Verification status</FormLabel>
                  <Select
                    onValueChange={(next) => onChange(Number(next))}
                    value={value.toString()}
                  >
                    <FormControl className="w-full">
                      <SelectTrigger className={changedFieldClass(fieldState)}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <VerificationStatusSelectContent />
                  </Select>
                </FormItem>
              )}
            />
          </>
        )}
      </DialogTemplate>
    </Form>
  );
}
