use chrono::{DateTime, Duration, FixedOffset, Utc};
use otr_processor::{
    database::{db::DbClient, db_structs::*, error::DbError},
    model::structures::{rating_adjustment_type::RatingAdjustmentType, ruleset::Ruleset}
};
use serial_test::serial;

use super::test_helpers::TestDatabase;
use crate::common::init_test_env;

#[tokio::test]
#[serial]
async fn test_get_players() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let players = db_client.get_players().await.expect("Failed to fetch players");

    assert_eq!(players.len(), 4);
    assert_eq!(players[0].username, Some("TestPlayer1".to_string()));
    assert_eq!(players[1].username, Some("TestPlayer2".to_string()));
    assert_eq!(players[2].username, Some("TestPlayer3".to_string()));
    assert_eq!(players[3].username, Some("TestPlayer4".to_string()));

    // Check player ruleset data
    assert!(players[0].ruleset_data.is_some());
    let ruleset_data = players[0].ruleset_data.as_ref().unwrap();
    assert_eq!(ruleset_data.len(), 1);
    assert_eq!(ruleset_data[0].ruleset, Ruleset::Osu);
    assert_eq!(ruleset_data[0].global_rank, Some(1000));
}

#[tokio::test]
#[serial]
async fn test_get_players_keeps_all_rulesets_at_batch_boundary() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    let admin_client = test_db.get_client().await.expect("Failed to get client");

    admin_client
        .batch_execute(
            "
            INSERT INTO players (username, osu_id, country)
            SELECT 'BatchPlayer' || player_number, 100000 + player_number, 'US'
            FROM generate_series(1, 5000) AS player_number;

            INSERT INTO player_osu_ruleset_data (player_id, ruleset, pp, global_rank)
            SELECT id, 0, 1000.0, id
            FROM players;

            INSERT INTO player_osu_ruleset_data (player_id, ruleset, pp, global_rank)
            SELECT id, 1, 1000.0, id
            FROM players
            ORDER BY id DESC
            LIMIT 1;
            "
        )
        .await
        .expect("Failed to seed players at the batch boundary");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    let players = db_client.get_players().await.expect("Failed to fetch players");

    assert_eq!(players.len(), 5000);
    let boundary_rulesets = players
        .last()
        .and_then(|player| player.ruleset_data.as_ref())
        .expect("Boundary player should have ruleset data");
    assert_eq!(boundary_rulesets.len(), 2);
    assert_eq!(boundary_rulesets[0].ruleset, Ruleset::Osu);
    assert_eq!(boundary_rulesets[1].ruleset, Ruleset::Taiko);
}

#[tokio::test]
#[serial]
async fn test_get_players_keeps_earliest_rank_when_current_rank_is_null() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    let admin_client = test_db.get_client().await.expect("Failed to get client");

    let player_id: i32 = admin_client
        .query_one(
            "
            INSERT INTO players (username, osu_id, country)
            VALUES ('FormerlyRankedPlayer', 123456, 'US')
            RETURNING id
            ",
            &[]
        )
        .await
        .expect("Failed to insert player")
        .get("id");
    admin_client
        .execute(
            "
            INSERT INTO player_osu_ruleset_data
                (player_id, ruleset, pp, global_rank, earliest_global_rank)
            VALUES ($1, 0, 0.0, NULL, 1234)
            ",
            &[&player_id]
        )
        .await
        .expect("Failed to insert nullable current rank");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    let players = db_client.get_players().await.expect("Failed to fetch players");

    assert_eq!(players.len(), 1);
    let ruleset_data = players[0]
        .ruleset_data
        .as_ref()
        .expect("Player should have ruleset data");
    assert_eq!(ruleset_data.len(), 1);
    assert_eq!(ruleset_data[0].global_rank, None);
    assert_eq!(ruleset_data[0].earliest_global_rank, Some(1234));
}

#[tokio::test]
#[serial]
async fn test_get_matches() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let matches = db_client.get_matches().await.expect("Failed to fetch matches");

    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].id, 1);
    assert_eq!(matches[1].id, 2);

    // Check games
    assert_eq!(matches[0].games.len(), 2);
    assert_eq!(matches[1].games.len(), 1);

    // Check scores
    assert_eq!(matches[0].games[0].scores.len(), 4);
    assert_eq!(matches[0].games[1].scores.len(), 4);
    assert_eq!(matches[1].games[0].scores.len(), 2);
}

