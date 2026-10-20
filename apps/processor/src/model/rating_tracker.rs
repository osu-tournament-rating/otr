use std::{cmp::Ordering, collections::HashMap};

use indexmap::IndexMap;
use itertools::Itertools;
use tracing::{debug, trace};

use crate::database::db_structs::{PlayerRating, RatingAdjustment};

use super::structures::ruleset::Ruleset;

/// Manages and tracks player ratings across all rulesets
///
/// The RatingTracker maintains both global and country-specific leaderboards,
/// handling the following responsibilities:
/// - Storing and updating player ratings
/// - Maintaining global and country rankings
/// - Calculating percentiles
/// - Managing rating history through adjustments
///
/// # Implementation Details
/// - Uses IndexMap for ordered storage of ratings
/// - Maintains separate country leaderboards
/// - Updates rankings efficiently through batch processing
/// - Ensures consistency between global and country rankings
pub struct RatingTracker {
    /// Global leaderboard storing all player ratings
    /// Key: (player_id, ruleset)
    ///
    /// This is the source of truth for current ratings
    leaderboard: IndexMap<(i32, Ruleset), PlayerRating>,

    /// Per-country leaderboards for country ranking calculations
    /// Key: country_code
    ///
    /// These leaderboards mirror the global leaderboard but are
    /// filtered by country for efficient country rank calculations
    country_leaderboards: HashMap<String, IndexMap<(i32, Ruleset), PlayerRating>>,

    /// Maps player IDs to their country codes
    country_mapping: HashMap<i32, String>
}

impl Default for RatingTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl RatingTracker {
    /// Creates a new, empty RatingTracker
    pub fn new() -> Self {
        RatingTracker {
            leaderboard: IndexMap::new(),
            country_leaderboards: HashMap::new(),
            country_mapping: HashMap::new()
        }
    }

    /// Returns all current player ratings across all rulesets, ordered by
    /// player id and then ruleset
    ///
    /// This is typically used when saving the final state of all ratings
    /// to the database after processing matches. Ratings are saved in this
    /// order, so it decides their ids, and it is the same every run.
    pub fn get_all_ratings(&self) -> Vec<PlayerRating> {
        self.leaderboard
            .values()
            .sorted_by_key(|rating| (rating.player_id, rating.ruleset as i32))
            .cloned()
            .collect()
    }

    /// Sets the mapping of player IDs to country codes
    ///
    /// This mapping is used to:
    /// 1. Organize country-specific leaderboards
    /// 2. Calculate country rankings
    /// 3. Group players by region
    pub fn set_country_mapping(&mut self, country_mapping: HashMap<i32, String>) {
        self.country_mapping = country_mapping;
    }

    /// Updates or inserts player ratings into the tracker
    ///
    /// # Details
    /// - Ratings are typically updated after each match is processed
    /// - Updates both global and country leaderboards
    /// - Maintains rating history through adjustments
    /// - Does not automatically update rankings (call `sort()` for that)
    ///
    /// # Arguments
    /// * `ratings` - Slice of PlayerRating objects to update
    pub fn insert_or_update(&mut self, ratings: &[PlayerRating]) {
        trace!(count = ratings.len(), "Inserting/updating ratings");
        for rating in ratings {
            let cloned_rating = rating.clone();
            self.leaderboard
                .insert((rating.player_id, rating.ruleset), cloned_rating);
        }
    }

    /// Retrieves a player's current rating for a specific ruleset
    ///
    /// # Arguments
    /// * `player_id` - The player id
    /// * `ruleset` - The osu! ruleset to get the rating for
    ///
    /// # Returns
    /// Returns None if the player has no rating for the specified ruleset
    pub fn get_rating(&self, player_id: i32, ruleset: Ruleset) -> Option<&PlayerRating> {
        self.leaderboard.get(&(player_id, ruleset))
    }

    /// Returns a player's rating for a ruleset to change in place, or None if
    /// the player has no rating for it
    pub fn get_rating_mut(&mut self, player_id: i32, ruleset: Ruleset) -> Option<&mut PlayerRating> {
        self.leaderboard.get_mut(&(player_id, ruleset))
    }

    /// Returns every rating, across all rulesets, to change in place
    pub fn ratings_mut(&mut self) -> impl Iterator<Item = &mut PlayerRating> {
        self.leaderboard.values_mut()
    }

    /// Returns true if no player has a rating in any ruleset
    pub fn is_empty(&self) -> bool {
        self.leaderboard.is_empty()
    }

