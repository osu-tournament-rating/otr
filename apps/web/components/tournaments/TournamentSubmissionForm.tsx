'use client';

import { TournamentRejectionReason } from '@otr/core/osu';
import { Database, Trophy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useSWRConfig } from 'swr';

import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { Callout } from '@/components/kit/feedback/Callout';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import {
  FormActions,
  FormGrid,
  FormPanel,
  FormSection,
} from '@/components/kit/controls/FormPanel';
import MyTournamentSubmissions, {
  MY_SUBMISSIONS_KEY,
} from '@/components/tournaments/MyTournamentSubmissions';
import {
  LobbySizeSelectContent,
  RejectionReasonChips,
  RulesetSelectContent,
} from '@/components/tournaments/TournamentFieldOptions';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hasAdminScope } from '@/lib/auth/roles';
import { useFormDraft } from '@/lib/hooks/useFormDraft';
import { useSession } from '@/lib/hooks/useSession';
import { orpc } from '@/lib/orpc/orpc';
import {
  tournamentSubmissionFormSchema,
  type TournamentSubmissionFormValues,
} from '@/lib/orpc/schema/tournamentSubmission';

const DEFAULT_VALUES: Partial<TournamentSubmissionFormValues> = {
  name: '',
  abbreviation: '',
  forumUrl: '',
  ruleset: undefined,
  rankRangeLowerBound: undefined,
  lobbySize: undefined,
  rejectionReason: TournamentRejectionReason.None,
  isLazer: false,
  ids: [],
  beatmapIds: [],
};

const STABLE_MATCH_PLACEHOLDER =
  'https://osu.ppy.sh/community/matches/12345\nhttps://osu.ppy.sh/mp/67890';
const LAZER_MATCH_PLACEHOLDER =
  'https://osu.ppy.sh/multiplayer/rooms/1537300\nhttps://osu.ppy.sh/multiplayer/rooms/2048512';
const BEATMAP_PLACEHOLDER =
  'https://osu.ppy.sh/b/12345\nhttps://osu.ppy.sh/beatmapsets/123#osu/456';

/** One link per line, as the textarea holds them. */
const toLines = (value: unknown) =>
  Array.isArray(value) ? value.map(String).join('\n') : '';