#[tokio::test]
#[serial]
async fn test_get_matches_orders_by_start_time_and_skips_unratable_games() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    // The second match now starts first, and its only game keeps one verified score.
    let admin_client = test_db.get_client().await.expect("Failed to get client");
    admin_client
        .batch_execute(
            "
            UPDATE matches SET start_time = '2023-12-31 12:00:00+00' WHERE osu_id = 12346;

            UPDATE game_scores SET verification_status = 3
            WHERE id = (
                SELECT MIN(gs.id)
                FROM game_scores gs
                JOIN games g ON g.id = gs.game_id
                WHERE g.osu_id = 3
            );
            "
        )
        .await
        .expect("Failed to adjust seeded matches");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    let matches = db_client.get_matches().await.expect("Failed to fetch matches");

    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].name, "Test Match 2");
    assert!(
        matches[0].games.is_empty(),
        "A game with one verified score should be skipped"
    );

    assert_eq!(matches[1].name, "Test Match 1");
    let game_ids: Vec<i32> = matches[1].games.iter().map(|game| game.id).collect();
    assert!(game_ids.is_sorted(), "Games should be in id order");
    for game in &matches[1].games {
        let score_ids: Vec<i32> = game.scores.iter().map(|score| score.id).collect();
        assert!(score_ids.is_sorted(), "Scores should be in id order");
        assert!(game.scores.iter().all(|score| score.game_id == game.id));
    }
}

#[tokio::test]
#[serial]
async fn test_get_tournament_info_requires_a_scored_game() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    // A verified tournament whose only verified match has no games.
    let admin_client = test_db.get_client().await.expect("Failed to get client");
    admin_client
        .batch_execute(
            "
            INSERT INTO tournaments
                (name, abbreviation, forum_url, rank_range_lower_bound, ruleset, lobby_size, verification_status)
            VALUES ('Empty Tournament', 'ET', 'https://example.com/empty', 0, 0, 8, 4);

            INSERT INTO matches (osu_id, name, start_time, end_time, verification_status, tournament_id)
            SELECT 22222, 'Empty Match', '2024-02-01 12:00:00+00', '2024-02-01 13:00:00+00', 4, id
            FROM tournaments
            WHERE abbreviation = 'ET';
            "
        )
        .await
        .expect("Failed to seed an empty tournament");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    let matches = db_client.get_matches().await.expect("Failed to fetch matches");
    assert_eq!(matches.len(), 3);

    let tournaments = db_client
        .get_tournament_info_for_matches(&matches)
        .await
        .expect("Failed to fetch tournament info");
    let names: Vec<&str> = tournaments.values().map(|info| info.name.as_str()).collect();
    assert_eq!(names, vec!["Test Tournament"]);
}

#[tokio::test]
#[serial]
async fn test_get_tournaments_needing_stats_refresh() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let admin_client = test_db.get_client().await.expect("Failed to get client");
    let tournament_id: i32 = admin_client
        .query_one("SELECT id FROM tournaments", &[])
        .await
        .expect("Failed to fetch tournament")
        .get(0);
    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    // A tournament without stats needs them.
    assert_eq!(
        db_client
            .get_tournaments_needing_stats_refresh(&[tournament_id])
            .await
            .expect("Failed to check stats"),
        vec![tournament_id]
    );

    // Stats created after every update are current. The seed never sets `updated`.
    admin_client
        .execute(
            "
            INSERT INTO player_tournament_stats
                (average_rating_delta, average_match_cost, average_score, average_placement,
                 average_accuracy, matches_played, matches_won, matches_lost, games_played,
                 games_won, games_lost, teammate_ids, player_id, tournament_id, created)
            SELECT 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '{}', MIN(id), $1, '2025-01-01 00:00:00+00'
            FROM players
            ",
            &[&tournament_id]
        )
        .await
        .expect("Failed to seed tournament stats");
    assert!(db_client
        .get_tournaments_needing_stats_refresh(&[tournament_id])
        .await
        .expect("Failed to check stats")
        .is_empty());

    // A score updated after the stats makes them stale.
    admin_client
        .execute(
            "UPDATE game_scores SET updated = '2025-01-02 00:00:00+00' WHERE id = (SELECT MIN(id) FROM game_scores)",
            &[]
        )
        .await
        .expect("Failed to update a score");
    assert_eq!(
        db_client
            .get_tournaments_needing_stats_refresh(&[tournament_id])
            .await
            .expect("Failed to check stats"),
        vec![tournament_id]
    );
}