    /// Gets a player's country code
    pub fn get_country(&self, player_id: i32) -> Option<&String> {
        self.country_mapping.get(&player_id)
    }

    /// Retrieves a player's rating adjustment history for a specific ruleset
    pub fn get_rating_adjustments(&self, player_id: i32, ruleset: Ruleset) -> Option<Vec<RatingAdjustment>> {
        self.get_rating(player_id, ruleset)
            .map(|rating| rating.adjustments.clone())
    }

    /// Updates all rankings, percentiles, and sorts leaderboards
    ///
    /// This is the main ranking calculation function, which:
    /// 1. Sorts players by rating within each ruleset
    /// 2. Assigns global ranks and percentiles
    /// 3. Updates country-specific leaderboards
    /// 4. Calculates country ranks
    ///
    /// # Processing Steps
    /// 1. Global Rankings:
    ///    - Sort players by rating within each ruleset
    ///    - Assign global ranks (#1 = highest rating)
    ///    - Calculate percentiles
    ///
    /// 2. Country Rankings:
    ///    - Group players by country
    ///    - Sort within each country/ruleset combination
    ///    - Assign country ranks
    ///
    /// 3. Final Update:
    ///    - Ensure all leaderboards are consistent
    ///    - Update all player records
    pub fn sort(&mut self) {
        debug!(total_ratings = self.leaderboard.len(), "Sorting leaderboards");

        let rulesets = [
            Ruleset::Osu,
            Ruleset::Taiko,
            Ruleset::Catch,
            Ruleset::ManiaOther,
            Ruleset::Mania4k,
            Ruleset::Mania7k
        ];

        // Process global rankings for each ruleset
        self.update_global_rankings(&rulesets);

        // Rebuild country leaderboards with updated data
        self.rebuild_country_leaderboards(&rulesets);

        // Process country rankings
        self.update_country_rankings(&rulesets);

        // Final consistency update
        self.ensure_leaderboard_consistency(&rulesets);

        debug!("Leaderboard sorting complete");
    }

    /// Updates global rankings and percentiles for all rulesets
    fn update_global_rankings(&mut self, rulesets: &[Ruleset]) {
        for ruleset in rulesets {
            let global_rank = 1;

            // Get and sort players for this ruleset
            let ruleset_leaderboard: Vec<_> = self
                .leaderboard
                .iter_mut()
                .filter(|(_, rating)| rating.ruleset == *ruleset)
                .sorted_by(|(_, a), (_, b)| Self::rank_order(a, b))
                .collect();

            let total_players = ruleset_leaderboard.len() as i32;

            // Update rankings and percentiles
            for (global_rank, (_, rating)) in (1..).zip(ruleset_leaderboard) {
                rating.global_rank = global_rank;
                rating.percentile =
                    Self::calculate_percentile(global_rank, total_players).expect("Invalid rank/total combination");
            }
        }
    }

    /// Rebuilds country leaderboards with current rating data
    fn rebuild_country_leaderboards(&mut self, rulesets: &[Ruleset]) {
        // Clear existing country leaderboards
        self.country_leaderboards.clear();

        // Rebuild country leaderboards from main leaderboard
        for (player_id, country) in &self.country_mapping {
            for ruleset in rulesets {
                if let Some(rating) = self.leaderboard.get(&(*player_id, *ruleset)) {
                    let country_board = self.country_leaderboards.entry(country.clone()).or_default();
                    country_board.insert((*player_id, *ruleset), rating.clone());
                }
            }
        }
    }

    /// Updates country rankings for all countries and rulesets
    fn update_country_rankings(&mut self, rulesets: &[Ruleset]) {
        for country_leaderboard in self.country_leaderboards.values() {
            for ruleset in rulesets {
                let mut country_rank = 1;

                // Sort players within country by rating
                let country_ruleset_board: Vec<_> = country_leaderboard
                    .iter()
                    .filter(|(_, rating)| rating.ruleset == *ruleset)
                    .sorted_by(|(_, a), (_, b)| Self::rank_order(a, b))
                    .collect();

                // Update country ranks in main leaderboard
                for (_, rating) in country_ruleset_board {
                    if let Some(main_entry) = self.leaderboard.get_mut(&(rating.player_id, rating.ruleset)) {
                        main_entry.country_rank = country_rank;
                        country_rank += 1;
                    }
                }
            }
        }
    }

