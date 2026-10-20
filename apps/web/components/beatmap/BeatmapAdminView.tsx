'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Gauge, Music2, PencilLine, Shapes, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type * as React from 'react';
import { useId, useRef, useState } from 'react';
import { useForm, type Control } from 'react-hook-form';
import { z } from 'zod';

import { Ruleset } from '@otr/core/osu';
import { DataFetchStatus } from '@otr/core/db/data-fetch-status';

import PlayerPicker from '@/components/beatmap/PlayerPicker';
import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { FormGrid } from '@/components/kit/controls/FormPanel';
import { Callout } from '@/components/kit/feedback/Callout';
import { InfoButton } from '@/components/kit/layout/InfoButton';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { hasAdminScope } from '@/lib/auth/roles';
import { useSession } from '@/lib/hooks/useSession';
import { RULESET_NAMES } from '@/lib/kit/format/ruleset';
import { aboutLabel } from '@/lib/kit/layout/about-label';
import { orpc } from '@/lib/orpc/orpc';
import type { BeatmapWithDetails } from '@/lib/orpc/schema/beatmapStats';
import type { PlayerLookupResult } from '@/lib/orpc/schema/player';
import { formatDuration, parseDuration } from '@/lib/kit/format/date';
import { errorSaveToast, saveToast } from '@/lib/utils/toasts';

const required = (label: string) =>
  z.string().trim().min(1, `${label} is required`);

const decimal = (label: string, max: number) =>
  required(label).refine((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max;
  }, `${label} must be a number from 0 to ${max}`);

const count = (label: string) =>
  required(label).refine((value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0;
  }, `${label} must be a whole number, 0 or more`);

const duration = (label: string) =>
  required(label).refine((value) => {
    const seconds = parseDuration(value);
    return seconds !== null && seconds <= 86_400;
  }, `${label} must be written as mm:ss`);

export const formSchema = z.object({
  diffName: required('Difficulty'),
  ruleset: z.string(),
  sr: decimal('Star rating', 100),
  bpm: decimal('BPM', 10_000),
  totalLength: duration('Length'),
  drainLength: duration('Drain length'),
  cs: decimal('CS', 10),
  hp: decimal('HP', 10),
  od: decimal('OD', 10),
  ar: decimal('AR', 10),
  countCircle: count('Circles'),
  countSlider: count('Sliders'),
  countSpinner: count('Spinners'),
  maxCombo: z
    .string()
    .trim()
    .refine((value) => {
      if (value === '') return true;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 0;
    }, 'Max combo must be a whole number, 0 or more'),
  titleOverride: z.string().trim().max(512),
  artistOverride: z.string().trim().max(512),
});

type FormValues = z.input<typeof formSchema>;

type FooterMode = 'edit' | 'confirm';

/** Order-sensitive: any difference is a difference in the saved payload. */
export function sameOsuIds(
  a: readonly PlayerLookupResult[],
  b: readonly PlayerLookupResult[]
) {
  return (
    a.length === b.length &&
    a.every((player, index) => player.osuId === b[index].osuId)
  );
}

const toPlayer = (player: {
  id: number;
  osuId: number;
  username: string;
}): PlayerLookupResult => ({
  osuId: player.osuId,
  username: player.username,
  playerId: player.id,
});

/**
 * Only beatmaps the osu! API no longer serves can be edited by hand; on any
 * other beatmap an admin has nothing to do, so the hero shows no menu.
 */
export function canEditBeatmapByHand(
  beatmap: Pick<BeatmapWithDetails, 'dataFetchStatus'>
) {
  return beatmap.dataFetchStatus === DataFetchStatus.NotFound;
}

/**
 * The beatmap hero's one admin control: an "Admin" menu, on the cover art
 * when there is one, and the edit dialog it opens. Renders nothing for
 * visitors, or on a beatmap the osu! API still serves.
 */
export default function BeatmapAdminView({
  beatmap,
  onArt = true,
}: {
  beatmap: BeatmapWithDetails;
  /** The hero has cover art, so the menu takes the dark pill. */
  onArt?: boolean;
}) {
  const session = useSession();
  const [editing, setEditing] = useState(false);

  if (!hasAdminScope(session?.scopes ?? []) || !canEditBeatmapByHand(beatmap)) {
    return null;
  }

  return (
    <>
      <AdminMenu
        onArt={onArt}
        data-testid="beatmap-admin-menu"
        actions={[
          {
            label: 'Edit beatmap data',
            icon: PencilLine,
            onSelect: () => setEditing(true),
            testId: 'beatmap-edit-action',
          },
        ]}
      />
      <BeatmapEditDialog
        beatmap={beatmap}
        open={editing}
        onOpenChange={setEditing}
      />
    </>
  );
}

