//! Decay results checked against hand-derived numbers. The unit tests in
//! `src/model/decay.rs` derive their expectations from the decay constants, so
//! they keep passing when a constant changes; these fail instead.

use approx::assert_abs_diff_eq;
use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use otr_processor::{
    database::db_structs::{PlayerRating, RatingAdjustment},
    model::{
        decay::UnifiedDecaySystem,
        structures::{
            rating_adjustment_type::RatingAdjustmentType::{self, Decay, Initial, Match, VolatilityDecay},
            ruleset::Ruleset
        }
    }
};

/// Every expected rating is exact in floating point, so ratings compare tightly.
const RATING_TOLERANCE: f64 = 1e-9;

/// The expected volatilities below are square roots rounded to 4 decimals.
const VOLATILITY_TOLERANCE: f64 = 1e-4;

/// 12:00 UTC on the given date, the time of every decay tick.
fn noon(year: i32, month: u32, day: u32) -> DateTime<FixedOffset> {
    Utc.with_ymd_and_hms(year, month, day, 12, 0, 0).unwrap().fixed_offset()
}

/// A rating built from `history`, each entry an adjustment's type, time,
/// rating after, and volatility after. The rating ends at the last entry.
fn rating_with_history(
    player_id: i32,
    history: &[(RatingAdjustmentType, DateTime<FixedOffset>, f64, f64)]
) -> PlayerRating {
    let mut adjustments: Vec<RatingAdjustment> = Vec::new();
    for &(adjustment_type, timestamp, rating_after, volatility_after) in history {
        let (rating_before, volatility_before) =
            adjustments.last().map_or((rating_after, volatility_after), |previous| {
                (previous.rating_after, previous.volatility_after)
            });
        adjustments.push(RatingAdjustment {
            player_id,
            ruleset: Ruleset::Osu,
            match_id: None,
            rating_before,
            rating_after,
            volatility_before,
            volatility_after,
            timestamp,
            adjustment_type
        });
    }

    let last = adjustments.last().expect("A rating needs at least one adjustment");
    PlayerRating {
        id: player_id,
        player_id,
        ruleset: Ruleset::Osu,
        rating: last.rating_after,
        volatility: last.volatility_after,
        percentile: 0.0,
        global_rank: 0,
        country_rank: 0,
        adjustments
    }
}

/// Applies decay at every Wednesday after `baseline`, through `up_to`.
fn decay_between(ratings: &mut [PlayerRating], baseline: DateTime<FixedOffset>, up_to: DateTime<FixedOffset>) {
    let mut system = UnifiedDecaySystem::new();
    // The first pass only records where decay starts.
    assert!(!system.prepare_decay_pass(baseline));
    assert!(system.prepare_decay_pass(up_to), "Expected a Wednesday by {up_to}");
    system.apply_decay(ratings);
}

/// The decay adjustments of `rating`, oldest first.
fn decay_adjustments(rating: &PlayerRating) -> Vec<&RatingAdjustment> {
    rating
        .adjustments
        .iter()
        .filter(|a| a.adjustment_type == Decay || a.adjustment_type == VolatilityDecay)
        .collect()
}

/// Asserts that `adjustment` happened at `timestamp` with the given type,
/// ratings, and volatilities.
fn assert_decay_step(
    adjustment: &RatingAdjustment,
    timestamp: DateTime<FixedOffset>,
    adjustment_type: RatingAdjustmentType,
    (rating_before, rating_after): (f64, f64),
    (volatility_before, volatility_after): (f64, f64)
) {
    assert_eq!(adjustment.timestamp, timestamp);
    assert_eq!(adjustment.adjustment_type, adjustment_type, "at {timestamp}");
    assert_abs_diff_eq!(adjustment.rating_before, rating_before, epsilon = RATING_TOLERANCE);
    assert_abs_diff_eq!(adjustment.rating_after, rating_after, epsilon = RATING_TOLERANCE);
    assert_abs_diff_eq!(
        adjustment.volatility_before,
        volatility_before,
        epsilon = VOLATILITY_TOLERANCE
    );
    assert_abs_diff_eq!(
        adjustment.volatility_after,
        volatility_after,
        epsilon = VOLATILITY_TOLERANCE
    );
}