    /// Ensures all leaderboards are consistent after updates
    fn ensure_leaderboard_consistency(&mut self, rulesets: &[Ruleset]) {
        for ruleset in rulesets {
            let updates: Vec<PlayerRating> = self
                .leaderboard
                .values()
                .filter(|rating| rating.ruleset == *ruleset)
                .cloned()
                .collect();

            self.insert_or_update(&updates);
        }
    }

    /// Orders ratings from best to worst rank: highest rating first, with
    /// equal ratings ranked by lowest player id
    ///
    /// The tie-break keeps ranks the same from run to run instead of
    /// depending on the order ratings were stored in.
    fn rank_order(a: &PlayerRating, b: &PlayerRating) -> Ordering {
        b.rating
            .partial_cmp(&a.rating)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.player_id.cmp(&b.player_id))
    }

    /// Calculates percentile for a given rank and total player count
    ///
    /// # Formula
    /// `percentile = ((total - rank) / total) * 100`
    ///
    /// # Examples
    /// - Rank 1 of 100 → 99th percentile
    /// - Rank 50 of 100 → 50th percentile
    /// - Rank 100 of 100 → 0th percentile
    ///
    /// # Returns
    /// - None if rank is invalid (< 1)
    /// - Percentile as a float between 0 and 100
    fn calculate_percentile(rank: i32, total: i32) -> Option<f64> {
        match rank.cmp(&1) {
            Ordering::Less => None,
            _ => {
                let players_below = total - rank;
                Some(players_below as f64 / total as f64 * 100.0)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::{
        database::db_structs::PlayerRating,
        model::{
            constants::{DEFAULT_VOLATILITY, FALLBACK_RATING},
            rating_tracker::RatingTracker,
            structures::{
                rating_adjustment_type::RatingAdjustmentType,
                ruleset::Ruleset::{self, Osu}
            }
        },
        utils::test_utils::{generate_country_mapping_player_ratings, generate_player_rating}
    };
    use approx::assert_abs_diff_eq;
    use chrono::{Duration, TimeZone, Utc};

    #[test]
    fn test_sort() {
        let mut rating_tracker = RatingTracker::new();
        let player_ratings = vec![
            generate_player_rating(1, Osu, 100.0, 100.0, 1, None, None),
            generate_player_rating(2, Osu, 200.0, 100.0, 1, None, None),
        ];

        let country_mapping = generate_country_mapping_player_ratings(&player_ratings, "US");
        rating_tracker.set_country_mapping(country_mapping);
        rating_tracker.insert_or_update(&player_ratings);

        let p1 = rating_tracker
            .get_rating(1, Osu)
            .expect("Expected to find rating for Player 1 in ruleset Osu");

        let p2 = rating_tracker
            .get_rating(2, Osu)
            .expect("Expected to find rating for Player 2 in ruleset Osu");

        // Assert global ranks are different from what they should be
        assert_eq!(p1.global_rank, 0);
        assert_eq!(p2.global_rank, 0);

        assert_eq!(p1.country_rank, 0);
        assert_eq!(p2.country_rank, 0);

        assert_abs_diff_eq!(p1.percentile, 0.0);
        assert_abs_diff_eq!(p2.percentile, 0.0);

        // Sort updates the global & country rankings for all users
        rating_tracker.sort();

        let p1 = rating_tracker
            .get_rating(1, Osu)
            .expect("Expected to find rating for Player 1 in ruleset Osu");
        let p2 = rating_tracker
            .get_rating(2, Osu)
            .expect("Expected to find rating for Player 2 in ruleset Osu");

        assert_eq!(p1.global_rank, 2);
        assert_eq!(p2.global_rank, 1);

        assert_eq!(p1.country_rank, 2);
        assert_eq!(p2.country_rank, 1);

        assert_abs_diff_eq!(p1.percentile, RatingTracker::calculate_percentile(2, 2).unwrap());
        assert_abs_diff_eq!(p2.percentile, RatingTracker::calculate_percentile(1, 2).unwrap());
    }

    #[test]
    fn test_percentile() {
        assert_eq!(RatingTracker::calculate_percentile(0, 10), None);
        assert_eq!(RatingTracker::calculate_percentile(-1, 10), None);

        assert_eq!(RatingTracker::calculate_percentile(1, 1), Some(0.0));

        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 2).unwrap(),
            50.0,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(2, 2).unwrap(),
            0.0,
            epsilon = 0.0001
        );

        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 10).unwrap(),
            90.0,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 100).unwrap(),
            99.0,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 1000).unwrap(),
            99.9,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 10000).unwrap(),
            99.99,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 100000).unwrap(),
            99.999,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 1000000).unwrap(),
            99.9999,
            epsilon = 0.0001
        );
    }

    /// Helper function to create a RatingTracker with pre-configured players
    fn setup_test_tracker(ratings: Vec<PlayerRating>, country: &str) -> RatingTracker {
        let mut tracker = RatingTracker::new();
        let country_mapping = generate_country_mapping_player_ratings(&ratings, country);
        tracker.set_country_mapping(country_mapping);
        tracker.insert_or_update(&ratings);
        tracker
    }

    #[test]
    fn test_track_player_initial_rating_and_match_update() {
        let mut rating_tracker = RatingTracker::new();

        // Initialize new player
        let player_ratings = vec![generate_player_rating(
            1,
            Osu,
            FALLBACK_RATING,
            DEFAULT_VOLATILITY,
            1,
            None,
            None
        )];

        let country_mapping = generate_country_mapping_player_ratings(player_ratings.as_slice(), "US");
        rating_tracker.set_country_mapping(country_mapping);
        rating_tracker.insert_or_update(&player_ratings);

        // Verify initial state
        let player_rating = rating_tracker.get_rating(1, Osu).unwrap();
        assert_eq!(player_rating.player_id, 1);
        assert_eq!(player_rating.adjustments.len(), 1);
        assert_eq!(
            player_rating.adjustments[0].adjustment_type,
            RatingAdjustmentType::Initial
        );

        // Update with match result
        let updated_ratings = vec![generate_player_rating(1, Ruleset::Osu, 200.0, 85.0, 2, None, None)];
        rating_tracker.insert_or_update(&updated_ratings);

        // Verify update
        let verify_rating = rating_tracker.get_rating(1, Ruleset::Osu).unwrap();
        assert_eq!(verify_rating.rating, 200.0);
        assert_eq!(verify_rating.volatility, 85.0);
        assert_eq!(verify_rating.adjustments.len(), 2);
    }

    #[test]
    fn test_multi_ruleset_tracking() {
        let ratings = vec![
            generate_player_rating(1, Ruleset::Osu, 1000.0, 100.0, 1, None, None),
            generate_player_rating(1, Ruleset::Taiko, 800.0, 100.0, 1, None, None),
            generate_player_rating(1, Ruleset::Catch, 1200.0, 100.0, 1, None, None),
        ];

        let tracker = setup_test_tracker(ratings, "US");

        // Verify separate ruleset tracking
        assert_eq!(tracker.get_rating(1, Ruleset::Osu).unwrap().rating, 1000.0);
        assert_eq!(tracker.get_rating(1, Ruleset::Taiko).unwrap().rating, 800.0);
        assert_eq!(tracker.get_rating(1, Ruleset::Catch).unwrap().rating, 1200.0);
        assert!(tracker.get_rating(1, Ruleset::Mania4k).is_none());
    }

    #[test]
    fn test_rating_history_tracking() {
        let mut tracker = RatingTracker::new();
        let start = Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap().fixed_offset();
        let end = start + Duration::days(3);

        let initial = generate_player_rating(1, Osu, 1000.0, 100.0, 1, Some(start), Some(start));
        let update = generate_player_rating(1, Osu, 1150.0, 85.0, 4, Some(start), Some(end));

        // An update replaces the stored history rather than adding to it
        tracker.insert_or_update(&[initial]);
        tracker.insert_or_update(&[update]);
        tracker.sort();

        // Distinct timestamps, so a reordered history fails the check
        let adjustments = tracker.get_rating_adjustments(1, Osu).unwrap();
        assert_eq!(adjustments.len(), 4);
        assert!(adjustments.windows(2).all(|w| w[0].timestamp < w[1].timestamp));
    }

    #[test]
    fn test_percentile_edge_cases() {
        // Test extreme cases
        assert_eq!(RatingTracker::calculate_percentile(0, 10), None);
        assert_eq!(RatingTracker::calculate_percentile(-1, 10), None);
        assert_eq!(RatingTracker::calculate_percentile(1, 1), Some(0.0));

        // Test normal cases
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 2).unwrap(),
            50.0,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(2, 2).unwrap(),
            0.0,
            epsilon = 0.0001
        );

        // Test large numbers
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1, 1000000).unwrap(),
            99.9999,
            epsilon = 0.0001
        );
        assert_abs_diff_eq!(
            RatingTracker::calculate_percentile(1000000, 1000000).unwrap(),
            0.0,
            epsilon = 0.0001
        );
    }

    #[test]
    fn test_tied_ratings_rank_by_player_id() {
        let mut tracker = RatingTracker::new();

        // Equal ratings, stored in an order unrelated to player id
        let ratings = vec![
            generate_player_rating(3, Ruleset::Osu, 1000.0, 100.0, 1, None, None),
            generate_player_rating(1, Ruleset::Osu, 1000.0, 100.0, 1, None, None),
            generate_player_rating(4, Ruleset::Osu, 1100.0, 100.0, 1, None, None),
            generate_player_rating(2, Ruleset::Osu, 1000.0, 100.0, 1, None, None),
        ];

        let mut country_mapping = HashMap::new();
        for player_id in [1, 2, 3] {
            country_mapping.insert(player_id, "US".to_string());
        }
        country_mapping.insert(4, "JP".to_string());

        tracker.set_country_mapping(country_mapping);
        tracker.insert_or_update(&ratings);
        tracker.sort();

        let ranks = |player_id| {
            let rating = tracker.get_rating(player_id, Ruleset::Osu).unwrap();
            (rating.global_rank, rating.country_rank)
        };

        assert_eq!(ranks(4), (1, 1));
        assert_eq!(ranks(1), (2, 1));
        assert_eq!(ranks(2), (3, 2));
        assert_eq!(ranks(3), (4, 3));
    }

    #[test]
    fn test_get_all_ratings_is_ordered_by_player_then_ruleset() {
        let mut tracker = RatingTracker::new();
        tracker.insert_or_update(&[
            generate_player_rating(2, Ruleset::Taiko, 1000.0, 100.0, 1, None, None),
            generate_player_rating(1, Ruleset::Mania7k, 1000.0, 100.0, 1, None, None),
            generate_player_rating(2, Ruleset::Osu, 1000.0, 100.0, 1, None, None),
            generate_player_rating(1, Ruleset::Osu, 1000.0, 100.0, 1, None, None)
        ]);

        let keys: Vec<_> = tracker
            .get_all_ratings()
            .iter()
            .map(|rating| (rating.player_id, rating.ruleset))
            .collect();

        assert_eq!(
            keys,
            vec![
                (1, Ruleset::Osu),
                (1, Ruleset::Mania7k),
                (2, Ruleset::Osu),
                (2, Ruleset::Taiko),
            ]
        );
    }

    #[test]
    fn test_country_leaderboard_updates() {
        let mut tracker = RatingTracker::new();

        // Create two US players
        let mut country_mapping = HashMap::new();
        country_mapping.insert(1, "US".to_string());
        country_mapping.insert(2, "US".to_string());
        tracker.set_country_mapping(country_mapping);

        // Initial ratings
        let initial_ratings = vec![
            generate_player_rating(1, Ruleset::Osu, 1000.0, 100.0, 1, None, None),
            generate_player_rating(2, Ruleset::Osu, 1100.0, 100.0, 1, None, None),
        ];
        tracker.insert_or_update(&initial_ratings);
        tracker.sort();

        // Verify initial country rankings
        assert_eq!(tracker.get_rating(1, Ruleset::Osu).unwrap().country_rank, 2);
        assert_eq!(tracker.get_rating(2, Ruleset::Osu).unwrap().country_rank, 1);

        // Update ratings to flip the order
        let updated_ratings = vec![
            generate_player_rating(1, Ruleset::Osu, 1200.0, 95.0, 2, None, None),
            generate_player_rating(2, Ruleset::Osu, 1000.0, 95.0, 2, None, None),
        ];
        tracker.insert_or_update(&updated_ratings);
        tracker.sort();

        // Verify updated country rankings
        assert_eq!(tracker.get_rating(1, Ruleset::Osu).unwrap().country_rank, 1);
        assert_eq!(tracker.get_rating(2, Ruleset::Osu).unwrap().country_rank, 2);
    }

    #[test]
    fn test_mania7k_ranking_calculation() {
        let mut tracker = RatingTracker::new();

        // Test specifically that Mania7k gets rankings calculated with multiple players
        let ratings = vec![
            generate_player_rating(1, Ruleset::Mania7k, 1300.0, 100.0, 1, None, None),
            generate_player_rating(2, Ruleset::Mania7k, 1200.0, 100.0, 1, None, None),
            generate_player_rating(3, Ruleset::Mania7k, 1100.0, 100.0, 1, None, None),
        ];

        let country_mapping = generate_country_mapping_player_ratings(&ratings, "US");
        tracker.set_country_mapping(country_mapping);
        tracker.insert_or_update(&ratings);

        // Before sorting, all rankings should be 0
        for rating in &ratings {
            let player_rating = tracker.get_rating(rating.player_id, rating.ruleset).unwrap();
            assert_eq!(player_rating.global_rank, 0);
            assert_eq!(player_rating.country_rank, 0);
            assert_eq!(player_rating.percentile, 0.0);
        }

        // Sort to calculate rankings
        tracker.sort();

        // After sorting, verify Mania7k players have proper rankings
        // Player 1 (1300.0 rating) should be rank 1
        let p1 = tracker.get_rating(1, Ruleset::Mania7k).unwrap();
        assert_eq!(p1.global_rank, 1);
        assert_eq!(p1.country_rank, 1);
        assert_abs_diff_eq!(p1.percentile, RatingTracker::calculate_percentile(1, 3).unwrap());

        // Player 2 (1200.0 rating) should be rank 2
        let p2 = tracker.get_rating(2, Ruleset::Mania7k).unwrap();
        assert_eq!(p2.global_rank, 2);
        assert_eq!(p2.country_rank, 2);
        assert_abs_diff_eq!(p2.percentile, RatingTracker::calculate_percentile(2, 3).unwrap());

        // Player 3 (1100.0 rating) should be rank 3
        let p3 = tracker.get_rating(3, Ruleset::Mania7k).unwrap();
        assert_eq!(p3.global_rank, 3);
        assert_eq!(p3.country_rank, 3);
        assert_abs_diff_eq!(p3.percentile, RatingTracker::calculate_percentile(3, 3).unwrap());

        // Verify all rankings are non-zero (except percentile for last place which is correctly 0.0)
        assert_ne!(p1.global_rank, 0);
        assert_ne!(p1.country_rank, 0);
        assert_ne!(p1.percentile, 0.0); // Should be 66.67%

        assert_ne!(p2.global_rank, 0);
        assert_ne!(p2.country_rank, 0);
        assert_ne!(p2.percentile, 0.0); // Should be 33.33%

        assert_ne!(p3.global_rank, 0);
        assert_ne!(p3.country_rank, 0);
        assert_eq!(p3.percentile, 0.0); // Last place is correctly 0.0%
    }

    #[test]
    fn test_all_rulesets_get_rankings() {
        // Integration test to verify all rulesets get proper ranking calculations
        let mut tracker = RatingTracker::new();

        // Create one player for each ruleset to verify they all get processed
        let all_rulesets = [
            Ruleset::Osu,
            Ruleset::Taiko,
            Ruleset::Catch,
            Ruleset::ManiaOther,
            Ruleset::Mania4k,
            Ruleset::Mania7k
        ];

        let mut ratings = Vec::new();
        let mut country_mapping = HashMap::new();

        for (i, &ruleset) in all_rulesets.iter().enumerate() {
            let player_id = (i + 1) as i32;
            ratings.push(generate_player_rating(
                player_id,
                ruleset,
                1000.0 + (i as f64 * 100.0),
                100.0,
                1,
                None,
                None
            ));
            country_mapping.insert(player_id, "US".to_string());
        }

        tracker.set_country_mapping(country_mapping);
        tracker.insert_or_update(&ratings);
        tracker.sort();

        // Verify every ruleset has a player with proper rankings
        for (i, &ruleset) in all_rulesets.iter().enumerate() {
            let player_id = (i + 1) as i32;
            let rating = tracker.get_rating(player_id, ruleset).unwrap();

            // All players should have rank 1 since they're the only player in their ruleset
            assert_eq!(
                rating.global_rank, 1,
                "Player {} in ruleset {:?} should have global rank 1",
                player_id, ruleset
            );
            assert_eq!(
                rating.country_rank, 1,
                "Player {} in ruleset {:?} should have country rank 1",
                player_id, ruleset
            );

            // Single player should have 0.0 percentile (no one below them)
            assert_eq!(
                rating.percentile, 0.0,
                "Player {} in ruleset {:?} should have 0.0 percentile",
                player_id, ruleset
            );
        }

        // Specifically verify Mania7k works (this would fail before the fix)
        let mania7k_player = tracker.get_rating(6, Ruleset::Mania7k).unwrap();
        assert_eq!(mania7k_player.global_rank, 1);
        assert_eq!(mania7k_player.country_rank, 1);
        assert_eq!(mania7k_player.percentile, 0.0);
    }
}