#[tokio::test]
#[serial]
async fn test_delete_rejected_player_stats_removes_unverified_rosters() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let admin_client = test_db.get_client().await.expect("Failed to get client");

    // Each non-verified level, with verified data below it where the
    // verification inheritance triggers allow it. A tournament set back to
    // pre-verified keeps its verified match and game.
    let tournament_id: i32 = admin_client
        .query_one(
            "INSERT INTO tournaments (name, abbreviation, forum_url, rank_range_lower_bound, ruleset, lobby_size, verification_status)
             VALUES ('Pre-verified Tournament', 'PT', 'https://example.com/pt', 0, 0, 8, 2)
             RETURNING id",
            &[]
        )
        .await
        .expect("Failed to insert tournament")
        .get(0);
    let match_id: i32 = admin_client
        .query_one(
            "INSERT INTO matches (osu_id, name, start_time, end_time, verification_status, tournament_id)
             VALUES (12347, 'Test Match 3', '2024-01-03 12:00:00+00', '2024-01-03 13:00:00+00', 4, $1)
             RETURNING id",
            &[&tournament_id]
        )
        .await
        .expect("Failed to insert match")
        .get(0);
    admin_client
        .execute(
            "INSERT INTO games (osu_id, match_id, start_time, end_time, beatmap_id, ruleset, scoring_type, team_type, mods, verification_status)
             VALUES (4, $1, '2024-01-03 12:00:00+00', '2024-01-03 12:10:00+00', NULL, 0, 0, 0, 0, 4)",
            &[&match_id]
        )
        .await
        .expect("Failed to insert game");

    let match_ids: Vec<i32> = admin_client
        .query("SELECT id FROM matches ORDER BY osu_id", &[])
        .await
        .expect("Failed to fetch matches")
        .iter()
        .map(|row| row.get(0))
        .collect();
    let game_ids: Vec<i32> = admin_client
        .query("SELECT id FROM games ORDER BY osu_id", &[])
        .await
        .expect("Failed to fetch games")
        .iter()
        .map(|row| row.get(0))
        .collect();

    // The seed puts games 1 and 2 in match 1 and game 3 in match 2. Match 2
    // turns pre-rejected over its verified game 3, and game 2 is rejected
    // inside the still-verified match 1. Its scores go first, as the
    // rejection cascade would.
    admin_client
        .execute(
            "UPDATE matches SET verification_status = 1 WHERE id = $1",
            &[&match_ids[1]]
        )
        .await
        .expect("Failed to pre-reject match");
    admin_client
        .execute(
            "UPDATE game_scores SET verification_status = 3 WHERE game_id = $1",
            &[&game_ids[1]]
        )
        .await
        .expect("Failed to reject scores");
    admin_client
        .execute(
            "UPDATE games SET verification_status = 3 WHERE id = $1",
            &[&game_ids[1]]
        )
        .await
        .expect("Failed to reject game");

    // Rosters left over from when everything was verified.
    admin_client
        .execute(
            "INSERT INTO match_rosters (roster, team, score, match_id) SELECT '{1}', 1, 1, id FROM matches",
            &[]
        )
        .await
        .expect("Failed to seed match rosters");
    admin_client
        .execute(
            "INSERT INTO game_rosters (roster, team, score, game_id) SELECT '{1}', 1, 1, id FROM games",
            &[]
        )
        .await
        .expect("Failed to seed game rosters");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    db_client
        .delete_rejected_player_stats()
        .await
        .expect("Failed to delete rejected stats");

    let remaining_match_rosters: Vec<i32> = admin_client
        .query("SELECT match_id FROM match_rosters ORDER BY match_id", &[])
        .await
        .expect("Failed to fetch match rosters")
        .iter()
        .map(|row| row.get(0))
        .collect();
    assert_eq!(remaining_match_rosters, vec![match_ids[0]]);

    let remaining_game_rosters: Vec<i32> = admin_client
        .query("SELECT game_id FROM game_rosters ORDER BY game_id", &[])
        .await
        .expect("Failed to fetch game rosters")
        .iter()
        .map(|row| row.get(0))
        .collect();
    assert_eq!(remaining_game_rosters, vec![game_ids[0]]);
}

#[tokio::test]
#[serial]
async fn test_save_results() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    // Create test data with proper timestamp
    let timestamp = Utc::now().with_timezone(&FixedOffset::east_opt(0).unwrap());

    let player_ratings = vec![
        PlayerRating {
            id: 1,
            player_id: 1,
            ruleset: Ruleset::Osu,
            rating: 1500.0,
            volatility: 200.0,
            percentile: 0.75,
            global_rank: 100,
            country_rank: 10,
            adjustments: vec![RatingAdjustment {
                player_id: 1,
                adjustment_type: RatingAdjustmentType::Match,
                ruleset: Ruleset::Osu,
                rating_before: 1200.0,
                volatility_before: 300.0,
                rating_after: 1500.0,
                volatility_after: 200.0,
                timestamp,
                match_id: Some(1)
            }]
        },
        PlayerRating {
            id: 2,
            player_id: 2,
            ruleset: Ruleset::Osu,
            rating: 1400.0,
            volatility: 250.0,
            percentile: 0.65,
            global_rank: 200,
            country_rank: 20,
            adjustments: vec![RatingAdjustment {
                player_id: 2,
                adjustment_type: RatingAdjustmentType::Initial,
                ruleset: Ruleset::Osu,
                rating_before: 1200.0,
                volatility_before: 300.0,
                rating_after: 1400.0,
                volatility_after: 250.0,
                timestamp,
                match_id: None
            }]
        },
    ];

    // Save results
    db_client
        .save_results(&player_ratings)
        .await
        .expect("Failed to save results");

    // Verify data was saved
    let check_client = test_db.get_client().await.expect("Failed to get client");

    let rating_count: i64 = check_client
        .query_one("SELECT COUNT(*) FROM player_ratings", &[])
        .await
        .expect("Failed to query")
        .get(0);

    let adjustment_count: i64 = check_client
        .query_one("SELECT COUNT(*) FROM rating_adjustments", &[])
        .await
        .expect("Failed to query")
        .get(0);

    assert_eq!(rating_count, 2);
    assert_eq!(adjustment_count, 2); // We have 2 adjustments, one for each player rating
}

