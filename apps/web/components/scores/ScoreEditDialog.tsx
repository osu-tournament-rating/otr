'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AdminNoteRouteTarget, ScoreRejectionReason } from '@otr/core/osu';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';

import {
  ALL_RULESET_LABELS,
  LabelSelectContent,
  VerificationStatusSelectContent,
  changedFieldClass,
  combineFlags,
  flagOptions,
} from '@/components/admin-forms/adminFormFields';
import AdminNotesList from '@/components/admin-notes/AdminNoteList';
import { getAdminNoteMutations } from '@/components/admin-notes/adminNoteMutations';
import { modOptions, selectedMods } from '@/components/games/modOptions';
import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { MultipleSelect } from '@/components/select/multiple-select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getEnumFlags } from '@/lib/enum-helpers';
import {
  SCORE_GRADE_LABELS,
  SCORE_REJECTION_REASON_LABELS,
  TEAM_LABELS,
} from '@/lib/kit/format/enum-labels';
import { formatCount, formatId } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type { VerificationStatusValue } from '@/lib/orpc/schema/constants';
import type { GameScore } from '@/lib/orpc/schema/match';
import { errorSaveToast } from '@/lib/utils/toasts';
import { scoreEditFormSchema } from '@/lib/validation-schema';

type ScoreEditValues = z.infer<typeof scoreEditFormSchema>;

const rejectionReasonOptions = flagOptions(SCORE_REJECTION_REASON_LABELS);

/** Changing any of these asks the admin for a note explaining why. */
const SENSITIVE_FIELDS = [
  'scoreOverride',
  'accuracy',
  'maxCombo',
  'statGreat',
  'statOk',
  'statMeh',
  'statMiss',
  'statGood',
  'statPerfect',
  'grade',
  'mods',
] as const satisfies readonly (keyof ScoreEditValues & keyof GameScore)[];

/** A number input whose empty value is `null`, for optional counts. */
function nullableNumber(value: string): number | null {
  return value === '' ? null : Number(value);
}

const HIT_FIELDS = [
  ['statPerfect', 'Perfect'],
  ['statGreat', 'Great'],
  ['statGood', 'Good'],
  ['statOk', 'Ok'],
  ['statMeh', 'Meh'],
  ['statMiss', 'Miss'],
] as const;

/**
 * The admin's edit dialog for one score, opened from the score card's
 * actions menu. Changing the score's values asks for an admin note in the
 * same dialog before saving.
 */