#[test]
fn test_inactive_player_loses_three_rating_per_week() {
    // Last match 2023-02-01, far more than 184 days before January 2024. The
    // peak is 1500, so the floor of (1000 + 1500) / 2 = 1250 stays out of reach.
    let mut ratings = vec![rating_with_history(
        1,
        &[
            (Initial, noon(2023, 1, 4), 1300.0, 300.0),
            (Match, noon(2023, 2, 1), 1500.0, 200.0)
        ]
    )];

    // 2024-01-01 is a Monday, so the ticks are Wednesdays 2024-01-03 and 2024-01-10.
    decay_between(&mut ratings, noon(2024, 1, 1), noon(2024, 1, 10));

    // Each tick: rating - 3, and volatility sqrt(volatility^2 + 500).
    // 1500 - 3 = 1497, sqrt(200^2 + 500) = sqrt(40500) = 201.2461
    // 1497 - 3 = 1494, sqrt(40500 + 500) = sqrt(41000) = 202.4846
    let steps = decay_adjustments(&ratings[0]);
    assert_eq!(steps.len(), 2);
    assert_decay_step(steps[0], noon(2024, 1, 3), Decay, (1500.0, 1497.0), (200.0, 201.2461));
    assert_decay_step(
        steps[1],
        noon(2024, 1, 10),
        Decay,
        (1497.0, 1494.0),
        (201.2461, 202.4846)
    );
    assert_abs_diff_eq!(ratings[0].rating, 1494.0, epsilon = RATING_TOLERANCE);
    assert_abs_diff_eq!(ratings[0].volatility, 202.4846, epsilon = VOLATILITY_TOLERANCE);
}

#[test]
fn test_rating_decay_begins_exactly_184_days_after_last_match() {
    // As of Wednesday 2024-07-03 12:00 UTC, player 1's last match is exactly
    // 184 days old: 2024-01-01 to 2024-07-01 is 31 + 29 + 31 + 30 + 31 + 30 = 182
    // days, plus 2. Player 2's last match, a day later, is 183 days old.
    let mut ratings = vec![
        rating_with_history(
            1,
            &[
                (Initial, noon(2023, 12, 1), 1300.0, 300.0),
                (Match, noon(2024, 1, 1), 1500.0, 200.0)
            ]
        ),
        rating_with_history(
            2,
            &[
                (Initial, noon(2023, 12, 1), 1300.0, 300.0),
                (Match, noon(2024, 1, 2), 1500.0, 200.0)
            ]
        ),
    ];

    // 2024-07-03 is the only Wednesday after Monday 2024-07-01.
    decay_between(&mut ratings, noon(2024, 7, 1), noon(2024, 7, 3));

    // 1500 - 3 = 1497, sqrt(200^2 + 500) = sqrt(40500) = 201.2461
    let inactive_steps = decay_adjustments(&ratings[0]);
    assert_eq!(inactive_steps.len(), 1);
    assert_decay_step(
        inactive_steps[0],
        noon(2024, 7, 3),
        Decay,
        (1500.0, 1497.0),
        (200.0, 201.2461)
    );

    // One day short of inactive, so only volatility grows.
    let active_steps = decay_adjustments(&ratings[1]);
    assert_eq!(active_steps.len(), 1);
    assert_decay_step(
        active_steps[0],
        noon(2024, 7, 3),
        VolatilityDecay,
        (1500.0, 1500.0),
        (200.0, 201.2461)
    );
}

#[test]
fn test_decay_stops_at_floor_halfway_between_minimum_and_peak() {
    // Peaked at 1800, then fell to 1404.5. The floor follows the peak, not the
    // current rating: (1000 + 1800) / 2 = 1400.
    let mut ratings = vec![rating_with_history(
        1,
        &[
            (Initial, noon(2023, 1, 4), 1200.0, 300.0),
            (Match, noon(2023, 2, 1), 1800.0, 250.0),
            (Match, noon(2023, 3, 1), 1404.5, 200.0)
        ]
    )];

    // Ticks on Wednesdays 2024-01-03, 2024-01-10, and 2024-01-17.
    decay_between(&mut ratings, noon(2024, 1, 1), noon(2024, 1, 17));

    let steps = decay_adjustments(&ratings[0]);
    assert_eq!(steps.len(), 3);
    // 1404.5 - 3 = 1401.5, sqrt(200^2 + 500) = sqrt(40500) = 201.2461
    assert_decay_step(steps[0], noon(2024, 1, 3), Decay, (1404.5, 1401.5), (200.0, 201.2461));
    // 1401.5 - 3 = 1398.5 is below the floor, so the rating stops at 1400.
    // sqrt(40500 + 500) = sqrt(41000) = 202.4846
    assert_decay_step(
        steps[1],
        noon(2024, 1, 10),
        Decay,
        (1401.5, 1400.0),
        (201.2461, 202.4846)
    );
    // At the floor, only volatility grows: sqrt(41000 + 500) = sqrt(41500) = 203.7155
    assert_decay_step(
        steps[2],
        noon(2024, 1, 17),
        VolatilityDecay,
        (1400.0, 1400.0),
        (202.4846, 203.7155)
    );
    assert_abs_diff_eq!(ratings[0].rating, 1400.0, epsilon = RATING_TOLERANCE);
}