#[tokio::test]
#[serial]
async fn test_save_results_updates_global_and_country_highest_ranks_independently() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let admin_client = test_db.get_client().await.expect("Failed to get client");
    admin_client
        .execute(
            "UPDATE player_highest_ranks SET country_rank = 0 WHERE player_id = 3 AND ruleset = 0",
            &[]
        )
        .await
        .expect("Failed to seed an unknown country rank");

    let timestamp = DateTime::parse_from_rfc3339("2025-02-03T04:05:06+00:00").unwrap();
    let player_ratings = vec![
        player_rating_with_ranks(1, 0, 50, timestamp),
        player_rating_with_ranks(2, 1500, 250, timestamp),
        player_rating_with_ranks(3, 3000, 30, timestamp),
    ];

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    db_client
        .save_results(&player_ratings)
        .await
        .expect("Failed to save results");

    let rows = admin_client
        .query(
            "
            SELECT player_id, global_rank, global_rank_date, country_rank, country_rank_date
            FROM player_highest_ranks
            WHERE player_id = ANY($1)
            ORDER BY player_id
            ",
            &[&vec![1_i32, 2, 3]]
        )
        .await
        .expect("Failed to fetch highest ranks");
    let original_timestamp = DateTime::parse_from_rfc3339("2024-01-01T00:00:00+00:00").unwrap();

    assert_eq!(rows.len(), 3);

    // An unknown global rank does not replace the peak, while an improved country rank does.
    assert_eq!(rows[0].get::<_, i32>("global_rank"), 1000);
    assert_eq!(
        rows[0].get::<_, DateTime<FixedOffset>>("global_rank_date"),
        original_timestamp
    );
    assert_eq!(rows[0].get::<_, i32>("country_rank"), 50);
    assert_eq!(rows[0].get::<_, DateTime<FixedOffset>>("country_rank_date"), timestamp);

    // A global improvement does not overwrite a better stored country peak.
    assert_eq!(rows[1].get::<_, i32>("global_rank"), 1500);
    assert_eq!(rows[1].get::<_, DateTime<FixedOffset>>("global_rank_date"), timestamp);
    assert_eq!(rows[1].get::<_, i32>("country_rank"), 200);
    assert_eq!(
        rows[1].get::<_, DateTime<FixedOffset>>("country_rank_date"),
        original_timestamp
    );

    // A real country rank replaces a stored zero without changing the equal global peak.
    assert_eq!(rows[2].get::<_, i32>("global_rank"), 3000);
    assert_eq!(
        rows[2].get::<_, DateTime<FixedOffset>>("global_rank_date"),
        original_timestamp
    );
    assert_eq!(rows[2].get::<_, i32>("country_rank"), 30);
    assert_eq!(rows[2].get::<_, DateTime<FixedOffset>>("country_rank_date"), timestamp);
}

#[tokio::test]
#[serial]
async fn test_save_results_stores_first_highest_ranks_for_new_ratings() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    // The seed stores osu! peaks only, so a taiko rating has none yet.
    let timestamp = DateTime::parse_from_rfc3339("2025-02-03T04:05:06+00:00").unwrap();
    let mut taiko_rating = player_rating_with_ranks(1, 0, 7, timestamp);
    taiko_rating.ruleset = Ruleset::Taiko;
    taiko_rating.adjustments[0].ruleset = Ruleset::Taiko;

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    db_client
        .save_results(&[taiko_rating])
        .await
        .expect("Failed to save results");

    let admin_client = test_db.get_client().await.expect("Failed to get client");
    let row = admin_client
        .query_one(
            "
            SELECT global_rank, global_rank_date, country_rank, country_rank_date
            FROM player_highest_ranks
            WHERE player_id = 1 AND ruleset = $1
            ",
            &[&(Ruleset::Taiko as i32)]
        )
        .await
        .expect("A first taiko peak should be stored");

    // Unknown ranks are stored as they are.
    assert_eq!(row.get::<_, i32>("global_rank"), 0);
    assert_eq!(row.get::<_, DateTime<FixedOffset>>("global_rank_date"), timestamp);
    assert_eq!(row.get::<_, i32>("country_rank"), 7);
    assert_eq!(row.get::<_, DateTime<FixedOffset>>("country_rank_date"), timestamp);
}

