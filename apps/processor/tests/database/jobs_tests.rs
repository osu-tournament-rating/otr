use otr_processor::database::db::DbClient;
use serde_json::Value;
use serial_test::serial;
use std::fs;

use super::test_helpers::{row_count, TestDatabase};
use crate::common::init_test_env;

/// The payload the data worker parses for tournament 123, shared with its
/// tests. The path is from the otr root.
const PAYLOAD_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/otr-core/src/jobs/__fixtures__/tournament-stats-payload.json"
);

const CORRELATION_ID: &str = "7d0f8f8e-1c2b-4c47-9a51-2f4e0d6b3a10";

fn json(text: &str) -> Value {
    serde_json::from_str(text).expect("Failed to parse JSON")
}

/// Queued jobs are rows the data worker claims as they are: pending, with no
/// attempts, the default retry budget and priority, and no dedup key.
#[tokio::test]
#[serial]
async fn test_enqueue_tournament_stats_jobs_queues_one_pending_job_per_tournament() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    let check_client = test_db.get_client().await.expect("Failed to get client");
    let client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let transaction = client.begin_transaction().await.expect("Failed to begin transaction");
    let queued = client
        .enqueue_tournament_stats_jobs(&[123, 456], CORRELATION_ID)
        .await
        .expect("Failed to queue stats jobs");
    transaction.commit().await.expect("Failed to commit transaction");

    assert_eq!(queued, 2);
    let rows = check_client
        .query(
            "
            SELECT queue, status, attempts, max_attempts, priority, dedup_key,
                   correlation_id, tournament_id, payload::text AS payload
            FROM jobs
            ORDER BY tournament_id
            ",
            &[]
        )
        .await
        .expect("Failed to read jobs");
    assert_eq!(rows.len(), 2);

    for (row, tournament_id) in rows.iter().zip([123, 456]) {
        assert_eq!(row.get::<_, String>("queue"), "processing.stats.tournaments");
        assert_eq!(row.get::<_, i32>("status"), 0, "jobs start pending");
        assert_eq!(row.get::<_, i32>("attempts"), 0);
        assert_eq!(row.get::<_, i32>("max_attempts"), 5);
        assert_eq!(row.get::<_, i32>("priority"), 5);
        assert_eq!(row.get::<_, Option<String>>("dedup_key"), None);
        assert_eq!(row.get::<_, String>("correlation_id"), CORRELATION_ID);
        assert_eq!(row.get::<_, Option<i32>>("tournament_id"), Some(tournament_id));
    }

    let fixture = fs::read_to_string(PAYLOAD_FIXTURE).expect("Failed to read the payload fixture");
    assert_eq!(json(rows[0].get("payload")), json(&fixture));
    assert_eq!(json(rows[1].get("payload")), json(r#"{"tournamentId": 456}"#));
}

/// Jobs commit with the rebuild's ratings, so a run that rolls back queues
/// nothing.
#[tokio::test]
#[serial]
async fn test_enqueue_tournament_stats_jobs_rolls_back_with_the_transaction() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    let check_client = test_db.get_client().await.expect("Failed to get client");
    let client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let transaction = client.begin_transaction().await.expect("Failed to begin transaction");
    client
        .enqueue_tournament_stats_jobs(&[123, 456], CORRELATION_ID)
        .await
        .expect("Failed to queue stats jobs");
    assert_eq!(
        row_count(&client.client(), "jobs").await,
        2,
        "The transaction should see its own jobs"
    );
    transaction.rollback().await.expect("Failed to rollback transaction");

    assert_eq!(row_count(&check_client, "jobs").await, 0);
}

/// otr-replay runs new processor releases against older public replicas,
/// which have no jobs table. The run still commits its ratings.
#[tokio::test]
#[serial]
async fn test_enqueue_tournament_stats_jobs_skips_a_database_without_jobs() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    let check_client = test_db.get_client().await.expect("Failed to get client");
    check_client
        .batch_execute("DROP TABLE jobs")
        .await
        .expect("Failed to drop jobs");
    let client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let transaction = client.begin_transaction().await.expect("Failed to begin transaction");
    let queued = client
        .enqueue_tournament_stats_jobs(&[123], CORRELATION_ID)
        .await
        .expect("A database without jobs should queue nothing, not fail");
    transaction.commit().await.expect("Failed to commit transaction");

    assert_eq!(queued, 0);
}

/// Only a missing table is tolerated: any other failed insert fails the run.
#[tokio::test]
#[serial]
async fn test_enqueue_tournament_stats_jobs_fails_when_the_insert_fails() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    let check_client = test_db.get_client().await.expect("Failed to get client");
    check_client
        .batch_execute("ALTER TABLE jobs ADD CONSTRAINT refuse_inserts CHECK (false) NOT VALID")
        .await
        .expect("Failed to make jobs refuse inserts");
    let client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let transaction = client.begin_transaction().await.expect("Failed to begin transaction");
    let result = client.enqueue_tournament_stats_jobs(&[123], CORRELATION_ID).await;
    transaction.rollback().await.expect("Failed to rollback transaction");

    assert!(result.is_err(), "A failed insert should fail, got {result:?}");
}
