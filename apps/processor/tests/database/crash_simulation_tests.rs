use serial_test::serial;
use std::{
    io::Read,
    process::Child,
    time::{Duration, Instant}
};
use tokio_postgres::Client;

use super::test_helpers::{processor, processor_binary, row_count, snapshot, TestDatabase};
use crate::common::init_test_env;

/// Upper bound on each wait, so a regression fails the test instead of hanging it.
const WAIT_LIMIT: Duration = Duration::from_secs(60);

/// Tables a rebuild rewrites. `created` defaults to the transaction's start
/// time, so a second committed run would not match a snapshot of the first.
const REBUILT_TABLES: [&str; 4] = [
    "player_ratings",
    "rating_adjustments",
    "player_highest_ranks",
    "game_scores"
];

/// Waits for a backend blocked by `lock_pid`, returning its pid, its statement,
/// and whether it holds a write transaction. Fails if `child` exits first.
async fn wait_for_blocked_backend(client: &Client, lock_pid: i32, child: &mut Child) -> (i32, String, bool) {
    let deadline = Instant::now() + WAIT_LIMIT;
    loop {
        let blocked = client
            .query_opt(
                "SELECT pid, query, backend_xid IS NOT NULL FROM pg_stat_activity \
                 WHERE $1 = ANY(pg_blocking_pids(pid))",
                &[&lock_pid]
            )
            .await
            .expect("Failed to inspect blocked backends");
        if let Some(row) = blocked {
            return (row.get(0), row.get(1), row.get(2));
        }

        if let Some(status) = child.try_wait().expect("Failed to poll processor") {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            panic!("Processor exited ({status}) before it reached the locked table:\n{stderr}");
        }

        assert!(Instant::now() < deadline, "Processor never blocked on the locked table");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn wait_for_backend_exit(client: &Client, pid: i32) {
    let deadline = Instant::now() + WAIT_LIMIT;
    loop {
        let alive: bool = client
            .query_one("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1)", &[&pid])
            .await
            .expect("Failed to inspect backends")
            .get(0);
        if !alive {
            return;
        }

        assert!(Instant::now() < deadline, "Backend {pid} outlived the killed processor");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// A processor killed partway through its transaction must leave the previous
/// run's committed results untouched.
#[tokio::test]
#[serial]
async fn test_crash_leaves_database_consistent() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");
    let check_client = test_db.get_client().await.expect("Failed to get client");
    let binary = processor_binary();

    // A run that exits normally commits one complete set of results.
    let completed = processor(binary, &test_db).output().expect("Failed to run processor");
    assert!(
        completed.status.success(),
        "Processor run failed ({}):\n{}",
        completed.status,
        String::from_utf8_lossy(&completed.stderr)
    );
    assert!(
        row_count(&check_client, "player_ratings").await > 0,
        "Run should save ratings"
    );
    assert!(
        row_count(&check_client, "rating_adjustments").await > 0,
        "Run should save rating adjustments"
    );

    // The seeded tournament has no stats yet, so the run queues its stats job.
    let tournament_id: i32 = check_client
        .query_one("SELECT id FROM tournaments", &[])
        .await
        .expect("Failed to fetch tournament")
        .get(0);
    let queued: Vec<(Option<i32>, Option<String>)> = check_client
        .query(
            "SELECT tournament_id, payload->>'tournamentId' FROM jobs WHERE queue = 'processing.stats.tournaments'",
            &[]
        )
        .await
        .expect("Failed to read jobs")
        .iter()
        .map(|row| (row.get(0), row.get(1)))
        .collect();
    assert_eq!(
        queued,
        [(Some(tournament_id), Some(tournament_id.to_string()))],
        "Run should queue one stats job for the seeded tournament"
    );

    // A stale placement makes the next run write before it reaches the lock below.
    check_client
        .execute(
            "UPDATE game_scores SET placement = 99 WHERE id = (SELECT MIN(id) FROM game_scores)",
            &[]
        )
        .await
        .expect("Failed to make a placement stale");

    let mut committed = Vec::new();
    for table in REBUILT_TABLES {
        committed.push(snapshot(&check_client, table).await);
    }

    // A fixed delay usually let the run commit before the kill, since the seed
    // is small. A read lock on player_ratings instead stalls the next run at
    // its TRUNCATE of that table, inside its transaction and after its
    // placement update, so the kill always lands mid-transaction.
    let lock_client = test_db.get_client().await.expect("Failed to get client");
    lock_client
        .batch_execute("BEGIN; LOCK TABLE player_ratings IN ACCESS SHARE MODE")
        .await
        .expect("Failed to lock player_ratings");
    let lock_pid: i32 = lock_client
        .query_one("SELECT pg_backend_pid()", &[])
        .await
        .expect("Failed to get lock backend pid")
        .get(0);

    let mut child = processor(binary, &test_db).spawn().expect("Failed to start processor");
    let (processor_pid, blocked_query, wrote) = wait_for_blocked_backend(&check_client, lock_pid, &mut child).await;
    assert!(
        wrote,
        "Processor should hold a write transaction when killed; it blocked on: {blocked_query}"
    );

    // Simulate the crash
    child.kill().expect("Failed to kill processor");
    let crashed = child.wait_with_output().expect("Failed to wait for processor");
    assert!(!crashed.status.success(), "Killed processor should not exit cleanly");

    // Postgres notices the closed connection once the statement can proceed,
    // and aborts the transaction because COMMIT never arrived.
    lock_client
        .batch_execute("ROLLBACK")
        .await
        .expect("Failed to release lock");
    wait_for_backend_exit(&check_client, processor_pid).await;

    for (table, before) in REBUILT_TABLES.iter().zip(&committed) {
        assert_eq!(
            &snapshot(&check_client, table).await,
            before,
            "{table} should keep the last committed run after a crash"
        );
    }

    // Verify no lingering transactions
    let active_transactions: i64 = check_client
        .query_one(
            "SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'idle in transaction' AND datname = current_database()",
            &[]
        )
        .await
        .expect("Failed to query")
        .get(0);

    assert_eq!(active_transactions, 0, "No lingering transactions should exist");
}