#[tokio::test]
#[serial]
async fn test_save_results_links_each_adjustment_to_its_rating() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let timestamp = DateTime::parse_from_rfc3339("2025-02-03T04:05:06+00:00").unwrap();
    let mut taiko_rating = player_rating_with_ranks(1, 10, 1, timestamp);
    taiko_rating.ruleset = Ruleset::Taiko;
    taiko_rating.adjustments[0].ruleset = Ruleset::Taiko;
    taiko_rating.adjustments[0].rating_after = 1234.5;
    let player_ratings = vec![
        player_rating_with_ranks(2, 20, 2, timestamp),
        taiko_rating,
        player_rating_with_ranks(1, 30, 3, timestamp),
    ];

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    db_client
        .save_results(&player_ratings)
        .await
        .expect("Failed to save results");

    let admin_client = test_db.get_client().await.expect("Failed to get client");
    let rows = admin_client
        .query(
            "
            SELECT pr.player_id AS rating_player_id, pr.ruleset AS rating_ruleset,
                   ra.player_id, ra.ruleset, ra.rating_after, ra.timestamp
            FROM rating_adjustments ra
            JOIN player_ratings pr ON pr.id = ra.player_rating_id
            ORDER BY ra.player_id, ra.ruleset
            ",
            &[]
        )
        .await
        .expect("Failed to fetch adjustments");

    assert_eq!(rows.len(), 3);
    for row in &rows {
        assert_eq!(row.get::<_, i32>("rating_player_id"), row.get::<_, i32>("player_id"));
        assert_eq!(row.get::<_, i32>("rating_ruleset"), row.get::<_, i32>("ruleset"));
        assert_eq!(row.get::<_, DateTime<FixedOffset>>("timestamp"), timestamp);
    }
    assert_eq!(rows[1].get::<_, i32>("ruleset"), Ruleset::Taiko as i32);
    assert_eq!(rows[1].get::<_, f64>("rating_after"), 1234.5);
}

#[tokio::test]
#[serial]
async fn test_save_results_stores_each_value_in_its_own_column() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let admin_client = test_db.get_client().await.expect("Failed to get client");
    let match_ids: Vec<i32> = admin_client
        .query("SELECT id FROM matches ORDER BY osu_id", &[])
        .await
        .expect("Failed to fetch match ids")
        .iter()
        .map(|row| row.get(0))
        .collect();

    // COPY places values by position, so a column list out of order with its
    // values stores them in the wrong columns. Each row's values differ from
    // the others of their type, so any such swap changes what is read back.
    let initial_time = DateTime::parse_from_rfc3339("2025-01-06T10:00:00+00:00").unwrap();
    let match_time = DateTime::parse_from_rfc3339("2025-02-03T04:05:06+00:00").unwrap();
    let player_ratings = vec![
        PlayerRating {
            id: 0,
            player_id: 4,
            ruleset: Ruleset::Catch,
            rating: 1210.75,
            volatility: 305.5,
            percentile: 0.3125,
            global_rank: 1350,
            country_rank: 96,
            adjustments: vec![
                RatingAdjustment {
                    player_id: 4,
                    adjustment_type: RatingAdjustmentType::Initial,
                    ruleset: Ruleset::Catch,
                    rating_before: 900.0,
                    volatility_before: 390.0,
                    rating_after: 950.0,
                    volatility_after: 385.0,
                    timestamp: initial_time,
                    match_id: None
                },
                RatingAdjustment {
                    player_id: 4,
                    adjustment_type: RatingAdjustmentType::Match,
                    ruleset: Ruleset::Catch,
                    rating_before: 950.0,
                    volatility_before: 385.0,
                    rating_after: 1210.75,
                    volatility_after: 305.5,
                    timestamp: match_time,
                    match_id: Some(match_ids[0])
                },
            ]
        },
        PlayerRating {
            id: 0,
            player_id: 3,
            ruleset: Ruleset::Taiko,
            rating: 1834.5,
            volatility: 212.25,
            percentile: 0.875,
            global_rank: 42,
            country_rank: 7,
            adjustments: vec![
                RatingAdjustment {
                    player_id: 3,
                    adjustment_type: RatingAdjustmentType::Initial,
                    ruleset: Ruleset::Taiko,
                    rating_before: 1100.0,
                    volatility_before: 350.0,
                    rating_after: 1150.0,
                    volatility_after: 345.0,
                    timestamp: initial_time,
                    match_id: None
                },
                RatingAdjustment {
                    player_id: 3,
                    adjustment_type: RatingAdjustmentType::Match,
                    ruleset: Ruleset::Taiko,
                    rating_before: 1150.0,
                    volatility_before: 345.0,
                    rating_after: 1834.5,
                    volatility_after: 212.25,
                    timestamp: match_time,
                    match_id: Some(match_ids[1])
                },
            ]
        },
    ];

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    db_client
        .save_results(&player_ratings)
        .await
        .expect("Failed to save results");

    let rating_rows = admin_client
        .query(
            "
            SELECT id, player_id, ruleset, rating, volatility, percentile, global_rank, country_rank
            FROM player_ratings
            ORDER BY player_id
            ",
            &[]
        )
        .await
        .expect("Failed to fetch ratings");
    let stored_ratings: Vec<_> = rating_rows
        .iter()
        .map(|row| {
            (
                row.get::<_, i32>("player_id"),
                row.get::<_, i32>("ruleset"),
                row.get::<_, f64>("rating"),
                row.get::<_, f64>("volatility"),
                row.get::<_, f64>("percentile"),
                row.get::<_, i32>("global_rank"),
                row.get::<_, i32>("country_rank")
            )
        })
        .collect();
    assert_eq!(
        stored_ratings,
        vec![
            (3, Ruleset::Taiko as i32, 1834.5, 212.25, 0.875, 42, 7),
            (4, Ruleset::Catch as i32, 1210.75, 305.5, 0.3125, 1350, 96),
        ]
    );

    let rating_id = |player_id: i32| -> i32 {
        rating_rows
            .iter()
            .find(|row| row.get::<_, i32>("player_id") == player_id)
            .expect("Every player's rating should be stored")
            .get("id")
    };
    let stored_adjustments: Vec<_> = admin_client
        .query(
            "
            SELECT player_id, ruleset, player_rating_id, match_id, rating_before, rating_after,
                   volatility_before, volatility_after, timestamp, adjustment_type
            FROM rating_adjustments
            ORDER BY player_id, timestamp
            ",
            &[]
        )
        .await
        .expect("Failed to fetch adjustments")
        .iter()
        .map(|row| {
            (
                row.get::<_, i32>("player_id"),
                row.get::<_, i32>("ruleset"),
                row.get::<_, i32>("player_rating_id"),
                row.get::<_, Option<i32>>("match_id"),
                row.get::<_, f64>("rating_before"),
                row.get::<_, f64>("rating_after"),
                row.get::<_, f64>("volatility_before"),
                row.get::<_, f64>("volatility_after"),
                row.get::<_, DateTime<FixedOffset>>("timestamp"),
                row.get::<_, i32>("adjustment_type")
            )
        })
        .collect();
    let initial = RatingAdjustmentType::Initial as i32;
    let match_type = RatingAdjustmentType::Match as i32;
    assert_eq!(
        stored_adjustments,
        vec![
            (
                3,
                Ruleset::Taiko as i32,
                rating_id(3),
                None,
                1100.0,
                1150.0,
                350.0,
                345.0,
                initial_time,
                initial
            ),
            (
                3,
                Ruleset::Taiko as i32,
                rating_id(3),
                Some(match_ids[1]),
                1150.0,
                1834.5,
                345.0,
                212.25,
                match_time,
                match_type
            ),
            (
                4,
                Ruleset::Catch as i32,
                rating_id(4),
                None,
                900.0,
                950.0,
                390.0,
                385.0,
                initial_time,
                initial
            ),
            (
                4,
                Ruleset::Catch as i32,
                rating_id(4),
                Some(match_ids[0]),
                950.0,
                1210.75,
                385.0,
                305.5,
                match_time,
                match_type
            ),
        ]
    );
}

