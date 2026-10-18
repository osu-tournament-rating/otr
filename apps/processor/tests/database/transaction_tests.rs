use otr_processor::{
    database::{
        db::DbClient,
        db_structs::{Match, Player, PlayerRating}
    },
    model::{otr_model::OtrModel, rating_utils::create_initial_ratings},
    utils::test_utils::generate_country_mapping_players
};
use serial_test::serial;
use tokio_postgres::Client;

use super::test_helpers::{row_count, snapshot, TestDatabase};
use crate::common::init_test_env;

/// The tables `save_results` rewrites
const SAVED_TABLES: [&str; 3] = ["player_ratings", "rating_adjustments", "player_highest_ranks"];

fn process(players: &[Player], matches: &[Match]) -> Vec<PlayerRating> {
    let initial_ratings = create_initial_ratings(players, matches);
    OtrModel::new(&initial_ratings, &generate_country_mapping_players(players)).process(matches)
}

async fn saved_tables(client: &Client) -> Vec<String> {
    let mut snapshots = Vec::new();
    for table in SAVED_TABLES {
        snapshots.push(snapshot(client, table).await);
    }
    snapshots
}

#[tokio::test]
#[serial]
async fn test_begin_transaction_uses_repeatable_read() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    let client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let transaction = client.begin_transaction().await.expect("Failed to begin transaction");
    let isolation_level: String = client
        .client()
        .query_one("SHOW transaction_isolation", &[])
        .await
        .expect("Failed to inspect transaction isolation")
        .get(0);

    assert_eq!(isolation_level, "repeatable read");
    transaction.rollback().await.expect("Failed to rollback transaction");
}

/// A run that saves its results and then rolls back must leave the previous
/// run's committed results as they were. This checks that every write of
/// `save_results` stays inside the caller's transaction, and that the
/// transaction guard's rollback undoes them.
#[tokio::test]
#[serial]
async fn test_partial_processing_rollback() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");
    let check_client = test_db.get_client().await.expect("Failed to get client");

    let client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    let matches = client.get_matches().await.expect("Failed to fetch matches");
    let players = client.get_players().await.expect("Failed to fetch players");

    // The previous run commits its results
    let transaction = client.begin_transaction().await.expect("Failed to begin transaction");
    client
        .save_results(&process(&players, &matches))
        .await
        .expect("Failed to save results");
    transaction.commit().await.expect("Failed to commit transaction");

    assert!(
        row_count(&check_client, "player_ratings").await > 0,
        "Run should save ratings"
    );
    assert!(
        row_count(&check_client, "rating_adjustments").await > 0,
        "Run should save rating adjustments"
    );

    // Stored peaks the next run beats, so it writes highest ranks too
    check_client
        .execute(
            "UPDATE player_highest_ranks SET global_rank = global_rank + 100, country_rank = country_rank + 100",
            &[]
        )
        .await
        .expect("Failed to lower stored peaks");
    let committed = saved_tables(&check_client).await;

    // The next run, over fewer matches, saves different results before it fails
    let transaction = client.begin_transaction().await.expect("Failed to begin transaction");
    client
        .save_results(&process(&players, &matches[..1]))
        .await
        .expect("Failed to save results");

    let saved = saved_tables(&client.client()).await;
    for ((table, before), after) in SAVED_TABLES.iter().zip(&committed).zip(&saved) {
        assert_ne!(after, before, "Run should rewrite {table} within its transaction");
    }

    transaction.rollback().await.expect("Failed to rollback transaction");

    assert_eq!(
        saved_tables(&check_client).await,
        committed,
        "Rollback should keep the last committed run"
    );
}