#[test]
fn test_match_between_decay_passes_restarts_inactivity() {
    // Last match 2023-02-01, far more than 184 days before January 2024.
    let mut ratings = vec![rating_with_history(
        1,
        &[
            (Initial, noon(2023, 1, 4), 1300.0, 300.0),
            (Match, noon(2023, 2, 1), 1500.0, 200.0)
        ]
    )];

    // One system across both passes, as when the model processes matches.
    // 2024-01-01 is a Monday, so the first pass ticks on Wednesday 2024-01-03.
    let mut system = UnifiedDecaySystem::new();
    assert!(!system.prepare_decay_pass(noon(2024, 1, 1)));
    assert!(system.prepare_decay_pass(noon(2024, 1, 3)));
    system.apply_decay(&mut ratings);

    // The player returns on Friday 2024-01-05.
    let rating = &mut ratings[0];
    rating.adjustments.push(RatingAdjustment {
        player_id: 1,
        ruleset: Ruleset::Osu,
        match_id: None,
        rating_before: rating.rating,
        rating_after: 1600.0,
        volatility_before: rating.volatility,
        volatility_after: 180.0,
        timestamp: noon(2024, 1, 5),
        adjustment_type: Match
    });
    rating.rating = 1600.0;
    rating.volatility = 180.0;

    assert!(system.prepare_decay_pass(noon(2024, 1, 10)));
    system.apply_decay(&mut ratings);

    let steps = decay_adjustments(&ratings[0]);
    assert_eq!(steps.len(), 2);
    // Inactive: 1500 - 3 = 1497, sqrt(200^2 + 500) = sqrt(40500) = 201.2461
    assert_decay_step(steps[0], noon(2024, 1, 3), Decay, (1500.0, 1497.0), (200.0, 201.2461));
    // The 2024-01-05 match is 5 days old, so only volatility grows, from the
    // match's result: sqrt(180^2 + 500) = sqrt(32900) = 181.3836
    assert_decay_step(
        steps[1],
        noon(2024, 1, 10),
        VolatilityDecay,
        (1600.0, 1600.0),
        (180.0, 181.3836)
    );
}

#[test]
fn test_decay_starts_from_latest_adjustment_on_or_before_each_wednesday() {
    // The 2024-01-09 match is dated between the two ticks, so the first tick
    // must ignore it and the second must start from it.
    let mut ratings = vec![rating_with_history(
        1,
        &[
            (Initial, noon(2023, 12, 1), 1300.0, 300.0),
            (Match, noon(2024, 1, 2), 1500.0, 200.0),
            (Match, noon(2024, 1, 9), 1450.0, 190.0)
        ]
    )];

    // Ticks on Wednesdays 2024-01-03 and 2024-01-10.
    decay_between(&mut ratings, noon(2024, 1, 1), noon(2024, 1, 10));

    let steps = decay_adjustments(&ratings[0]);
    assert_eq!(steps.len(), 2);
    // From the 2024-01-02 match: sqrt(200^2 + 500) = sqrt(40500) = 201.2461
    assert_decay_step(
        steps[0],
        noon(2024, 1, 3),
        VolatilityDecay,
        (1500.0, 1500.0),
        (200.0, 201.2461)
    );
    // From the 2024-01-09 match: sqrt(190^2 + 500) = sqrt(36600) = 191.3113
    assert_decay_step(
        steps[1],
        noon(2024, 1, 10),
        VolatilityDecay,
        (1450.0, 1450.0),
        (190.0, 191.3113)
    );
}