#[tokio::test]
#[serial]
async fn test_save_results_refuses_empty_ratings() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let timestamp = DateTime::parse_from_rfc3339("2025-02-03T04:05:06+00:00").unwrap();
    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");
    db_client
        .save_results(&[player_rating_with_ranks(1, 10, 1, timestamp)])
        .await
        .expect("Failed to save results");

    let result = db_client.save_results(&[]).await;
    assert!(matches!(result, Err(DbError::NoRatings)), "Got {result:?}");

    let admin_client = test_db.get_client().await.expect("Failed to get client");
    let rating_count: i64 = admin_client
        .query_one("SELECT COUNT(*) FROM player_ratings", &[])
        .await
        .expect("Failed to count ratings")
        .get(0);
    assert_eq!(rating_count, 1, "Existing ratings should be kept");
}

fn player_rating_with_ranks(
    player_id: i32,
    global_rank: i32,
    country_rank: i32,
    timestamp: DateTime<FixedOffset>
) -> PlayerRating {
    PlayerRating {
        id: 0,
        player_id,
        ruleset: Ruleset::Osu,
        rating: 1500.0,
        volatility: 200.0,
        percentile: 0.5,
        global_rank,
        country_rank,
        adjustments: vec![RatingAdjustment {
            player_id,
            adjustment_type: RatingAdjustmentType::Initial,
            ruleset: Ruleset::Osu,
            rating_before: 1500.0,
            volatility_before: 200.0,
            rating_after: 1500.0,
            volatility_after: 200.0,
            timestamp,
            match_id: None
        }]
    }
}

