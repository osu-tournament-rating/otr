/**
 * Dates and times, written the same way on every engine, locale and time
 * zone: always UTC, always en-US month names, built by hand so the server
 * and the browser print identical strings (issue #1017).
 */

import { EMPTY_VALUE } from './empty';

/** Anything a date can arrive as: a `Date`, epoch milliseconds or a string. */
export type DateInput = Date | string | number;

/** The separator between the two ends of a range: a spaced en dash. */
export const RANGE_SEPARATOR = ' – ';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative time switches to a plain date at this many days. */
export const RELATIVE_TIME_MAX_DAYS = 30;

/**
 * Reads a date, or returns null when there is none or it cannot be read.
 * Accepts Postgres text such as `2024-07-20 15:42:00.123456+00`, which some
 * engines refuse to parse as written. A date and time with no zone is read
 * as UTC; JavaScript would otherwise read it in the visitor's own zone.
 */
export function toDate(input: DateInput | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;

  let date: Date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'number') {
    date = new Date(input);
  } else {
    const normalized = input
      .trim()
      .replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, '$1T')
      .replace(/(T\d{2}:\d{2}:\d{2}\.\d{3})\d+/, '$1')
      .replace(/(T[\d:.]+[+-]\d{2})$/, '$1:00')
      .replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+)$/, '$1Z');
    date = new Date(normalized);
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function monthDay(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function fullDate(date: Date): string {
  return `${monthDay(date)}, ${date.getUTCFullYear()}`;
}

/** `Jul 20, 2024`. Missing or unreadable dates print `empty` (an em dash). */
export function formatDate(
  input: DateInput | null | undefined,
  { empty = EMPTY_VALUE }: { empty?: string } = {}
): string {
  const date = toDate(input);
  return date ? fullDate(date) : empty;
}

/**
 * A span of days, sharing the year and month where both ends do:
 *
 * - `Jul 20, 2024` when both ends fall on the same day
 * - `Jul 20 – 27, 2024` within one month
 * - `Jul 20 – Aug 3, 2024` within one year
 * - `Dec 28, 2023 – Jan 4, 2024` across years
 * - `From Jul 20, 2024` or `Until Aug 3, 2024` when one end is missing
 * - `empty` (an em dash) when both are
 */
export function formatDateRange(
  start: DateInput | null | undefined,
  end: DateInput | null | undefined,
  { empty = EMPTY_VALUE }: { empty?: string } = {}
): string {
  const from = toDate(start);
  const to = toDate(end);

  if (!from && !to) return empty;
  if (!to) return `From ${fullDate(from!)}`;
  if (!from) return `Until ${fullDate(to)}`;

  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  const sameMonth = sameYear && from.getUTCMonth() === to.getUTCMonth();

  if (sameMonth && from.getUTCDate() === to.getUTCDate()) {
    return fullDate(from);
  }
  if (sameMonth) {
    return `${monthDay(from)}${RANGE_SEPARATOR}${to.getUTCDate()}, ${to.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${monthDay(from)}${RANGE_SEPARATOR}${fullDate(to)}`;
  }
  return `${fullDate(from)}${RANGE_SEPARATOR}${fullDate(to)}`;
}

/**
 * `Jul 20, 2024, 15:42 UTC`, on a 24-hour clock. Pass `seconds` where two
 * events can share a minute, such as audit entries.
 */
export function formatTimestamp(
  input: DateInput | null | undefined,
  {
    empty = EMPTY_VALUE,
    seconds = false,
  }: { empty?: string; seconds?: boolean } = {}
): string {
  const date = toDate(input);
  if (!date) return empty;

  return `${fullDate(date)}, ${clockTime(date, seconds)} UTC`;
}

function clockTime(date: Date, seconds: boolean): string {
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return seconds ? `${time}:${pad(date.getUTCSeconds())}` : time;
}

/**
 * Two moments, such as a game's start and end, in UTC on a 24-hour clock:
 *
 * - `15:42 – 15:45 UTC` when both fall on the same UTC day, with the day
 *   left out unless `showDate` asks for it (`Jul 20, 2024, 15:42 – 15:45 UTC`)
 * - `Jul 20, 2024, 23:58 UTC – Jul 21, 2024, 00:02 UTC` across days
 * - `From …` or `Until …` with the full timestamp when one end is missing
 * - `empty` (an em dash) when both are
 */
export function formatTimeRange(
  start: DateInput | null | undefined,
  end: DateInput | null | undefined,
  {
    seconds = false,
    showDate = false,
    empty = EMPTY_VALUE,
  }: { seconds?: boolean; showDate?: boolean; empty?: string } = {}
): string {
  const from = toDate(start);
  const to = toDate(end);

  if (!from && !to) return empty;
  if (!to) return `From ${formatTimestamp(from, { seconds })}`;
  if (!from) return `Until ${formatTimestamp(to, { seconds })}`;

  if (fullDate(from) !== fullDate(to)) {
    return `${formatTimestamp(from, { seconds })}${RANGE_SEPARATOR}${formatTimestamp(to, { seconds })}`;
  }

  const times = `${clockTime(from, seconds)}${RANGE_SEPARATOR}${clockTime(to, seconds)} UTC`;
  return showDate ? `${fullDate(from)}, ${times}` : times;
}

/**
 * `just now`, `5m ago`, `3h ago`, `12d ago`, then the plain date once it is
 * 30 days or more away. Future times read `in 5m`. Only for activity feeds;
 * pair it with the full timestamp on hover (the `RelativeTime` component).
 */
export function formatRelativeTime(
  input: DateInput | null | undefined,
  now: DateInput,
  { empty = EMPTY_VALUE }: { empty?: string } = {}
): string {
  const date = toDate(input);
  const reference = toDate(now);
  if (!date || !reference) return empty;

  const diff = reference.getTime() - date.getTime();
  const distance = Math.abs(diff);

  if (distance < MINUTE) return 'just now';

  let amount: string;
  if (distance < HOUR) amount = `${Math.floor(distance / MINUTE)}m`;
  else if (distance < DAY) amount = `${Math.floor(distance / HOUR)}h`;
  else if (distance < RELATIVE_TIME_MAX_DAYS * DAY)
    amount = `${Math.floor(distance / DAY)}d`;
  else return fullDate(date);

  return diff >= 0 ? `${amount} ago` : `in ${amount}`;
}

/**
 * A length in seconds, such as a beatmap's: `2:04`, or `1:02:04` from an
 * hour. Fractions of a second are dropped; missing, negative or unreadable
 * input prints `empty` (an em dash).
 */
export function formatDuration(
  seconds: number | null | undefined,
  { empty = EMPTY_VALUE }: { empty?: string } = {}
): string {
  if (seconds === null || seconds === undefined) return empty;
  if (!Number.isFinite(seconds) || seconds < 0) return empty;

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = pad(total % 60);

  return hours > 0 ? `${hours}:${pad(minutes)}:${rest}` : `${minutes}:${rest}`;
}

/**
 * How long a piece of work took, from milliseconds: `850 ms` under a
 * second, `12.5 s` under a minute, then a length as `formatDuration` writes
 * it (`2:04`). Missing, negative or unreadable input prints `empty`.
 */
export function formatRunTime(
  milliseconds: number | null | undefined,
  { empty = EMPTY_VALUE }: { empty?: string } = {}
): string {
  if (milliseconds === null || milliseconds === undefined) return empty;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return empty;

  const wholeMs = Math.round(milliseconds);
  if (wholeMs < 1000) return `${wholeMs} ms`;

  const tenths = Math.round(milliseconds / 100);
  if (tenths < 600) {
    const seconds = tenths / 10;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  }

  return formatDuration(Math.round(milliseconds / 1000), { empty });
}

/**
 * Reads a length typed as `formatDuration` writes it, back into seconds:
 * `3:45`, `1:23:45`, or bare seconds (`225`). Returns null for anything
 * else, such as `3:75` or `abc`.
 */
export function parseDuration(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(:[0-5]?\d){0,2}$/.test(trimmed)) return null;

  return trimmed
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}

/** The machine-readable value for a `<time dateTime>` attribute, in UTC. */
export function toDateTimeAttribute(
  input: DateInput | null | undefined,
  { dateOnly = false }: { dateOnly?: boolean } = {}
): string | undefined {
  const date = toDate(input);
  if (!date) return undefined;

  const iso = date.toISOString();
  return dateOnly ? iso.slice(0, 10) : iso;
}