export default function ScoreEditDialog({
  score,
  open,
  onOpenChange,
}: {
  score: GameScore;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pendingValues, setPendingValues] = useState<ScoreEditValues | null>(
    null
  );
  const [adminNote, setAdminNote] = useState('');
  const [savingWithNote, setSavingWithNote] = useState(false);
  const noteMutations = getAdminNoteMutations(AdminNoteRouteTarget.GameScore);
  const fallbackScore = score.adjustedScore ?? score.rawScore;

  const form = useForm<ScoreEditValues>({
    resolver: zodResolver(scoreEditFormSchema) as Resolver<ScoreEditValues>,
    defaultValues: score,
    mode: 'all',
  });

  async function save(values: ScoreEditValues) {
    try {
      await orpc.scores.admin.update({
        id: score.id,
        scoreOverride: values.scoreOverride,
        placement: values.placement,
        maxCombo: values.maxCombo,
        accuracy: values.accuracy,
        statGreat: values.statGreat,
        statOk: values.statOk,
        statMeh: values.statMeh,
        statMiss: values.statMiss,
        statGood: values.statGood,
        statPerfect: values.statPerfect,
        grade: values.grade,
        mods: values.mods,
        ruleset: values.ruleset,
        verificationStatus:
          values.verificationStatus as VerificationStatusValue,
        rejectionReason: values.rejectionReason,
        team: values.team,
      });

      const noteContent = adminNote.trim();
      let adminNoteCreated = false;

      if (noteContent) {
        if (!noteMutations) {
          toast.error(
            'Score updated, but admin note support is unavailable for this entity.'
          );
        } else {
          try {
            await noteMutations.create(score.id, noteContent);
            adminNoteCreated = true;
          } catch {
            toast.error('Score updated, but failed to create the admin note.');
          }
        }
      }

      toast.success(
        adminNoteCreated
          ? 'Saved score updates and admin note'
          : 'Saved score updates'
      );

      form.reset(values);
      setAdminNote('');
      setPendingValues(null);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      errorSaveToast(error);
    }
  }

  async function onSubmit(values: ScoreEditValues) {
    const sensitiveChanged = SENSITIVE_FIELDS.some(
      (field) => JSON.stringify(values[field]) !== JSON.stringify(score[field])
    );

    if (sensitiveChanged) {
      setPendingValues(values);
      return;
    }

    await save(values);
  }

  async function saveWithNote() {
    if (!pendingValues) return;

    setSavingWithNote(true);
    try {
      await save(pendingValues);
    } finally {
      setSavingWithNote(false);
    }
  }

  const askingForNote = pendingValues !== null;

  return (
    <Form {...form}>
      <DialogTemplate
        open={open}
        onOpenChange={(next) => {
          if (savingWithNote) return;
          if (!next) setPendingValues(null);
          onOpenChange(next);
        }}
        size="lg"
        title={askingForNote ? 'Admin note required' : 'Edit score'}
        description={
          askingForNote
            ? 'You are modifying sensitive values. Please provide a note explaining the reason for these changes.'
            : `Editing score ${formatId(score.id)}`
        }
        onSubmit={askingForNote ? undefined : form.handleSubmit(onSubmit)}
        footer={
          askingForNote ? (
            <>
              <Button
                variant="outline"
                onClick={() => setPendingValues(null)}
                disabled={savingWithNote}
              >
                Back
              </Button>
              <Button
                onClick={() => void saveWithNote()}
                pending={savingWithNote}
                disabled={!adminNote.trim()}
              >
                Confirm changes
              </Button>
            </>
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
        {askingForNote ? (
          <>
            <div className="flex flex-col gap-2">
              <FormFieldLabel htmlFor={`score-note-${score.id}`}>
                Admin note
              </FormFieldLabel>
              <Textarea
                id={`score-note-${score.id}`}
                value={adminNote}
                onChange={(event) => setAdminNote(event.target.value)}
                placeholder="Enter your reason for modifying this score…"
                className="min-h-16 resize-none"
              />
            </div>
            {score.adminNotes.length > 0 ? (
              <AdminNotesList
                entity={AdminNoteRouteTarget.GameScore}
                notes={score.adminNotes}
              />
            ) : null}
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="ruleset"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormLabel>Ruleset</FormLabel>
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
              <FormField
                control={form.control}
                name="team"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormLabel>Team</FormLabel>
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
                      <LabelSelectContent labels={TEAM_LABELS} />
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid items-start gap-4 sm:grid-cols-3">
              <FormItem>
                <FormLabel>Raw score</FormLabel>
                <FormControl>
                  {/* Read-only, so it reads as a count: 630,298. */}
                  <Input
                    disabled
                    className="tabular-nums"
                    value={formatCount(score.rawScore)}
                  />
                </FormControl>
                <FormDescription>The total osu! reported.</FormDescription>
              </FormItem>
              <FormItem>
                <FormLabel>Adjusted score</FormLabel>
                <FormControl>
                  <Input
                    disabled
                    className="tabular-nums"
                    value={
                      score.adjustedScore == null
                        ? ''
                        : formatCount(score.adjustedScore)
                    }
                    placeholder="None"
                  />
                </FormControl>
                <FormDescription>
                  The total after automatic adjustments made during ingestion,
                  such as mod multipliers.
                </FormDescription>
              </FormItem>
              <FormField
                control={form.control}
                name="scoreOverride"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Score override</FormLabel>
                    <FormControl>
                      <Input
                        className={changedFieldClass(fieldState)}
                        type="number"
                        min={0}
                        {...field}
                        value={field.value ?? ''}
                        onChange={(event) =>
                          field.onChange(nullableNumber(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {field.value == null
                        ? `Empty falls back to ${formatCount(fallbackScore)}.`
                        : 'Used in place of the adjusted score.'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxCombo"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Max combo</FormLabel>
                    <FormControl>
                      <Input
                        className={changedFieldClass(fieldState)}
                        type="number"
                        min={0}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accuracy"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Accuracy</FormLabel>
                    <FormControl>
                      <Input
                        className={changedFieldClass(fieldState)}
                        type="number"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="grade"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem>
                    <FormLabel>Grade</FormLabel>
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
                      <LabelSelectContent labels={SCORE_GRADE_LABELS} />
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 items-start gap-4">
              {HIT_FIELDS.map(([name, label]) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input
                          className={changedFieldClass(fieldState)}
                          type="number"
                          min={0}
                          {...field}
                          value={field.value ?? ''}
                          onChange={(event) =>
                            field.onChange(nullableNumber(event.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="rejectionReason"
                render={({ field: { value, onChange }, fieldState }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Rejection reason</FormLabel>
                    <FormControl>
                      <MultipleSelect
                        className={changedFieldClass(fieldState)}
                        placeholder="No rejection reason"
                        selected={getEnumFlags(value, ScoreRejectionReason).map(
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
                  <FormItem className="min-w-0">
                    <FormLabel>Mods</FormLabel>
                    <FormControl>
                      <MultipleSelect
                        className={changedFieldClass(fieldState)}
                        placeholder="No mods"
                        selected={selectedMods(value)}
                        options={modOptions}
                        onChange={(values: string[]) =>
                          onChange(combineFlags(values))
                        }
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

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
