use super::constants::FALLBACK_RATING;
use crate::{
    database::db_structs::{Match, Player, PlayerRating, RatingAdjustment},
    model::{
        constants::{DEFAULT_VOLATILITY, INITIAL_RATING_CEILING, INITIAL_RATING_FLOOR},
        structures::{rating_adjustment_type::RatingAdjustmentType, ruleset::Ruleset}
    },
    utils::progress_utils::progress_span
};
use chrono::{DateTime, Duration, FixedOffset};
use std::{collections::HashMap, ops::Sub};
use strum::IntoEnumIterator;
use tracing::debug;
use tracing_indicatif::span_ext::IndicatifSpanExt;

pub fn create_initial_ratings(players: &[Player], matches: &[Match]) -> Vec<PlayerRating> {
    // Identify which players have played in each ruleset
    let mut ruleset_activity: HashMap<Ruleset, HashMap<i32, DateTime<FixedOffset>>> = HashMap::new();

    let span = progress_span(matches.len() as u64, "Scanning match participation");
    let _guard = span.enter();

    for match_ in matches {
        for game in &match_.games {
            for score in &game.scores {
                // Store the player id and match time (prefer end_time, fallback to start_time).
                // Allows us to accurately set the timestamp of the initial rating adjustment
                // and avoid creating initial adjustments for players who are inactive in
                // any ruleset.
                let match_time = match_.rating_timestamp();
                ruleset_activity
                    .entry(match_.ruleset)
                    .or_default()
                    .entry(score.player_id)
                    .and_modify(|first_match_time| {
                        *first_match_time = (*first_match_time).min(match_time);
                    })
                    .or_insert(match_time);
            }
        }
        span.pb_inc(1);
    }
    drop(_guard);

    let mut ratings = Vec::new();
    for player in players {
        // Visit rulesets in a fixed order, not the map's per-process hash
        // order, so every run returns the ratings in the same order.
        for ruleset in Ruleset::iter() {
            let Some(timestamp) = ruleset_activity
                .get(&ruleset)
                .and_then(|activity| activity.get(&player.id))
            else {
                // Player has not played in this ruleset
                continue;
            };

            let rating = initial_rating(player, &ruleset);
            let adjustment = RatingAdjustment {
                player_id: player.id,
                ruleset,
                match_id: None,
                rating_before: 0.0,
                rating_after: rating,
                volatility_before: 0.0,
                volatility_after: DEFAULT_VOLATILITY,
                timestamp: timestamp.sub(Duration::seconds(1)),
                adjustment_type: RatingAdjustmentType::Initial
            };

            if rating.is_nan() || rating <= 0.0 {
                panic!("Initial rating is NaN or <= 0.0 for: {player:?}");
            }

            ratings.push(PlayerRating {
                id: 0, // database id, leave default
                player_id: player.id,
                ruleset,
                rating,
                volatility: DEFAULT_VOLATILITY,
                // percentile, global_rank, and country_rank
                // are managed by the rating_tracker
                percentile: 0.0,
                global_rank: 0,
                country_rank: 0,
                adjustments: vec![adjustment]
            });
        }
    }

    ratings
}

fn initial_rating(player: &Player, ruleset: &Ruleset) -> f64 {
    match &player.ruleset_data {
        Some(data) => {
            // Special handling for Mania4k and Mania7k.
            // osu!track cannot track Mania4k and Mania7k separately, so the data worker
            // seeds each variant's earliest rank from the overall mania history, aligned
            // to the player's first match in that variant. Using the overall mania rank
            // for the initial rating is close enough in accuracy for our purposes.
            if matches!(ruleset, Ruleset::Mania4k | Ruleset::Mania7k) {
                let variant_data = data.iter().find(|rd| rd.ruleset == *ruleset);

                // First, use the variant's own earliest rank
                if let Some(earliest_rank) = variant_data.and_then(|rd| rd.earliest_global_rank) {
                    return mu_from_rank(earliest_rank, *ruleset);
                }

                // Then the overall mania earliest rank from ManiaOther (ruleset 3), which
                // covers a variant row created after the last osu!track fetch
                if let Some(earliest_rank) = data
                    .iter()
                    .find(|rd| rd.ruleset == Ruleset::ManiaOther)
                    .and_then(|rd| rd.earliest_global_rank)
                {
                    return mu_from_rank(earliest_rank, *ruleset);
                }

                // Last, the variant's current rank
                if let Some(rank) = variant_data.and_then(|rd| rd.global_rank) {
                    return mu_from_rank(rank, *ruleset);
                }

                // If no data found, use fallback rating
                debug!(player_id = player.id, ruleset = ?ruleset, "No data found for player, using fallback initial rating");
                return FALLBACK_RATING;
            }

            // Handle other rulesets as normal
            let ruleset_data = data.iter().find(|rd| rd.ruleset == *ruleset);
            let rank = ruleset_data.and_then(|rd| rd.earliest_global_rank.or(rd.global_rank));

            match rank {
                Some(r) => mu_from_rank(r, *ruleset),
                None => FALLBACK_RATING
            }
        }
        None => FALLBACK_RATING
    }
}

