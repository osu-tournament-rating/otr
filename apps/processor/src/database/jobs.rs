//! Queues the data worker's tournament stats jobs as rows in otr's `jobs`
//! table, inside the rebuild's transaction, so they commit or roll back with
//! the ratings they describe.

use super::{db::DbClient, error::DbResult};
use tracing::{info, warn};

/// `@otr/core`'s `JobQueue.TournamentStats`, the queue the data worker reads
/// tournament stats jobs from.
pub const TOURNAMENT_STATS_QUEUE: &str = "processing.stats.tournaments";

impl DbClient {
    /// Queues one tournament stats job per id in `tournament_ids`, each with
    /// the payload `{"tournamentId": <id>}` and `correlation_id`, and returns
    /// how many it queued. Priority, status, attempts, and run time come from
    /// the column defaults.
    ///
    /// Call it inside the rebuild's transaction: a failed insert fails the run.
    /// A database without a `jobs` table, such as an older public replica that
    /// otr-replay runs a newer processor against, queues nothing.
    ///
    /// The insert has no dedup key and no `ON CONFLICT`. Under repeatable read,
    /// a conflict with a row committed after the transaction's snapshot raises
    /// a serialization failure, which would roll back the whole rebuild.
    /// Duplicate stats jobs are harmless, since each one rewrites the stats.
    pub async fn enqueue_tournament_stats_jobs(&self, tournament_ids: &[i32], correlation_id: &str) -> DbResult<u64> {
        if tournament_ids.is_empty() {
            return Ok(0);
        }

        let has_jobs_table: bool = self
            .client
            .query_one("SELECT to_regclass('public.jobs') IS NOT NULL", &[])
            .await?
            .get(0);
        if !has_jobs_table {
            warn!(
                tournaments = tournament_ids.len(),
                "The database has no jobs table, so no tournament stats jobs were queued"
            );
            return Ok(0);
        }

        let queued = self
            .client
            .execute(
                "
                INSERT INTO jobs (queue, payload, correlation_id, tournament_id)
                SELECT $3::text, jsonb_build_object('tournamentId', t.id), $2, t.id
                FROM unnest($1::int4[]) AS t(id)
                ",
                &[&tournament_ids, &correlation_id, &TOURNAMENT_STATS_QUEUE]
            )
            .await?;

        info!(queued, correlation_id, "Queued tournament stats jobs");

        Ok(queued)
    }
}
