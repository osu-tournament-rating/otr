use chrono::{DateTime, Utc};
use otr_processor::receipt::RECEIPT_PREFIX;
use serde_json::Value;
use serial_test::serial;
use std::process::{Output, Stdio};

use super::test_helpers::{processor, processor_binary, row_count, TestDatabase};
use crate::common::init_test_env;

fn run(test_db: &TestDatabase) -> Output {
    processor(processor_binary(), test_db)
        .stdout(Stdio::piped())
        .output()
        .expect("Failed to run processor")
}

fn timestamp(receipt: &Value, field: &str) -> DateTime<Utc> {
    let value = receipt[field]
        .as_str()
        .unwrap_or_else(|| panic!("{field} is not a string"));
    DateTime::parse_from_rfc3339(value)
        .unwrap_or_else(|e| panic!("{field} {value} is not RFC 3339: {e}"))
        .with_timezone(&Utc)
}

/// The scripts read the receipt from the run's stdout, so a committed run
/// prints it as the only line there, and it describes what was committed.
#[tokio::test]
#[serial]
async fn test_committed_run_prints_its_receipt_as_the_only_stdout_line() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");
    let check_client = test_db.get_client().await.expect("Failed to get client");

    let before = Utc::now();
    let output = run(&test_db);
    let after = Utc::now();
    assert!(
        output.status.success(),
        "Processor run failed ({}):\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout is not UTF-8");
    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines.len(), 1, "stdout should hold only the receipt:\n{stdout}");
    let json = lines[0]
        .strip_prefix(RECEIPT_PREFIX)
        .unwrap_or_else(|| panic!("the line does not start with {RECEIPT_PREFIX}: {}", lines[0]));
    let receipt: Value = serde_json::from_str(json).expect("the receipt is not JSON");

    // The seed has four players with osu! data, one verified tournament with
    // two verified matches, and no stats, so the run rates all four players in
    // osu! and queues one stats job.
    assert_eq!(receipt["counts"]["matches"], 2);
    assert_eq!(receipt["counts"]["players"], 4);
    assert_eq!(receipt["counts"]["tournaments"], 1);
    assert_eq!(
        receipt["counts"]["ratings"],
        row_count(&check_client, "player_ratings").await
    );
    assert_eq!(receipt["counts"]["stats_jobs"], row_count(&check_client, "jobs").await);
    assert_eq!(receipt["counts"]["stats_jobs"], 1);

    // The run id is the correlation id of the stats jobs the run queued.
    let correlation_id: String = check_client
        .query_one("SELECT correlation_id FROM jobs", &[])
        .await
        .expect("Failed to read the queued job")
        .get(0);
    assert_eq!(receipt["run_id"], correlation_id.as_str());

    let started_at = timestamp(&receipt, "started_at");
    let decay_horizon = timestamp(&receipt, "decay_horizon");
    let committed_at = timestamp(&receipt, "committed_at");
    assert!(
        before <= started_at,
        "started {started_at}, before the run began at {before}"
    );
    assert!(
        started_at <= decay_horizon,
        "decayed to {decay_horizon}, before the start {started_at}"
    );
    assert!(
        decay_horizon <= committed_at,
        "decayed to {decay_horizon}, after the commit {committed_at}"
    );
    assert!(
        committed_at <= after,
        "committed {committed_at}, after the run ended at {after}"
    );
}

/// A run that rolls back published nothing, so it prints no receipt.
#[tokio::test]
#[serial]
async fn test_rolled_back_run_prints_no_receipt() {
    init_test_env();
    // With no players, the run has no ratings to save and rolls back.
    let test_db = TestDatabase::new().await.expect("Failed to create test database");

    let output = run(&test_db);

    assert!(!output.status.success(), "a run with no ratings should fail");
    assert_eq!(String::from_utf8_lossy(&output.stdout), "");
}
