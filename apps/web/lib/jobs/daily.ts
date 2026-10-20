import {
  API_ENDPOINT_LABELS,
  API_REQUEST_STATUS_LABELS,
} from '@/lib/kit/format/enum-labels';
import type { JobDailyTotals, JobOutcomeTotals } from '@/lib/orpc/schema/jobs';

const DAY_MS = 86_400_000;

/** Every UTC day from `from` to `to`, both `YYYY-MM-DD` and included. */
export function listDays(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);

  const days: string[] = [];
  for (let time = start; time <= end; time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

/** Attempts that finished, whatever their outcome. */
export const attemptsOf = (totals: JobOutcomeTotals) =>
  totals.succeeded + totals.retried + totals.failed + totals.discarded;

/** Mean run time of the finished attempts, or null with none. */
export const averageRunTimeMs = (totals: JobOutcomeTotals) => {
  const attempts = attemptsOf(totals);
  return attempts > 0 ? totals.totalDurationMs / attempts : null;
};

export interface JobDayRow {
  day: string;
  succeeded: number;
  retried: number;
  failed: number;
  discarded: number;
  averageRunTimeMs: number | null;
}

/** One row per day of the range, with zeros for days nothing ran. */
export function toJobDayRows(totals: JobDailyTotals): JobDayRow[] {
  const byDay = new Map(totals.jobsByDay.map((row) => [row.day, row]));

  return listDays(totals.from, totals.to).map((day) => {
    const row = byDay.get(day);
    return {
      day,
      succeeded: row?.succeeded ?? 0,
      retried: row?.retried ?? 0,
      failed: row?.failed ?? 0,
      discarded: row?.discarded ?? 0,
      averageRunTimeMs: row ? averageRunTimeMs(row) : null,
    };
  });
}

/** An endpoint's series: the service and endpoint as stored, joined. */
export const endpointKey = (service: string, endpoint: string) =>
  `${service}:${endpoint}`;

/** A stored value's place in its label table's order; unknown values last. */
const rankIn = (labels: Readonly<Record<string, string>>, value: string) => {
  const index = Object.keys(labels).indexOf(value);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

/**
 * Request totals by endpoint and status, in the order the chart's legend
 * lists the endpoints and the labels list the statuses (success first).
 */
export function sortEndpointTotals<
  T extends { service: string; endpoint: string; status: string },
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      rankIn(API_ENDPOINT_LABELS, a.endpoint) -
        rankIn(API_ENDPOINT_LABELS, b.endpoint) ||
      endpointKey(a.service, a.endpoint).localeCompare(
        endpointKey(b.service, b.endpoint)
      ) ||
      rankIn(API_REQUEST_STATUS_LABELS, a.status) -
        rankIn(API_REQUEST_STATUS_LABELS, b.status) ||
      a.status.localeCompare(b.status)
  );
}

/**
 * The endpoints with requests in the range, in a fixed order so each keeps
 * its colour when another has none: the known endpoints in the order the
 * labels list them, then any others by name.
 */
export function listEndpoints(
  totals: JobDailyTotals
): { key: string; service: string; endpoint: string }[] {
  const seen = new Map<string, { service: string; endpoint: string }>();

  for (const row of totals.requestsByDay) {
    seen.set(endpointKey(row.service, row.endpoint), {
      service: row.service,
      endpoint: row.endpoint,
    });
  }

  return [...seen.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort(
      (a, b) =>
        rankIn(API_ENDPOINT_LABELS, a.endpoint) -
          rankIn(API_ENDPOINT_LABELS, b.endpoint) || a.key.localeCompare(b.key)
    );
}

/** One row per day of the range, with each endpoint's requests under its key. */
export function toRequestDayRows(
  totals: JobDailyTotals,
  endpoints: readonly { key: string }[]
): Array<Record<string, number | string>> {
  const counts = new Map<string, number>();
  for (const row of totals.requestsByDay) {
    const key = `${row.day}|${endpointKey(row.service, row.endpoint)}`;
    counts.set(key, (counts.get(key) ?? 0) + row.count);
  }

  return listDays(totals.from, totals.to).map((day) => {
    const row: Record<string, number | string> = { day };
    for (const { key } of endpoints) {
      row[key] = counts.get(`${day}|${key}`) ?? 0;
    }
    return row;
  });
}
