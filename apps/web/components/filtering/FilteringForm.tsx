'use client';

import { useState } from 'react';
import { SlidersHorizontal, Users } from 'lucide-react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Ruleset } from '@otr/core/osu';

import { Button } from '@/components/kit/controls/Button';
import {
  FormActions,
  FormGrid,
  FormPanel,
  FormSection,
} from '@/components/kit/controls/FormPanel';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
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
import { Textarea } from '@/components/ui/textarea';
import { useFormDraft } from '@/lib/hooks/useFormDraft';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import { RATED_RULESETS, RULESET_NAMES } from '@/lib/kit/format/ruleset';
import { RANGE_SEPARATOR } from '@/lib/kit/format/date';
import { orpc } from '@/lib/orpc/orpc';
import type { FilteringResult } from '@/lib/orpc/schema/filtering';
import FilterComplianceNotice from './FilterComplianceNotice';
import FilterReportSummary from './FilterReportSummary';
import FilteringResultsTable from './FilteringResultsTable';
import { csvDay, downloadFilterCsv } from './filterCsv';

/** The bounds the filter accepts for a rating. */
const MIN_RATING = 100;
const MAX_RATING = 5000;
/** The most players one filter can check (`FilteringRequestSchema`). */
const MAX_PLAYER_IDS = 5000;

const RATING_HINT = `${formatCount(MIN_RATING)}${RANGE_SEPARATOR}${formatCount(MAX_RATING)}`;

/** An optional whole-number rating between the bounds, named in its messages. */
const ratingSchema = (label: string) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === ''
        ? undefined
        : typeof value === 'string'
          ? value.trim()
          : value,
    z.coerce
      .number({ error: `${label} must be a number` })
      .int(`${label} must be a whole number`)
      .min(MIN_RATING, `${label} must be at least ${formatCount(MIN_RATING)}`)
      .max(MAX_RATING, `${label} cannot exceed ${formatCount(MAX_RATING)}`)
      .optional()
  );

function parsePlayerIds(value: string): string[] {
  return value.split(/[\s,]+/).filter((id) => id.trim() !== '');
}

const filteringFormSchema = z
  .object({
    ruleset: z.string().min(1, 'Ruleset is required'),
    minRating: ratingSchema('Minimum rating'),
    maxRating: ratingSchema('Maximum rating'),
    osuPlayerIds: z
      .string()
      .refine(
        (value) => parsePlayerIds(value).length > 0,
        'At least one osu! player ID is required'
      )
      .refine(
        (value) =>
          parsePlayerIds(value).every(
            (id) => /^\d+$/.test(id) && parseInt(id, 10) > 0
          ),
        'osu! player IDs must be positive whole numbers separated by spaces, commas, or new lines'
      )
      .refine((value) => {
        const ids = parsePlayerIds(value);
        return ids.length === new Set(ids).size;
      }, 'Duplicate osu! player IDs are not allowed')
      .refine(
        (value) => parsePlayerIds(value).length <= MAX_PLAYER_IDS,
        `osu! player IDs cannot exceed ${formatCount(MAX_PLAYER_IDS)}`
      ),
  })
  // A filter on the ruleset alone would pass every rated player.
  .refine(
    (data) => data.minRating !== undefined || data.maxRating !== undefined,
    {
      message: 'A minimum or maximum rating is required',
      path: ['minRating'],
    }
  )
  .refine(
    (data) =>
      data.minRating === undefined ||
      data.maxRating === undefined ||
      data.maxRating >= data.minRating,
    {
      message: 'Maximum rating must be at least the minimum rating',
      path: ['maxRating'],
    }
  );

type FilteringFormInput = z.input<typeof filteringFormSchema>;
type FilteringFormValues = z.output<typeof filteringFormSchema>;

const EMPTY_VALUES: FilteringFormInput = {
  ruleset: '',
  minRating: '',
  maxRating: '',
  osuPlayerIds: '',
};

/** The required-field mark the section's note refers to. */
function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="text-destructive-foreground">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

type SubmittedFilter = {
  results: FilteringResult;
  ruleset: Ruleset;
  minRating: number | null;
  maxRating: number | null;
};

interface FilteringFormProps {
  onFilteringComplete: (results: FilteringResult) => void;
  filteringResults: FilteringResult | null;
}

/**
 * The registrant filter: ruleset and rating bounds, then the players to
 * check, on one form panel. After a run it shows the forum post text, the
 * report's summary and the results table.
 */