export default function TournamentSubmissionForm() {
  const session = useSession();
  const router = useRouter();
  const isAdmin = hasAdminScope(session?.scopes ?? []);
  const { mutate } = useSWRConfig();
  const rejectId = useId();
  const reasonLabelId = useId();

  const form = useForm<TournamentSubmissionFormValues>({
    defaultValues: DEFAULT_VALUES,
  });
  useFormDraft(form, 'tournament-submission', DEFAULT_VALUES);
  const isLazer = form.watch('isLazer');

  const [rejectOnSubmit, setRejectOnSubmit] = useState(false);
  const [showBeatmapWarning, setShowBeatmapWarning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const performSubmit = async ({
    allowNoBeatmaps = false,
  }: { allowNoBeatmaps?: boolean } = {}) => {
    form.clearErrors();

    const formValues = form.getValues();
    const validationResult =
      tournamentSubmissionFormSchema.safeParse(formValues);

    if (!validationResult.success) {
      // One message per field: the first, which is the most basic rule.
      const reported = new Set<string>();
      for (const issue of validationResult.error.issues) {
        const fieldName = issue.path[0];
        if (
          typeof fieldName === 'string' &&
          fieldName in formValues &&
          !reported.has(fieldName)
        ) {
          reported.add(fieldName);
          form.setError(fieldName as keyof TournamentSubmissionFormValues, {
            type: 'validation',
            message: issue.message,
          });
        }
      }
      return;
    }

    const validatedData = validationResult.data;

    if (
      rejectOnSubmit &&
      validatedData.rejectionReason === TournamentRejectionReason.None
    ) {
      form.setError('rejectionReason', {
        message: 'Rejection reason must be selected when rejecting on submit',
      });
      return;
    }

    if (validatedData.beatmapIds.length === 0 && !allowNoBeatmaps) {
      setShowBeatmapWarning(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await orpc.tournaments.submit({
        ...validatedData,
        // The reasons only apply when the admin chose to reject on submit.
        rejectionReason: rejectOnSubmit
          ? validatedData.rejectionReason
          : TournamentRejectionReason.None,
      });

      form.reset(DEFAULT_VALUES);
      setRejectOnSubmit(false);

      if (result.status === 'pending') {
        toast.success('Tournament submitted for approval');
        void mutate(MY_SUBMISSIONS_KEY);
        return;
      }

      toast.success('Tournament submitted successfully');
      // Its page shows the matches and beatmaps being fetched.
      router.push(`/tournaments/${result.id}`);
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const clear = () => {
    form.reset(DEFAULT_VALUES);
    setRejectOnSubmit(false);
  };

  return (
    <Form {...form}>
      {session && !isAdmin ? (
        <Callout
          title="Admin approval"
          data-testid="submission-approval-notice"
        >
          An admin approves each submission before o!TR fetches its matches.
          Until then, only you and admins can see it.
        </Callout>
      ) : null}
      <FormPanel
        data-testid="tournament-submission-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void performSubmit();
        }}
      >
        <FormSection icon={Trophy} title="Information">
          <FormGrid>
            <FormField
              control={form.control}
              name="abbreviation"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel info="Lobby prefix such as OWC2024">
                    Abbreviation
                  </FormFieldLabel>
                  <FormControl>
                    <Input placeholder="OWC2024" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel>Name</FormFieldLabel>
                  <FormControl>
                    <Input placeholder="osu! World Cup 2024" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGrid>

          <FormField
            control={form.control}
            name="forumUrl"
            render={({ field }) => (
              <FormItem>
                <FormFieldLabel info="Also accepts osu! wiki pages">
                  Forum post URL
                </FormFieldLabel>
                <FormControl>
                  <Input
                    placeholder="https://osu.ppy.sh/community/forums/topics/…"
                    {...field}
                    onChange={(event) =>
                      field.onChange(event.target.value.split('?')[0])
                    }
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
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel>Ruleset</FormFieldLabel>
                  <Select
                    onValueChange={(value) => field.onChange(Number(value))}
                    value={field.value?.toString() ?? ''}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select ruleset" />
                      </SelectTrigger>
                    </FormControl>
                    <RulesetSelectContent includeManiaOther={isAdmin} />
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lobbySize"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel>Lobby size</FormFieldLabel>
                  <Select
                    onValueChange={(value) => field.onChange(Number(value))}
                    value={field.value?.toString() ?? ''}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select size" />
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
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel info="Best global rank allowed, 1 if open">
                    Rank restriction
                  </FormFieldLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      placeholder="Enter rank restriction"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value === ''
                            ? undefined
                            : event.target.valueAsNumber
                        )
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
            name="isLazer"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                </FormControl>
                <FormLabel>Played on osu!lazer</FormLabel>
              </FormItem>
            )}
          />

          {isAdmin && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={rejectId}
                  checked={rejectOnSubmit}
                  onCheckedChange={(checked) =>
                    setRejectOnSubmit(checked === true)
                  }
                />
                <Label htmlFor={rejectId}>
                  Reject this tournament on submission
                </Label>
              </div>
              {rejectOnSubmit && (
                <FormField
                  control={form.control}
                  name="rejectionReason"
                  render={({ field, fieldState }) => (
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
                          value={field.value ?? TournamentRejectionReason.None}
                          onValueChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          )}
        </FormSection>

        <FormSection icon={Database} title="Data">
          <FormGrid>
            <FormField
              control={form.control}
              name="ids"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel hint="IDs or URLs, one per line">
                    Matches
                  </FormFieldLabel>
                  <FormControl>
                    <Textarea
                      className="field-sizing-fixed min-h-32"
                      placeholder={
                        isLazer
                          ? LAZER_MATCH_PLACEHOLDER
                          : STABLE_MATCH_PLACEHOLDER
                      }
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={toLines(field.value)}
                      onChange={(event) =>
                        field.onChange(event.target.value.split('\n'))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="beatmapIds"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel hint="IDs or URLs, one per line">
                    Beatmaps
                  </FormFieldLabel>
                  <FormControl>
                    <Textarea
                      className="field-sizing-fixed min-h-32"
                      placeholder={BEATMAP_PLACEHOLDER}
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={toLines(field.value)}
                      onChange={(event) =>
                        field.onChange(event.target.value.split('\n'))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormGrid>
        </FormSection>

        <FormActions>
          <Button variant="outline" disabled={isSubmitting} onClick={clear}>
            Clear
          </Button>
          <Button
            type="submit"
            data-testid="tournament-submit-button"
            pending={isSubmitting}
          >
            {isSubmitting ? 'Submitting…' : 'Submit tournament'}
          </Button>
        </FormActions>
      </FormPanel>

      <ConfirmDialog
        open={showBeatmapWarning}
        onOpenChange={setShowBeatmapWarning}
        tone="default"
        title="Continue without beatmaps?"
        description={
          <p>
            You are submitting a tournament without any beatmap links. This is
            strongly discouraged.
          </p>
        }
        confirmLabel="Continue without beatmaps"
        pendingLabel="Submitting…"
        onConfirm={() => performSubmit({ allowNoBeatmaps: true })}
      />
      {session && !isAdmin ? <MyTournamentSubmissions /> : null}
    </Form>
  );
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') {
      const message = (cause as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }

    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }

  return 'Failed to submit tournament. Please try again.';
}
