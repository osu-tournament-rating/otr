'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { VerificationStatus } from '@otr/core/osu';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { FormGrid } from '@/components/kit/controls/FormPanel';
import {
  VERIFY_CHILDREN_DESCRIPTION,
  VERIFY_CHILDREN_TITLE,
  VerificationStatusSelectContent,
  VerifyChildrenChoices,
  changedFieldClass,
  editedValues,
} from '@/components/admin-forms/adminFormFields';
import {
  LobbySizeSelectContent,
  RejectionReasonChips,
  RulesetSelectContent,
} from '@/components/tournaments/TournamentFieldOptions';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { orpc } from '@/lib/orpc/orpc';
import type {
  VerificationChildrenChoice,
  VerificationStatusValue,
} from '@/lib/orpc/schema/constants';
import type { TournamentDetail } from '@/lib/orpc/schema/tournament';
import { errorSaveToast, saveToast } from '@/lib/utils/toasts';
import { tournamentEditFormSchema } from '@/lib/validation-schema';

type TournamentEditValues = z.infer<typeof tournamentEditFormSchema>;

export type EditableTournament = Pick<
  TournamentDetail,
  | 'id'
  | 'name'
  | 'abbreviation'
  | 'forumUrl'
  | 'rankRangeLowerBound'
  | 'lobbySize'
  | 'ruleset'
  | 'verificationStatus'
  | 'rejectionReason'
  | 'startTime'
  | 'endTime'
>;

const toFormValues = (
  tournament: EditableTournament
): TournamentEditValues => ({
  name: tournament.name,
  abbreviation: tournament.abbreviation,
  forumUrl: tournament.forumUrl,
  rankRangeLowerBound: tournament.rankRangeLowerBound,
  lobbySize: tournament.lobbySize,
  ruleset: tournament.ruleset,
  verificationStatus: tournament.verificationStatus,
  rejectionReason: tournament.rejectionReason,
  startTime: tournament.startTime ? new Date(tournament.startTime) : undefined,
  endTime: tournament.endTime ? new Date(tournament.endTime) : undefined,
});

/**
 * The admin's edit dialog for a tournament, opened from the hero's Admin
 * menu. Verifying the tournament asks, in the same dialog, what to do with
 * its matches, games and scores; closing with unsaved edits asks first.
 */
export default function TournamentEditDialog({
  tournament,
  open,
  onOpenChange,
}: {
  tournament: EditableTournament;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const reasonLabelId = useId();
  const defaults = useMemo(() => toFormValues(tournament), [tournament]);
  const [pendingValues, setPendingValues] =
    useState<TournamentEditValues | null>(null);
  const [savingChoice, setSavingChoice] =
    useState<VerificationChildrenChoice | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const form = useForm<TournamentEditValues>({
    resolver: zodResolver(
      tournamentEditFormSchema
    ) as Resolver<TournamentEditValues>,
    defaultValues: defaults,
    mode: 'all',
  });

  // A saved edit refreshes the page; start from the saved values.
  useEffect(() => {
    form.reset(defaults);
  }, [defaults, form]);

  const close = () => {
    setPendingValues(null);
    form.reset(defaults);
    onOpenChange(false);
  };

  async function submit(
    values: TournamentEditValues,
    children?: VerificationChildrenChoice
  ) {
    const edited = editedValues(values, defaults);

    try {
      await orpc.tournaments.admin.update({
        id: tournament.id,
        name: edited.name,
        abbreviation: edited.abbreviation,
        forumUrl: edited.forumUrl,
        rankRangeLowerBound: edited.rankRangeLowerBound,
        ruleset: edited.ruleset,
        lobbySize: edited.lobbySize,
        verificationStatus: edited.verificationStatus as
          VerificationStatusValue | undefined,
        rejectionReason: edited.rejectionReason,
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

  async function onSubmit(values: TournamentEditValues) {
    if (
      values.verificationStatus === VerificationStatus.Verified &&
      values.verificationStatus !== tournament.verificationStatus
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
  const { isDirty, isSubmitting, isValid } = form.formState;

  return (
    <>
      <Form {...form}>
        <DialogTemplate
          open={open}
          onOpenChange={(next) => {
            if (next) {
              onOpenChange(true);
            } else if (isSubmitting || savingChoice !== null) {
              // A save in flight finishes first.
            } else if (isDirty) {
              setConfirmingDiscard(true);
            } else {
              close();
            }
          }}
          size="lg"
          title={choosing ? VERIFY_CHILDREN_TITLE : 'Edit tournament'}
          description={
            choosing
              ? VERIFY_CHILDREN_DESCRIPTION
              : `Editing ${tournament.name}`
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
                  onClick={() => form.reset(defaults)}
                  disabled={!isDirty || isSubmitting}
                >
                  Reset
                </Button>
                <Button
                  type="submit"
                  pending={isSubmitting}
                  disabled={!isValid || !isDirty}
                >
                  {isSubmitting ? 'Saving…' : 'Save changes'}
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
              <FormGrid columns={3}>
                <FormField
                  control={form.control}
                  name="abbreviation"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormFieldLabel>Abbreviation</FormFieldLabel>
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
                  name="name"
                  render={({ field, fieldState }) => (
                    <FormItem className="sm:col-span-1 lg:col-span-2">
                      <FormFieldLabel>Name</FormFieldLabel>
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
              </FormGrid>

              <FormField
                control={form.control}
                name="forumUrl"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormFieldLabel>Forum post URL</FormFieldLabel>
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

              <FormGrid columns={3}>
                <FormField
                  control={form.control}
                  name="ruleset"
                  render={({ field: { onChange, value }, fieldState }) => (
                    <FormItem>
                      <FormFieldLabel>Ruleset</FormFieldLabel>
                      <Select
                        onValueChange={(next) => onChange(Number(next))}
                        value={value.toString()}
                      >
                        <FormControl>
                          <SelectTrigger
                            className={`w-full ${changedFieldClass(fieldState)}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <RulesetSelectContent includeManiaOther />
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lobbySize"
                  render={({ field: { onChange, value }, fieldState }) => (
                    <FormItem>
                      <FormFieldLabel>Lobby size</FormFieldLabel>
                      <Select
                        onValueChange={(next) => onChange(Number(next))}
                        value={value.toString()}
                      >
                        <FormControl>
                          <SelectTrigger
                            className={`w-full ${changedFieldClass(fieldState)}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <LobbySizeSelectContent />
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rankRangeLowerBound"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormFieldLabel>Rank restriction</FormFieldLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          className={changedFieldClass(fieldState)}
                          value={
                            Number.isNaN(field.value) ? '' : (field.value ?? '')
                          }
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </FormGrid>

              <FormField
                control={form.control}
                name="verificationStatus"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormFieldLabel>Verification status</FormFieldLabel>
                    <Select
                      onValueChange={(next) => onChange(Number(next))}
                      value={value.toString()}
                    >
                      <FormControl>
                        <SelectTrigger
                          className={`w-full sm:w-64 ${changedFieldClass(fieldState)}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <VerificationStatusSelectContent />
                    </Select>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rejectionReason"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormFieldLabel
                      groupId={reasonLabelId}
                      invalid={fieldState.error !== undefined}
                    >
                      Rejection reason
                    </FormFieldLabel>
                    <FormControl>
                      <RejectionReasonChips
                        aria-labelledby={reasonLabelId}
                        value={value}
                        onValueChange={onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </>
          )}
        </DialogTemplate>
      </Form>

      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title="Discard your changes?"
        description={
          <p>Your edits to {tournament.name} have not been saved.</p>
        }
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={close}
      />
    </>
  );
}
