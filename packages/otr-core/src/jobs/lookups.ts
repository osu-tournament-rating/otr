import { sql, type SQL } from 'drizzle-orm';

import { JobQueue, JobStatus } from './enums';

interface JobWriter {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Clears the note that `userId` must sign in with osu! again
 * (users.osu_sign_in_needed_at) and wakes their lookups (JobQueue.OsuLookup)
 * that wait for it: a waiting one runs now, and a running one runs once more
 * after it finishes, since it may have read the old token. The worker spreads
 * them out again to the user's speed. With `onlyIfNoted`, lookups wake only
 * when there was a note to clear. Returns whether there was one.
 */
export async function resumeOsuLookups(
  db: JobWriter,
  userId: number,
  { onlyIfNoted = false }: { onlyIfNoted?: boolean } = {}
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    WITH cleared AS (
      UPDATE users SET osu_sign_in_needed_at = NULL
      WHERE id = ${userId} AND osu_sign_in_needed_at IS NOT NULL
      RETURNING id
    ), woken AS (
      -- Each status on its own, so each uses its partial index on jobs
      UPDATE jobs SET run_after = now(), updated = now()
      WHERE queue = ${JobQueue.OsuLookup}
        AND status = ${JobStatus.Pending}
        AND requested_by_user_id = ${userId}
        AND run_after > now()
        AND (${!onlyIfNoted}::boolean OR EXISTS (SELECT 1 FROM cleared))
      RETURNING id
    ), rerun AS (
      UPDATE jobs SET rerun_requested = true, updated = now()
      WHERE queue = ${JobQueue.OsuLookup}
        AND status = ${JobStatus.Running}
        AND requested_by_user_id = ${userId}
        AND (${!onlyIfNoted}::boolean OR EXISTS (SELECT 1 FROM cleared))
      RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM cleared) AS noted`);

  return rows[0]?.noted === true;
}
