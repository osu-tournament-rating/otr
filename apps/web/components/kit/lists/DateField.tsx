'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type * as React from 'react';

import { Button } from '@/components/kit/controls/Button';
import { IconButton } from '@/components/kit/controls/IconButton';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate } from '@/lib/kit/format/date';
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  addDays,
  addMonths,
  clampIsoDay,
  daysInMonth,
  endOfWeek,
  formatLongDay,
  getMonthGrid,
  isDayInRange,
  parseIsoDay,
  startOfWeek,
  toIsoDay,
  todayIsoDay,
} from '@/lib/kit/lists/calendar';
import { isIsoDay } from '@/lib/kit/lists/params';
import { cn } from '@/lib/utils';

/** osu! came out in 2007; no tournament is older. */
const DEFAULT_FIRST_YEAR = 2007;

interface CalendarProps {
  value?: string;
  onSelect: (day: string) => void;
  /** Earliest and latest days that can be picked, as `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  /** Tints the days between these ends, to show a range being picked. */
  highlight?: { from?: string; to?: string };
}

/**
 * A month grid of UTC days. Arrow keys move by day and week, Page Up and
 * Page Down by month (with Shift, by year), Home and End to the week's ends.
 */
export function Calendar({
  value: valueProp,
  onSelect,
  min: minProp,
  max: maxProp,
  highlight,
}: CalendarProps) {
  // Only real `YYYY-MM-DD` days count; a timestamp must not break the grid.
  const value = isIsoDay(valueProp) ? valueProp : undefined;
  const min = isIsoDay(minProp) ? minProp : undefined;
  const max = isIsoDay(maxProp) ? maxProp : undefined;
  const labelId = useId();
  const today = todayIsoDay();
  const firstYear = parseIsoDay(min)?.year ?? DEFAULT_FIRST_YEAR;
  const lastYear =
    parseIsoDay(max)?.year ?? (parseIsoDay(today)?.year ?? firstYear) + 1;

  const [focused, setFocused] = useState(() =>
    clampIsoDay(value ?? today, min, max)
  );
  const view = parseIsoDay(focused)!;
  const grid = getMonthGrid(view.year, view.month);
  const gridRef = useRef<HTMLTableElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)
      ?.focus();
  }, [focused]);

  const go = (day: string, focus = false) => {
    moveFocus.current = focus;
    setFocused(clampIsoDay(day, min, max));
  };

  const showMonth = (year: number, month: number) =>
    go(
      toIsoDay({
        year,
        month,
        day: Math.min(view.day, daysInMonth(year, month)),
      })
    );

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => startOfWeek(focused),
      End: () => endOfWeek(focused),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    go(move(), true);
  };

  const monthStart = toIsoDay({ ...view, day: 1 });
  const monthEnd = toIsoDay({
    ...view,
    day: daysInMonth(view.year, view.month),
  });
  const canGoBack = !min || addDays(monthStart, -1) >= min;
  const canGoForward = !max || addDays(monthEnd, 1) <= max;

  // Newest first; widened if a stored date falls outside the usual years.
  const newestYear = Math.max(lastYear, view.year);
  const oldestYear = Math.min(firstYear, view.year);
  const years = Array.from(
    { length: newestYear - oldestYear + 1 },
    (_, index) => newestYear - index
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <IconButton
          label="Previous month"
          icon={ChevronLeft}
          disabled={!canGoBack}
          onClick={() => go(addMonths(focused, -1))}
        />
        <Select
          value={String(view.month)}
          onValueChange={(month) => showMonth(view.year, Number(month))}
        >
          <SelectTrigger aria-label="Month" className="h-8 min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, index) => (
              <SelectItem key={name} value={String(index + 1)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(view.year)}
          onValueChange={(year) => showMonth(Number(year), view.month)}
        >
          <SelectTrigger aria-label="Year" className="h-8 w-[5.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconButton
          label="Next month"
          icon={ChevronRight}
          disabled={!canGoForward}
          onClick={() => go(addMonths(focused, 1))}
        />
      </div>

      <span id={labelId} aria-live="polite" className="sr-only">
        {MONTH_NAMES[view.month - 1]} {view.year}
      </span>
      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="w-full border-collapse"
      >
        <thead>
          <tr>
            {WEEKDAY_NAMES.map((name) => (
              <th
                key={name}
                scope="col"
                abbr={name}
                className="pb-1 text-xs font-medium text-muted-foreground"
              >
                {name.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const parts = parseIsoDay(day)!;
                const selected = day === value;
                const outside = parts.month !== view.month;
                const enabled = isDayInRange(day, min, max);
                const inRange =
                  !!highlight?.from &&
                  !!highlight.to &&
                  day >= highlight.from &&
                  day <= highlight.to;
                return (
                  <td
                    key={day}
                    role="gridcell"
                    aria-selected={selected}
                    className="p-0.5 text-center"
                  >
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focused ? 0 : -1}
                      disabled={!enabled}
                      aria-label={formatLongDay(day)}
                      aria-current={day === today ? 'date' : undefined}
                      onClick={() => onSelect(day)}
                      onFocus={() => {
                        if (day !== focused) setFocused(day);
                      }}
                      className={cn(
                        'relative mx-auto flex size-9 cursor-pointer items-center justify-center rounded-md text-sm tabular-nums transition-colors outline-none',
                        'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                        outside && 'text-muted-foreground',
                        inRange &&
                          !selected &&
                          'bg-primary/10 dark:bg-primary/20',
                        day === today &&
                          !selected &&
                          'font-semibold after:absolute after:bottom-1 after:size-1 after:rounded-full after:bg-primary',
                        selected &&
                          'bg-primary font-semibold text-primary-foreground hover:bg-primary/90'
                      )}
                    >
                      {parts.day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A date picker for one UTC day, as `YYYY-MM-DD`: a button showing the date
 * that opens a month calendar. It replaces the browser's own date field,
 * which looks different in every browser and follows the visitor's locale.
 */
export function DateField({
  value,
  onValueChange,
  label,
  placeholder = 'Any date',
  min,
  max,
  highlight,
  className,
}: {
  value?: string;
  /** Called with the picked day, or `undefined` when cleared. */
  onValueChange: (value: string | undefined) => void;
  /** The accessible name, such as "From". */
  label: string;
  placeholder?: string;
  min?: string;
  max?: string;
  highlight?: { from?: string; to?: string };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const text = value ? formatDate(value) : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${label}: ${text}`}
          className={cn(
            'w-full min-w-0 justify-start gap-2 bg-background font-normal dark:bg-input/50 dark:shadow-none',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          <span className="truncate">{text}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        collisionPadding={16}
        className="w-auto rounded-xl p-3"
        aria-label={`${label}: choose a date`}
        // Start on the selected day (or today), not the first button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLButtonElement>(
              '[role="grid"] button[tabindex="0"]'
            )
            ?.focus();
        }}
      >
        <Calendar
          value={value}
          min={min}
          max={max}
          highlight={highlight}
          onSelect={(day) => {
            onValueChange(day);
            setOpen(false);
          }}
        />
        <div className="mt-3 flex justify-end border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={!value}
            onClick={() => {
              onValueChange(undefined);
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
