import { sql, type SQL } from 'drizzle-orm';

type ApiService = 'osu' | 'osutrack';

interface Totals {
  day: string;
  service: ApiService;
  endpoint: string;
  status: string;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface Executor {
  execute(query: SQL): Promise<unknown>;
}

/**
 * Counts outbound API requests per UTC day in memory and writes them to
 * api_request_stats_daily on flush. A crash loses at most one flush interval.
 */
export class ApiRequestStats {
  private pending = new Map<string, Totals>();

  record(
    service: ApiService,
    endpoint: string,
    status: string,
    durationMs: number,
    now = new Date()
  ) {
    const day = now.toISOString().slice(0, 10);
    const key = `${day}|${service}|${endpoint}|${status}`;
    const ms = Math.max(0, Math.round(durationMs));
    const totals = this.pending.get(key);

    if (totals) {
      totals.count += 1;
      totals.totalDurationMs += ms;
      totals.maxDurationMs = Math.max(totals.maxDurationMs, ms);
    } else {
      this.pending.set(key, {
        day,
        service,
        endpoint,
        status,
        count: 1,
        totalDurationMs: ms,
        maxDurationMs: ms,
      });
    }
  }

  /** Writes what was recorded since the last flush; keeps it for the next one on failure. */
  async flush(db: Executor) {
    if (this.pending.size === 0) {
      return;
    }

    const batch = [...this.pending.values()];
    this.pending = new Map();

    try {
      await db.execute(sql`
        INSERT INTO api_request_stats_daily (
          day, service, endpoint, status, count, total_duration_ms, max_duration_ms
        )
        VALUES ${sql.join(
          batch.map(
            (row) =>
              sql`(${row.day}::date, ${row.service}, ${row.endpoint}, ${row.status}, ${row.count}, ${row.totalDurationMs}, ${row.maxDurationMs})`
          ),
          sql`, `
        )}
        ON CONFLICT (day, service, endpoint, status) DO UPDATE SET
          count = api_request_stats_daily.count + EXCLUDED.count,
          total_duration_ms = api_request_stats_daily.total_duration_ms + EXCLUDED.total_duration_ms,
          max_duration_ms = GREATEST(api_request_stats_daily.max_duration_ms, EXCLUDED.max_duration_ms)`);
    } catch (error) {
      for (const row of batch) {
        const key = `${row.day}|${row.service}|${row.endpoint}|${row.status}`;
        const current = this.pending.get(key);
        if (current) {
          current.count += row.count;
          current.totalDurationMs += row.totalDurationMs;
          current.maxDurationMs = Math.max(
            current.maxDurationMs,
            row.maxDurationMs
          );
        } else {
          this.pending.set(key, row);
        }
      }
      throw error;
    }
  }
}

export const apiRequestStats = new ApiRequestStats();