#[tokio::test]
#[serial]
async fn test_detects_tournaments_with_changed_match_rating_adjustments() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    let admin_client = test_db.get_client().await.expect("Failed to get client");
    let identifiers = admin_client
        .query_one(
            "
            SELECT m.id AS match_id, m.tournament_id
            FROM matches m
            ORDER BY m.id
            LIMIT 1
            ",
            &[]
        )
        .await
        .expect("Failed to fetch tournament identifiers");
    let match_id: i32 = identifiers.get("match_id");
    let tournament_id: i32 = identifiers.get("tournament_id");
    let timestamp = DateTime::parse_from_rfc3339("2025-02-03T04:05:06+00:00").unwrap();
    let previous_ratings = vec![player_rating_with_match_adjustment(1, match_id, 1500.0, timestamp)];

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let initial_transaction = db_client
        .begin_transaction()
        .await
        .expect("Failed to begin transaction");
    db_client
        .save_results(&previous_ratings)
        .await
        .expect("Failed to save results");
    initial_transaction
        .commit()
        .await
        .expect("Failed to commit initial ratings");

    // Rewriting identical adjustment values should not invalidate the tournament.
    let unchanged_transaction = db_client
        .begin_transaction()
        .await
        .expect("Failed to begin transaction");
    db_client
        .snapshot_match_rating_adjustments()
        .await
        .expect("Failed to snapshot adjustments");
    db_client
        .save_results(&previous_ratings)
        .await
        .expect("Failed to save results");
    assert!(db_client
        .get_tournaments_with_changed_rating_adjustments()
        .await
        .expect("Failed to compare adjustments")
        .is_empty());
    unchanged_transaction
        .rollback()
        .await
        .expect("Failed to rollback unchanged case");

    // A changed numeric rating output should invalidate its tournament.
    let mut changed_ratings = previous_ratings.clone();
    changed_ratings[0].rating = 1510.0;
    changed_ratings[0].adjustments.last_mut().unwrap().rating_after = 1510.0;
    let changed_transaction = db_client
        .begin_transaction()
        .await
        .expect("Failed to begin transaction");
    db_client
        .snapshot_match_rating_adjustments()
        .await
        .expect("Failed to snapshot adjustments");
    db_client
        .save_results(&changed_ratings)
        .await
        .expect("Failed to save results");
    assert_eq!(
        db_client
            .get_tournaments_with_changed_rating_adjustments()
            .await
            .expect("Failed to compare adjustments"),
        vec![tournament_id]
    );
    changed_transaction
        .rollback()
        .await
        .expect("Failed to rollback changed case");

    // Adding a new player's match adjustment should also invalidate the tournament.
    let mut added_ratings = previous_ratings.clone();
    added_ratings.push(player_rating_with_match_adjustment(2, match_id, 1400.0, timestamp));
    let added_transaction = db_client
        .begin_transaction()
        .await
        .expect("Failed to begin transaction");
    db_client
        .snapshot_match_rating_adjustments()
        .await
        .expect("Failed to snapshot adjustments");
    db_client
        .save_results(&added_ratings)
        .await
        .expect("Failed to save results");
    assert_eq!(
        db_client
            .get_tournaments_with_changed_rating_adjustments()
            .await
            .expect("Failed to compare adjustments"),
        vec![tournament_id]
    );
    added_transaction
        .rollback()
        .await
        .expect("Failed to rollback added case");

    // Removing an existing match adjustment should invalidate the tournament.
    let removed_transaction = db_client
        .begin_transaction()
        .await
        .expect("Failed to begin transaction");
    db_client
        .snapshot_match_rating_adjustments()
        .await
        .expect("Failed to snapshot adjustments");
    db_client
        .client()
        .execute("DELETE FROM rating_adjustments WHERE match_id = $1", &[&match_id])
        .await
        .expect("Failed to remove match adjustment");
    assert_eq!(
        db_client
            .get_tournaments_with_changed_rating_adjustments()
            .await
            .expect("Failed to compare adjustments"),
        vec![tournament_id]
    );
    removed_transaction
        .rollback()
        .await
        .expect("Failed to rollback removed case");

    // Initial and decay adjustments are not inputs to per-match tournament statistics.
    let non_match_transaction = db_client
        .begin_transaction()
        .await
        .expect("Failed to begin transaction");
    db_client
        .snapshot_match_rating_adjustments()
        .await
        .expect("Failed to snapshot adjustments");
    db_client
        .client()
        .execute(
            "UPDATE rating_adjustments SET rating_after = rating_after + 10 WHERE match_id IS NULL",
            &[]
        )
        .await
        .expect("Failed to change non-match adjustment");
    assert!(db_client
        .get_tournaments_with_changed_rating_adjustments()
        .await
        .expect("Failed to compare adjustments")
        .is_empty());
    non_match_transaction
        .rollback()
        .await
        .expect("Failed to rollback non-match case");

    // Rejected tournaments are not eligible for downstream stats processing.
    let rejected_transaction = db_client
        .begin_transaction()
        .await
        .expect("Failed to begin transaction");
    db_client
        .snapshot_match_rating_adjustments()
        .await
        .expect("Failed to snapshot adjustments");
    db_client
        .client()
        .execute(
            "UPDATE rating_adjustments SET rating_after = rating_after + 10 WHERE match_id = $1",
            &[&match_id]
        )
        .await
        .expect("Failed to change match adjustment");
    db_client
        .client()
        .execute(
            "UPDATE tournaments SET verification_status = 3 WHERE id = $1",
            &[&tournament_id]
        )
        .await
        .expect("Failed to reject tournament");
    assert!(db_client
        .get_tournaments_with_changed_rating_adjustments()
        .await
        .expect("Failed to compare adjustments")
        .is_empty());
    rejected_transaction
        .rollback()
        .await
        .expect("Failed to rollback rejected case");
}