export default function FilteringForm({
  onFilteringComplete,
  filteringResults,
}: FilteringFormProps) {
  const [submitted, setSubmitted] = useState<SubmittedFilter | null>(null);

  const form = useForm<FilteringFormInput, unknown, FilteringFormValues>({
    resolver: zodResolver(filteringFormSchema),
    defaultValues: EMPTY_VALUES,
    mode: 'onChange',
  });
  useFormDraft(form, 'registrant-filter', EMPTY_VALUES);
  const isLoading = form.formState.isSubmitting;

  async function onSubmit(values: FilteringFormValues) {
    const osuPlayerIds = parsePlayerIds(values.osuPlayerIds).map((id) =>
      parseInt(id, 10)
    );
    const ruleset = Number(values.ruleset) as Ruleset;

    try {
      const result = await orpc.filtering.filter({
        ruleset,
        minRating: values.minRating,
        maxRating: values.maxRating,
        osuPlayerIds,
      });

      setSubmitted({
        results: result,
        ruleset,
        minRating: values.minRating ?? null,
        maxRating: values.maxRating ?? null,
      });
      onFilteringComplete(result);
      toast.success(`Filtered ${formatCountOf(osuPlayerIds.length, 'player')}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Players could not be filtered'
      );
    }
  }

  const results = filteringResults ?? submitted?.results ?? null;

  return (
    <>
      <Form {...form}>
        <FormPanel
          data-testid="filter-form"
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormSection
            icon={SlidersHorizontal}
            title="Filter criteria"
            description="Fields marked with * are required."
          >
            <FormField
              control={form.control}
              name="ruleset"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel>
                    Ruleset
                    <RequiredMark />
                  </FormFieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger
                        data-testid="filter-ruleset"
                        aria-required="true"
                        className="w-full sm:w-56"
                      >
                        <SelectValue placeholder="Select a ruleset" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {RATED_RULESETS.map((ruleset) => (
                        <SelectItem key={ruleset} value={String(ruleset)}>
                          {RULESET_NAMES[ruleset].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormGrid>
              <FormField
                control={form.control}
                name="minRating"
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel hint={RATING_HINT}>
                      Minimum rating
                    </FormFieldLabel>
                    <FormControl>
                      <Input
                        data-testid="filter-minRating"
                        inputMode="numeric"
                        placeholder="500"
                        {...field}
                        value={String(field.value ?? '')}
                        onChange={(event) => {
                          field.onChange(event);
                          // The pair is checked together; recheck the maximum.
                          if (form.formState.touchedFields.maxRating) {
                            void form.trigger('maxRating');
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxRating"
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel hint={RATING_HINT}>
                      Maximum rating
                    </FormFieldLabel>
                    <FormControl>
                      <Input
                        data-testid="filter-maxRating"
                        inputMode="numeric"
                        placeholder="2000"
                        {...field}
                        value={String(field.value ?? '')}
                        onChange={(event) => {
                          field.onChange(event);
                          if (form.formState.touchedFields.minRating) {
                            void form.trigger('minRating');
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>

          <FormSection icon={Users} title="Player IDs">
            <FormField
              control={form.control}
              name="osuPlayerIds"
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel hint={`Up to ${formatCount(MAX_PLAYER_IDS)}`}>
                    osu! player IDs
                    <RequiredMark />
                  </FormFieldLabel>
                  <FormControl>
                    <Textarea
                      data-testid="filter-player-ids"
                      aria-required="true"
                      placeholder="Enter osu! player IDs (e.g. 1234567, 2345678, 3456789)"
                      className="min-h-32 sm:min-h-40"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          <FormActions>
            <Button
              variant="outline"
              disabled={isLoading}
              onClick={() => form.reset(EMPTY_VALUES)}
            >
              Reset
            </Button>
            <Button
              type="submit"
              data-testid="filter-submit-button"
              pending={isLoading}
            >
              {isLoading ? 'Filtering…' : 'Filter players'}
            </Button>
          </FormActions>
        </FormPanel>
      </Form>

      {results ? (
        <div data-testid="filter-results" className="flex flex-col gap-4">
          <FilterComplianceNotice
            filterReportId={results.filterReportId}
            created={results.created}
          />
          <FilterReportSummary
            reportId={results.filterReportId}
            created={results.created}
            results={results}
            request={
              submitted && submitted.results === results ? submitted : undefined
            }
          />
          <FilteringResultsTable
            results={results}
            onDownloadCSV={() =>
              downloadFilterCsv(
                results,
                `otr-filtering-results-${csvDay()}.csv`
              )
            }
          />
        </div>
      ) : null}
    </>
  );
}
