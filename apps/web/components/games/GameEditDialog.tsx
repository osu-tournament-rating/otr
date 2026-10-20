'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  editedFieldGroups,
  type AdminEditField,
} from '@otr/core/db/admin-edits';
import {
  GameRejectionReason,
  GameWarningFlags,
  Mods,
  VerificationStatus,
} from '@otr/core/osu';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import type { z } from 'zod';

import {
  ALL_RULESET_LABELS,
  EDITED_FIELD_HINT,
  LabelSelectContent,
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getEnumFlags } from '@/lib/enum-helpers';
import {
  GAME_REJECTION_REASON_LABELS,
  GAME_WARNING_FLAG_LABELS,
  SCORING_TYPE_LABELS,
  TEAM_TYPE_LABELS,
} from '@/lib/kit/format/enum-labels';
import { formatId } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type {
  VerificationChildrenChoice,
  VerificationStatusValue,
} from '@/lib/orpc/schema/constants';
import type { Game } from '@/lib/orpc/schema/match';
import { errorSaveToast, saveToast } from '@/lib/utils/toasts';
import { gameEditFormSchema } from '@/lib/validation-schema';

import { modOptions } from './modOptions';

type GameEditValues = z.infer<typeof gameEditFormSchema>;

const rejectionReasonOptions = flagOptions(GAME_REJECTION_REASON_LABELS);
const warningFlagOptions = flagOptions(GAME_WARNING_FLAG_LABELS);

/**
 * The admin's edit dialog for one game, opened from the game card's actions
 * menu. Verifying the game asks, in the same dialog, what to do with its
 * scores.
 */
export default function GameEditDialog({
  game,
  open,
  onOpenChange,
}: {
  game: Game;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const edited = new Set(editedFieldGroups('games', game.editedFields ?? []));
  const editedHint = (field: AdminEditField<'games'>) =>
    edited.has(field) ? EDITED_FIELD_HINT : undefined;
  const [pendingValues, setPendingValues] = useState<GameEditValues | null>(
    null
  );
  const [savingChoice, setSavingChoice] =
    useState<VerificationChildrenChoice | null>(null);

  const form = useForm<GameEditValues>({
    resolver: zodResolver(gameEditFormSchema) as Resolver<GameEditValues>,
    defaultValues: {
      ruleset: game.ruleset,
      mods: game.mods,
      verificationStatus: game.verificationStatus,
      rejectionReason: game.rejectionReason,
      scoringType: game.scoringType,
      teamType: game.teamType,
      warningFlags: game.warningFlags,
      isFreeMod: game.isFreeMod,
      startTime: game.startTime ? new Date(game.startTime) : undefined,
      endTime: game.endTime ? new Date(game.endTime) : undefined,
    },
    mode: 'all',
  });

  async function submit(
    values: GameEditValues,
    children?: VerificationChildrenChoice
  ) {
    try {
      const startTimeIso = values.startTime
        ? values.startTime.toISOString()
        : (game.startTime ?? null);
      const endTimeIso = values.endTime
        ? values.endTime.toISOString()
        : (game.endTime ?? null);

      await orpc.games.admin.update({
        id: game.id,
        ruleset: values.ruleset,
        scoringType: values.scoringType,
        teamType: values.teamType,
        mods: values.mods,
        verificationStatus:
          values.verificationStatus as VerificationStatusValue,
        rejectionReason: values.rejectionReason,
        warningFlags: values.warningFlags,
        startTime: startTimeIso,
        endTime: endTimeIso,
        children,
      });

      form.reset({
        ...values,
        startTime:
          values.startTime ??
          (startTimeIso ? new Date(startTimeIso) : undefined),
        endTime:
          values.endTime ?? (endTimeIso ? new Date(endTimeIso) : undefined),
      });
      saveToast();
      setPendingValues(null);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      errorSaveToast(error);
    }
  }

  async function onSubmit(values: GameEditValues) {
    if (
      values.verificationStatus === VerificationStatus.Verified &&
      values.verificationStatus !== game.verificationStatus
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
        size="lg"
        title={choosing ? VERIFY_CHILDREN_TITLE : 'Edit game'}
        description={
          choosing
            ? VERIFY_CHILDREN_DESCRIPTION
            : `Editing game ${formatId(game.id)}`
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
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="scoringType"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormFieldLabel hint={editedHint('scoring_type')}>
                      Scoring type
                    </FormFieldLabel>
                    <Select
                      onValueChange={(next) => onChange(Number(next))}
                      value={value.toString()}
                    >
                      <FormControl className="w-full">
                        <SelectTrigger
                          className={changedFieldClass(fieldState)}
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <LabelSelectContent labels={SCORING_TYPE_LABELS} />
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="teamType"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormFieldLabel hint={editedHint('team_type')}>
                      Team type
                    </FormFieldLabel>
                    <Select
                      onValueChange={(next) => onChange(Number(next))}
                      value={value.toString()}
                    >
                      <FormControl className="w-full">
                        <SelectTrigger
                          className={changedFieldClass(fieldState)}
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <LabelSelectContent labels={TEAM_TYPE_LABELS} />
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ruleset"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormFieldLabel hint={editedHint('ruleset')}>
                      Ruleset
                    </FormFieldLabel>
                    <Select
                      onValueChange={(next) => onChange(Number(next))}
                      value={value.toString()}
                    >
                      <FormControl className="w-full">
                        <SelectTrigger
                          className={changedFieldClass(fieldState)}
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <LabelSelectContent labels={ALL_RULESET_LABELS} />
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="isFreeMod"
              render={({ field: { value, onChange }, fieldState }) => (
                <FormItem className="flex flex-row items-center gap-3 space-y-0">
                  <FormControl>
                    {/* Read from the scores; not stored or editable. */}
                    <Checkbox
                      disabled
                      className={changedFieldClass(fieldState)}
                      checked={value}
                      onCheckedChange={onChange}
                    />
                  </FormControl>
                  <FormLabel className="text-muted-foreground">
                    Free mod
                  </FormLabel>
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
                      selected={getEnumFlags(value, GameRejectionReason).map(
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
              name="mods"
              render={({ field: { value, onChange }, fieldState }) => (
                <FormItem>
                  <FormFieldLabel hint={editedHint('mods')}>
                    Mods
                  </FormFieldLabel>
                  <FormControl>
                    <MultipleSelect
                      className={changedFieldClass(fieldState)}
                      placeholder="No mods"
                      selected={getEnumFlags(value, Mods).map(String)}
                      options={modOptions}
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
                      selected={getEnumFlags(value, GameWarningFlags).map(
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
