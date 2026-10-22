//! Ranks a full run saves, read back from the database.

use serial_test::serial;

use super::test_helpers::{processor, processor_binary, TestDatabase};
use crate::common::init_test_env;

/// A player osu! reports as not found has no ruleset data, but their verified
/// scores still count, so the run rates them from a fallback rating. They must
/// take a place in their country's ranking like any compatriot.
#[tokio::test]
#[serial]
async fn test_player_without_ruleset_data_is_ranked_in_their_country() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");
    let client = test_db.get_client().await.expect("Failed to get client");

    // The seed's two US players play game 3, which this player joins.
    let player_id: i32 = client
        .query_one(
            "INSERT INTO players (username, osu_id, country) VALUES ('NotFound', 1005, 'US') RETURNING id",
            &[]
        )
        .await
        .expect("Failed to insert player")
        .get(0);
    client
        .execute(
            "INSERT INTO game_scores (player_id, game_id, raw_score, max_combo, placement, accuracy, pass, is_perfect_combo, legacy_perfect, legacy_total_score, grade, mods, team, ruleset, verification_status, rejection_reason)
             SELECT $1, id, 500000, 300, 3, 0.95, true, false, false, 500000, 0, 0, 0, 0, 4, 0
             FROM games
             WHERE osu_id = 3",
            &[&player_id]
        )
        .await
        .expect("Failed to insert score");

    let run = processor(processor_binary(), &test_db)
        .output()
        .expect("Failed to run processor");
    assert!(
        run.status.success(),
        "Processor run failed ({}):\n{}",
        run.status,
        String::from_utf8_lossy(&run.stderr)
    );

    // Country ranks in global order, osu! only, as the seed plays no other ruleset
    let us_ranks: Vec<i32> = client
        .query(
            "
            SELECT pr.country_rank
            FROM player_ratings pr
            JOIN players p ON p.id = pr.player_id
            WHERE p.country = 'US' AND pr.ruleset = 0
            ORDER BY pr.global_rank
            ",
            &[]
        )
        .await
        .expect("Failed to read ratings")
        .iter()
        .map(|row| row.get(0))
        .collect();

    assert_eq!(us_ranks, vec![1, 2, 3]);
}