function BeatmapEditDialog({
  beatmap,
  open,
  onOpenChange,
}: {
  beatmap: BeatmapWithDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<FooterMode>('edit');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const inFlight = useRef(false);

  const owner = beatmap.setOwnerOverride ?? beatmap.beatmapset?.creator;
  const initialOwner = owner ? [toPlayer(owner)] : [];
  const initialMappers = beatmap.creators.map(toPlayer);

  const defaultValues: FormValues = {
    diffName: beatmap.diffName,
    ruleset: String(beatmap.ruleset),
    sr: String(beatmap.sr),
    bpm: String(beatmap.bpm),
    totalLength: formatDuration(Number(beatmap.totalLength)),
    drainLength: formatDuration(Number(beatmap.drainLength)),
    cs: String(beatmap.cs),
    hp: String(beatmap.hp),
    od: String(beatmap.od),
    ar: String(beatmap.ar),
    countCircle: String(beatmap.countCircle),
    countSlider: String(beatmap.countSlider),
    countSpinner: String(beatmap.countSpinner),
    maxCombo: beatmap.maxCombo === null ? '' : String(beatmap.maxCombo),
    titleOverride: beatmap.titleOverride ?? beatmap.beatmapset?.title ?? '',
    artistOverride: beatmap.artistOverride ?? beatmap.beatmapset?.artist ?? '',
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  const [setOwner, setSetOwner] = useState<PlayerLookupResult[]>(initialOwner);
  const [mappers, setMappers] = useState<PlayerLookupResult[]>(initialMappers);

  const isDirty =
    form.formState.isDirty ||
    !sameOsuIds(setOwner, initialOwner) ||
    !sameOsuIds(mappers, initialMappers);

  function reset() {
    form.reset(defaultValues);
    setSetOwner(initialOwner);
    setMappers(initialMappers);
    setMode('edit');
    setSaveError(null);
  }

  function requestClose(next: boolean) {
    if (!next && isDirty) {
      setDiscarding(true);
      return;
    }

    if (next) {
      reset();
    }

    onOpenChange(next);
  }

  async function save() {
    if (inFlight.current) return;

    inFlight.current = true;
    setSaving(true);
    setSaveError(null);

    try {
      const parsed = formSchema.safeParse(form.getValues());

      if (!parsed.success) {
        await form.trigger();
        setMode('edit');
        return;
      }

      const values = parsed.data;

      await orpc.beatmaps.admin.update({
        id: beatmap.id,
        diffName: values.diffName,
        ruleset: Number(values.ruleset) as Ruleset,
        rankedStatus: beatmap.rankedStatus,
        totalLength: parseDuration(values.totalLength) ?? 0,
        drainLength: parseDuration(values.drainLength) ?? 0,
        bpm: Number(values.bpm),
        countCircle: Number(values.countCircle),
        countSlider: Number(values.countSlider),
        countSpinner: Number(values.countSpinner),
        cs: Number(values.cs),
        hp: Number(values.hp),
        od: Number(values.od),
        ar: Number(values.ar),
        sr: Number(values.sr),
        maxCombo: values.maxCombo === '' ? null : Number(values.maxCombo),
        titleOverride: values.titleOverride || null,
        artistOverride: values.artistOverride || null,
        setOwnerOsuIdOverride: setOwner[0]?.osuId ?? null,
        creatorOsuIds: mappers.map((mapper) => mapper.osuId),
      });

      saveToast();
      onOpenChange(false);
      setMode('edit');
      router.refresh();
    } catch (error) {
      errorSaveToast(error);
      setSaveError('The save did not go through. Your changes are still here.');
      setMode('edit');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Form {...form}>
        <DialogTemplate
          open={open}
          onOpenChange={requestClose}
          title="Edit beatmap"
          description="The osu! API no longer serves this beatmap. What you enter here is what the site will show."
          size="lg"
          onSubmit={form.handleSubmit(() => setMode('confirm'))}
          notice={
            <>
              <Callout tone="danger" title="Saving is permanent">
                This beatmap stops receiving osu! API updates for good. Nothing
                can undo it.
              </Callout>
              {saveError ? (
                <p
                  role="alert"
                  className="text-sm font-medium text-destructive-foreground"
                >
                  {saveError}
                </p>
              ) : null}
            </>
          }
          footerStart={
            mode === 'confirm' ? (
              <span className="text-foreground">
                Pin this beatmap permanently?
              </span>
            ) : undefined
          }
          footer={
            mode === 'edit' ? (
              <>
                <Button variant="outline" onClick={() => requestClose(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive">
                  Save changes
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => setMode('edit')}
                >
                  Back
                </Button>
                <Button
                  variant="destructive-confirm"
                  pending={saving}
                  onClick={save}
                >
                  {saving ? 'Saving…' : 'Save permanently'}
                </Button>
              </>
            )
          }
        >
          <FieldGroup icon={Music2} title="Identity">
            <FormField
              control={form.control}
              name="diffName"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel>Difficulty</FormFieldLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormGrid>
              <FormField
                control={form.control}
                name="artistOverride"
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel>Artist</FormFieldLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="titleOverride"
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel>Title</FormFieldLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FieldGroup>

          <FieldGroup icon={UserRound} title="Attribution">
            <FormItem>
              <FormFieldLabel>Set owner</FormFieldLabel>
              <PlayerPicker
                value={setOwner}
                onChange={setSetOwner}
                label="set owner"
              />
            </FormItem>
            <FormItem>
              <FormFieldLabel>Mappers</FormFieldLabel>
              <PlayerPicker
                value={mappers}
                onChange={setMappers}
                multiple
                label="mappers"
              />
            </FormItem>
          </FieldGroup>

          <FieldGroup
            icon={Gauge}
            title="Difficulty and timing"
            info="CS is the key count in osu!mania"
          >
            <FormField
              control={form.control}
              name="ruleset"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel>Ruleset</FormFieldLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(RULESET_NAMES).map(([value, name]) => (
                        <SelectItem key={value} value={value}>
                          {name.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormGrid columns={4}>
              {DIFFICULTY_FIELDS.map((field) => (
                <NumberField
                  key={field.name}
                  control={form.control}
                  {...field}
                />
              ))}
            </FormGrid>
          </FieldGroup>

          <FieldGroup icon={Shapes} title="Objects">
            <FormGrid columns={4}>
              {OBJECT_FIELDS.map((field) => (
                <NumberField
                  key={field.name}
                  control={form.control}
                  {...field}
                />
              ))}
            </FormGrid>
          </FieldGroup>
        </DialogTemplate>
      </Form>

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard your changes?"
        description={
          <p>Everything you typed into this beatmap will be lost.</p>
        }
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          reset();
          onOpenChange(false);
        }}
      />
    </>
  );
}

/** One group of fields in the dialog body, under a small heading. */
function FieldGroup({
  icon: Icon,
  title,
  info,
  children,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  info?: string;
  children: React.ReactNode;
}) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 not-first:border-t not-first:pt-4"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 id={headingId} className="text-sm font-semibold">
          {title}
        </h3>
        {info ? (
          <InfoButton label={aboutLabel(title)} align="start">
            {info}
          </InfoButton>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function NumberField({
  control,
  name,
  label,
  hint,
  step,
  placeholder,
}: NumericField & { control: Control<FormValues> }) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormFieldLabel hint={hint}>{label}</FormFieldLabel>
          <FormControl>
            {step ? (
              <Input
                type="number"
                step={step}
                inputMode="decimal"
                placeholder={placeholder}
                className="tabular-nums"
                {...field}
              />
            ) : (
              <Input
                inputMode="numeric"
                placeholder={placeholder}
                className="tabular-nums"
                {...field}
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

type NumericField = {
  name: keyof FormValues;
  label: string;
  hint?: string;
  /** Omitted for the length fields, which are typed as mm:ss. */
  step?: string;
  placeholder?: string;
};

const DIFFICULTY_FIELDS: readonly NumericField[] = [
  { name: 'sr', label: 'Star rating', hint: 'stars', step: '0.01' },
  { name: 'bpm', label: 'BPM', hint: 'bpm', step: '0.01' },
  { name: 'totalLength', label: 'Length', hint: 'mm:ss', placeholder: '3:42' },
  { name: 'drainLength', label: 'Drain', hint: 'mm:ss', placeholder: '3:20' },
  { name: 'cs', label: 'CS', step: '0.1', placeholder: '10' },
  { name: 'hp', label: 'HP', step: '0.1', placeholder: '10' },
  { name: 'od', label: 'OD', step: '0.1', placeholder: '10' },
  { name: 'ar', label: 'AR', step: '0.1', placeholder: '10' },
];

const OBJECT_FIELDS: readonly NumericField[] = [
  { name: 'countCircle', label: 'Circles', step: '1' },
  { name: 'countSlider', label: 'Sliders', step: '1' },
  { name: 'countSpinner', label: 'Spinners', step: '1' },
  { name: 'maxCombo', label: 'Max combo', hint: 'optional', step: '1' },
];