fn player_rating_with_match_adjustment(
    player_id: i32,
    match_id: i32,
    rating_after: f64,
    timestamp: DateTime<FixedOffset>
) -> PlayerRating {
    PlayerRating {
        id: 0,
        player_id,
        ruleset: Ruleset::Osu,
        rating: rating_after,
        volatility: 200.0,
        percentile: 0.5,
        global_rank: player_id * 100,
        country_rank: player_id * 10,
        adjustments: vec![
            RatingAdjustment {
                player_id,
                adjustment_type: RatingAdjustmentType::Initial,
                ruleset: Ruleset::Osu,
                rating_before: 0.0,
                volatility_before: 0.0,
                rating_after: 1200.0,
                volatility_after: 400.0,
                timestamp: timestamp - Duration::seconds(1),
                match_id: None
            },
            RatingAdjustment {
                player_id,
                adjustment_type: RatingAdjustmentType::Match,
                ruleset: Ruleset::Osu,
                rating_before: 1200.0,
                volatility_before: 400.0,
                rating_after,
                volatility_after: 200.0,
                timestamp,
                match_id: Some(match_id)
            },
        ]
    }
}

#[tokio::test]
#[serial]
async fn test_empty_database() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    // Don't seed data

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    let players = db_client.get_players().await.expect("Failed to fetch players");
    let matches = db_client.get_matches().await.expect("Failed to fetch matches");

    assert_eq!(players.len(), 0);
    assert_eq!(matches.len(), 0);
}

#[tokio::test]
#[serial]
async fn test_calculate_and_update_game_score_placements() {
    init_test_env();
    let test_db = TestDatabase::new().await.expect("Failed to create test database");
    test_db.seed_test_data().await.expect("Failed to seed test data");

    // Scramble existing placements and mark one score as unverified to exercise both paths.
    let admin_client = test_db.get_client().await.expect("Failed to get client");
    admin_client
        .execute(
            "
            UPDATE game_scores
            SET placement = 99
            WHERE game_id = (SELECT game_id FROM game_scores ORDER BY game_id LIMIT 1)
        ",
            &[]
        )
        .await
        .expect("Failed to scramble placements");
    admin_client
        .execute(
            "
            UPDATE game_scores
            SET verification_status = 3
            WHERE id = (SELECT id FROM game_scores ORDER BY id LIMIT 1)
        ",
            &[]
        )
        .await
        .expect("Failed to mark a score as unverified");
    // Force a tied score pair within one game to exercise shared placements
    admin_client
        .execute(
            "
            UPDATE game_scores
            SET raw_score = tied.max_score
            FROM (
                SELECT game_id, MAX(score) AS max_score
                FROM game_scores
                WHERE verification_status = 4
                GROUP BY game_id
                HAVING COUNT(*) >= 2
                ORDER BY game_id
                LIMIT 1
            ) AS tied
            WHERE game_scores.game_id = tied.game_id
                AND game_scores.verification_status = 4
        ",
            &[]
        )
        .await
        .expect("Failed to create tied scores");

    let db_client = DbClient::connect(&test_db.connection_string)
        .await
        .expect("Failed to connect");

    db_client
        .calculate_and_update_game_score_placements()
        .await
        .expect("Failed to update placements");

    let rows = admin_client
        .query(
            "
            SELECT game_id, score, verification_status, placement
            FROM game_scores
            ORDER BY game_id, score DESC, id
        ",
            &[]
        )
        .await
        .expect("Failed to fetch placements");

    // Collect (game_id, score, verification_status, placement) tuples
    let scores: Vec<(i32, i32, i32, i32)> = rows
        .iter()
        .map(|row| {
            (
                row.get("game_id"),
                row.get("score"),
                row.get("verification_status"),
                row.get("placement")
            )
        })
        .collect();

    let mut saw_shared_placement = false;
    for &(game_id, score, verification_status, placement) in &scores {
        if verification_status != 4 {
            assert_eq!(
                placement, 0,
                "Unverified score in game {} should have placement 0",
                game_id
            );
            continue;
        }

        // Tie-aware rank: 1 + number of verified scores in the same game
        // with a strictly higher score. Tied scores share a placement and
        // the following placement is skipped.
        let expected_placement = 1 + scores
            .iter()
            .filter(|&&(g, s, vs, _)| g == game_id && vs == 4 && s > score)
            .count() as i32;

        assert_eq!(
            placement, expected_placement,
            "Verified score in game {} should have tie-aware placement",
            game_id
        );

        let sharing = scores
            .iter()
            .filter(|&&(g, _, vs, p)| g == game_id && vs == 4 && p == placement)
            .count();
        if sharing > 1 {
            saw_shared_placement = true;
        }
    }

    assert!(
        saw_shared_placement,
        "Fixture should include at least one tied pair sharing a placement"
    );
}