fn mu_from_rank(rank: i32, ruleset: Ruleset) -> f64 {
    let left_slope = 250.0;
    let right_slope = 200.0;

    let mean = mean_from_ruleset(ruleset);
    let std_dev = std_dev_from_ruleset(ruleset);

    let z = (rank as f64 / mean.exp()).ln() / std_dev;
    let val = 1200.0 - (if z > 0.0 { left_slope } else { right_slope }) * z;

    if val < INITIAL_RATING_FLOOR {
        return INITIAL_RATING_FLOOR;
    }

    if val > INITIAL_RATING_CEILING {
        return INITIAL_RATING_CEILING;
    }

    val
}

/// Mean of ln(earliest_known_global_rank) for all players in a given ruleset
fn mean_from_ruleset(ruleset: Ruleset) -> f64 {
    match ruleset {
        Ruleset::Osu => 9.99,
        Ruleset::Taiko => 7.28,
        Ruleset::Catch => 6.85,
        Ruleset::Mania4k | Ruleset::ManiaOther => 8.02,
        Ruleset::Mania7k => 6.11
    }
}

/// Standard deviation of ln(earliest_known_global_rank) for all players in a given ruleset
fn std_dev_from_ruleset(ruleset: Ruleset) -> f64 {
    match ruleset {
        Ruleset::Osu => 1.77,
        Ruleset::Taiko => 1.6,
        Ruleset::Catch => 1.62,
        Ruleset::Mania4k | Ruleset::ManiaOther => 1.54,
        Ruleset::Mania7k => 1.59
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        database::db_structs::{Player, RulesetData},
        model::{
            constants::{FALLBACK_RATING, INITIAL_RATING_CEILING, INITIAL_RATING_FLOOR},
            rating_utils::mu_from_rank,
            structures::ruleset::Ruleset::{Catch, Mania4k, Mania7k, Osu, Taiko}
        },
        utils::test_utils::{generate_game, generate_match, generate_placement, generate_ruleset_data}
    };
    use chrono::{Duration, TimeZone, Utc};

    #[test]
    fn test_mu_from_rank_maximum() {
        let rank = 1;
        let expected_mu = INITIAL_RATING_CEILING;

        // We do not test for Mania 7K here, as the average rank is high enough to where the
        // rank #1 player does not reach the initial rating ceiling.

        let actual_mu_osu = mu_from_rank(rank, Osu);
        let actual_mu_taiko = mu_from_rank(rank, Taiko);
        let actual_mu_catch = mu_from_rank(rank, Catch);
        let actual_mu_mania_4k = mu_from_rank(rank, Mania4k);

        assert_eq!(expected_mu, actual_mu_osu);
        assert_eq!(expected_mu, actual_mu_taiko);
        assert_eq!(expected_mu, actual_mu_catch);
        assert_eq!(expected_mu, actual_mu_mania_4k);
    }

    #[test]
    fn test_mu_from_rank_minimum() {
        let rank = 10_000_000;
        let expected_mu = INITIAL_RATING_FLOOR;

        let actual_mu_osu = mu_from_rank(rank, Osu);
        let actual_mu_taiko = mu_from_rank(rank, Taiko);
        let actual_mu_catch = mu_from_rank(rank, Catch);
        let actual_mu_mania_4k = mu_from_rank(rank, Mania4k);
        let actual_mu_mania_7k = mu_from_rank(rank, Mania7k);

        assert_eq!(expected_mu, actual_mu_osu);
        assert_eq!(expected_mu, actual_mu_taiko);
        assert_eq!(expected_mu, actual_mu_catch);
        assert_eq!(expected_mu, actual_mu_mania_4k);
        assert_eq!(expected_mu, actual_mu_mania_7k);
    }

    #[test]
    fn test_create_initial_ratings() {
        let player = Player {
            id: 1,
            username: Some("Test".to_string()),
            country: None,
            // Player who is rank 1 in everything. wow!
            ruleset_data: Some(vec![
                generate_ruleset_data(Osu, 1, None),
                generate_ruleset_data(Taiko, 1, None),
                generate_ruleset_data(Catch, 1, None),
                generate_ruleset_data(Mania4k, 1, None),
                generate_ruleset_data(Mania7k, 1, None),
            ])
        };

        let expected_osu = mu_from_rank(1, Osu);
        let expected_taiko = mu_from_rank(1, Taiko);
        let expected_catch = mu_from_rank(1, Catch);
        let expected_mania4k = mu_from_rank(1, Mania4k);
        let expected_mania7k = mu_from_rank(1, Mania7k);

        let actual_osu = super::initial_rating(&player, &Osu);
        let actual_taiko = super::initial_rating(&player, &Taiko);
        let actual_catch = super::initial_rating(&player, &Catch);
        let actual_mania4k = super::initial_rating(&player, &Mania4k);
        let actual_mania7k = super::initial_rating(&player, &Mania7k);

        assert_eq!(expected_osu, actual_osu);
        assert_eq!(expected_taiko, actual_taiko);
        assert_eq!(expected_catch, actual_catch);
        assert_eq!(expected_mania4k, actual_mania4k);
        assert_eq!(expected_mania7k, actual_mania7k);
    }

    #[test]
    fn test_initial_rating_prefers_earliest_then_current_rank() {
        let player_with_earliest_only = Player {
            id: 1,
            username: None,
            country: None,
            ruleset_data: Some(vec![RulesetData {
                ruleset: Osu,
                global_rank: None,
                earliest_global_rank: Some(500)
            }])
        };
        let player_with_current_only = Player {
            id: 2,
            username: None,
            country: None,
            ruleset_data: Some(vec![RulesetData {
                ruleset: Osu,
                global_rank: Some(750),
                earliest_global_rank: None
            }])
        };
        let player_without_rank = Player {
            id: 3,
            username: None,
            country: None,
            ruleset_data: Some(vec![RulesetData {
                ruleset: Osu,
                global_rank: None,
                earliest_global_rank: None
            }])
        };

        assert_eq!(
            super::initial_rating(&player_with_earliest_only, &Osu),
            mu_from_rank(500, Osu)
        );
        assert_eq!(
            super::initial_rating(&player_with_current_only, &Osu),
            mu_from_rank(750, Osu)
        );
        assert_eq!(super::initial_rating(&player_without_rank, &Osu), FALLBACK_RATING);
    }

    #[test]
    fn test_initial_adjustment_uses_earliest_rating_timestamp() {
        let player = Player {
            id: 1,
            username: None,
            country: None,
            ruleset_data: Some(vec![generate_ruleset_data(Osu, 500, None)])
        };
        let placements = vec![generate_placement(1, 1), generate_placement(2, 2)];
        let games = vec![generate_game(1, &placements)];
        let early_start = Utc.with_ymd_and_hms(2024, 1, 1, 10, 0, 0).unwrap().fixed_offset();
        let late_start = Utc.with_ymd_and_hms(2024, 1, 2, 10, 0, 0).unwrap().fixed_offset();
        let early_match = generate_match(1, Osu, &games, early_start);
        let late_match = generate_match(2, Osu, &games, late_start);

        let ratings = super::create_initial_ratings(&[player], &[late_match, early_match]);

        assert_eq!(ratings.len(), 1);
        assert_eq!(
            ratings[0].adjustments[0].timestamp,
            early_start + Duration::hours(1) - Duration::seconds(1)
        );
    }

    #[test]
    fn test_initial_ratings_are_ordered_by_player_then_ruleset() {
        let players: Vec<Player> = [1, 2]
            .into_iter()
            .map(|id| Player {
                id,
                username: None,
                country: None,
                ruleset_data: None
            })
            .collect();
        let placements = vec![generate_placement(1, 1), generate_placement(2, 2)];
        let games = vec![generate_game(1, &placements)];
        let start = Utc.with_ymd_and_hms(2024, 1, 1, 10, 0, 0).unwrap().fixed_offset();
        let matches: Vec<_> = [Mania7k, Osu, Catch, Taiko]
            .into_iter()
            .enumerate()
            .map(|(i, ruleset)| generate_match(i as i32 + 1, ruleset, &games, start))
            .collect();

        let ratings = super::create_initial_ratings(&players, &matches);
        let keys: Vec<_> = ratings
            .iter()
            .map(|rating| (rating.player_id, rating.ruleset))
            .collect();

        assert_eq!(
            keys,
            vec![
                (1, Osu),
                (1, Taiko),
                (1, Catch),
                (1, Mania7k),
                (2, Osu),
                (2, Taiko),
                (2, Catch),
                (2, Mania7k),
            ]
        );
    }

    #[test]
    fn test_mania_variant_earliest_rank_preferred_over_mania_other() {
        use crate::model::structures::ruleset::Ruleset::*;

        // The data worker aligns each variant's earliest rank to the player's first match
        // in that variant, so it wins over the overall mania rank in ManiaOther.
        let player = Player {
            id: 1,
            username: None,
            country: None,
            ruleset_data: Some(vec![
                generate_ruleset_data(ManiaOther, 5000, Some(1000)),
                generate_ruleset_data(Mania4k, 2000, Some(1500)),
                generate_ruleset_data(Mania7k, 3000, Some(2500)),
            ])
        };

        assert_eq!(super::initial_rating(&player, &Mania4k), mu_from_rank(1500, Mania4k));
        assert_eq!(super::initial_rating(&player, &Mania7k), mu_from_rank(2500, Mania7k));
    }

    #[test]
    fn test_mania4k_mania7k_initial_rating_logic() {
        use crate::model::structures::ruleset::Ruleset::*;

        // Test case 1: Player with ManiaOther earliest_global_rank and no variant
        // earliest_global_rank - ManiaOther's is preferred over the variants' current ranks
        let player_with_mania_other_earliest = Player {
            id: 1,
            username: Some("TestPlayer1".to_string()),
            country: None,
            ruleset_data: Some(vec![
                generate_ruleset_data(ManiaOther, 5000, Some(1000)), // earliest_global_rank = 1000
                generate_ruleset_data(Mania4k, 2000, None),          // global_rank = 2000
                generate_ruleset_data(Mania7k, 3000, None),          // global_rank = 3000
            ])
        };

        // Both Mania4k and Mania7k should use ManiaOther's earliest_global_rank (1000)
        let mania4k_rating = super::initial_rating(&player_with_mania_other_earliest, &Mania4k);
        let mania7k_rating = super::initial_rating(&player_with_mania_other_earliest, &Mania7k);
        let expected_rating_from_mania_other = mu_from_rank(1000, Mania4k); // Using rank 1000 with Mania4k ruleset
        let expected_rating_from_mania_other_7k = mu_from_rank(1000, Mania7k); // Using rank 1000 with Mania7k ruleset

        assert_eq!(mania4k_rating, expected_rating_from_mania_other);
        assert_eq!(mania7k_rating, expected_rating_from_mania_other_7k);

        // Test case 2: Player with each variant's own earliest_global_rank - should use it
        let player_without_mania_other_earliest = Player {
            id: 2,
            username: Some("TestPlayer2".to_string()),
            country: None,
            ruleset_data: Some(vec![
                generate_ruleset_data(ManiaOther, 5000, None),    // No earliest_global_rank
                generate_ruleset_data(Mania4k, 2000, Some(1500)), // global_rank = 2000, earliest = 1500
                generate_ruleset_data(Mania7k, 3000, Some(2500)), // global_rank = 3000, earliest = 2500
            ])
        };

        let mania4k_rating_fallback = super::initial_rating(&player_without_mania_other_earliest, &Mania4k);
        let mania7k_rating_fallback = super::initial_rating(&player_without_mania_other_earliest, &Mania7k);
        let expected_mania4k_fallback = mu_from_rank(1500, Mania4k); // Using Mania4k earliest_global_rank
        let expected_mania7k_fallback = mu_from_rank(2500, Mania7k); // Using Mania7k earliest_global_rank

        assert_eq!(mania4k_rating_fallback, expected_mania4k_fallback);
        assert_eq!(mania7k_rating_fallback, expected_mania7k_fallback);

        // Test case 3: Player with no relevant data - should use FALLBACK_RATING
        let player_no_mania_data = Player {
            id: 3,
            username: Some("TestPlayer3".to_string()),
            country: None,
            ruleset_data: Some(vec![
                generate_ruleset_data(Osu, 1000, None),
                generate_ruleset_data(Taiko, 2000, None),
            ])
        };

        let mania4k_rating_no_data = super::initial_rating(&player_no_mania_data, &Mania4k);
        let mania7k_rating_no_data = super::initial_rating(&player_no_mania_data, &Mania7k);

        assert_eq!(mania4k_rating_no_data, FALLBACK_RATING);
        assert_eq!(mania7k_rating_no_data, FALLBACK_RATING);

        // A nullable current rank remains a valid row, but cannot seed a rating
        // when osu!track also has no overall Mania history.
        let player_with_null_mania_ranks = Player {
            id: 4,
            username: Some("TestPlayer4".to_string()),
            country: None,
            ruleset_data: Some(vec![
                RulesetData {
                    ruleset: ManiaOther,
                    global_rank: None,
                    earliest_global_rank: None
                },
                RulesetData {
                    ruleset: Mania4k,
                    global_rank: None,
                    earliest_global_rank: None
                },
            ])
        };

        assert_eq!(
            super::initial_rating(&player_with_null_mania_ranks, &Mania4k),
            FALLBACK_RATING
        );
    }
}
