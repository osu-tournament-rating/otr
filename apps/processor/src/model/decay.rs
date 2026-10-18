/// Unified decay implementation for the o!TR system.
///
/// The decay system handles both rating decay (for inactive players) and volatility decay
/// (for all players) in a single pass at Wednesday 12:00 UTC timestamps.
///
/// # Key Concepts
/// - Decay Floor: A minimum rating threshold based on a player's peak rating
/// - Wednesday Decay: All decay adjustments occur at Wednesday 12:00 UTC
/// - Unified Adjustments: Rating and volatility changes combined into single adjustments
use super::{
    constants::{
        decay_start_date, DECAY_DAYS, DECAY_MINIMUM, DECAY_RATE, DECAY_VOLATILITY_GROWTH_RATE, VOLATILITY_DECAY_CAP
    },
    structures::{rating_adjustment_type::RatingAdjustmentType, ruleset::Ruleset}
};
use crate::{
    database::db_structs::{PlayerRating, RatingAdjustment},
    model::structures::rating_adjustment_type::RatingAdjustmentType::{Decay, VolatilityDecay}
};
use chrono::{DateTime, Duration, FixedOffset};
use std::collections::HashMap;
use tracing::{debug, trace, warn};

/// Unified decay system that combines rating decay (for inactive players)
/// and volatility decay (for all players) into single Wednesday 12:00 UTC adjustments.
///
/// # Design
/// - Rating decay: Applied to players inactive for more than `DECAY_DAYS` (184 days)
/// - Volatility decay: Applied to all players not at `VOLATILITY_DECAY_CAP`
/// - Both changes are combined into a single adjustment per Wednesday per player
///
/// # Usage
/// Call `prepare_decay_pass(up_to)` first to check if there are Wednesdays to process.
/// If it returns true, call `apply_decay(player_ratings)` to apply the decay.
pub struct UnifiedDecaySystem {
    last_processed_wednesday: Option<DateTime<FixedOffset>>,
    pending_wednesdays: Vec<DateTime<FixedOffset>>,
    histories: HashMap<(i32, Ruleset), DecayHistory>
}

/// What decay needs from one player's adjustments, kept up to date as
/// adjustments are added so a Wednesday never rescans the whole history.
///
/// Wednesdays only move forward, so an adjustment dated on or before one
/// stays eligible for every later Wednesday. An adjustment dated after the
/// current Wednesday, such as an Initial adjustment dated just before the
/// player's first match, waits in `future` until a Wednesday reaches it.
#[derive(Default)]
struct DecayHistory {
    /// How many of the player's adjustments have been read.
    read: usize,
    /// The highest `rating_after` of every adjustment read, whatever its date.
    peak_rating: Option<f64>,
    /// The adjustment that sets the player's state: the latest eligible one,
    /// and of those dated the same, the last added.
    latest: Option<(DateTime<FixedOffset>, usize)>,
    /// The timestamp of the latest eligible Match adjustment.
    last_match: Option<DateTime<FixedOffset>>,
    /// Indexes of adjustments read but dated after the Wednesday they were read at.
    future: Vec<usize>
}

impl DecayHistory {
    /// Reads the adjustments added since the last call and makes every
    /// adjustment dated on or before `wednesday` eligible.
    fn advance_to(&mut self, adjustments: &[RatingAdjustment], wednesday: DateTime<FixedOffset>) {
        if adjustments.len() < self.read {
            // A different history; start over rather than trust stale indexes.
            *self = Self::default();
        }

        for index in std::mem::take(&mut self.future) {
            self.read_adjustment(adjustments, index, wednesday);
        }

        for index in self.read..adjustments.len() {
            let rating_after = adjustments[index].rating_after;
            self.peak_rating = Some(self.peak_rating.map_or(rating_after, |peak| peak.max(rating_after)));
            self.read_adjustment(adjustments, index, wednesday);
        }
        self.read = adjustments.len();
    }

    fn read_adjustment(&mut self, adjustments: &[RatingAdjustment], index: usize, wednesday: DateTime<FixedOffset>) {
        let adjustment = &adjustments[index];
        if adjustment.timestamp > wednesday {
            self.future.push(index);
            return;
        }

        if self.latest.is_none_or(|latest| (adjustment.timestamp, index) > latest) {
            self.latest = Some((adjustment.timestamp, index));
        }

        if adjustment.adjustment_type == RatingAdjustmentType::Match
            && self.last_match.is_none_or(|last| adjustment.timestamp > last)
        {
            self.last_match = Some(adjustment.timestamp);
        }
    }
}

impl UnifiedDecaySystem {
    pub fn new() -> Self {
        Self {
            last_processed_wednesday: None,
            pending_wednesdays: Vec::new(),
            histories: HashMap::new()
        }
    }

    /// Prepares for a decay pass by computing pending Wednesdays up to `up_to`.
    ///
    /// On the first call, establishes a baseline timestamp and returns false.
    /// On subsequent calls, computes and caches the Wednesdays that need processing,
    /// returning true if there are any pending Wednesdays.
    ///
    /// If this returns true, call `apply_decay(player_ratings)` to apply the cached decay.
    pub fn prepare_decay_pass(&mut self, up_to: DateTime<FixedOffset>) -> bool {
        match self.last_processed_wednesday {
            Some(from) => {
                self.pending_wednesdays = Self::get_wednesdays_between(from, up_to);
                !self.pending_wednesdays.is_empty()
            }
            None => {
                self.last_processed_wednesday = Some(up_to);
                self.pending_wednesdays.clear();
                false
            }
        }
    }

    /// Returns Wednesday 12:00 UTC timestamps between `from` (exclusive) and `to` (inclusive).
    pub fn get_wednesdays_between(
        from: DateTime<FixedOffset>,
        to: DateTime<FixedOffset>
    ) -> Vec<DateTime<FixedOffset>> {
        use chrono::{Datelike, TimeZone, Timelike, Utc, Weekday};

        let mut timestamps = Vec::new();

        // Start from the day after `from` to make it exclusive
        let start = from + Duration::days(1);
        let start_utc = start.with_timezone(&Utc);

        // Find the first Wednesday at or after start
        let days_until_wednesday =
            (Weekday::Wed.num_days_from_monday() as i64 - start_utc.weekday().num_days_from_monday() as i64 + 7) % 7;
        let first_wednesday = if days_until_wednesday == 0 && start_utc.hour() >= 12 {
            // If we're already past Wednesday 12 UTC, go to next week
            start_utc.date_naive() + chrono::Days::new(7)
        } else if days_until_wednesday == 0 {
            start_utc.date_naive()
        } else {
            start_utc.date_naive() + chrono::Days::new(days_until_wednesday as u64)
        };

        // Create Wednesday 12:00 UTC timestamp
        let mut current = Utc
            .with_ymd_and_hms(
                first_wednesday.year(),
                first_wednesday.month(),
                first_wednesday.day(),
                12,
                0,
                0
            )
            .unwrap()
            .fixed_offset();

        // If the first Wednesday 12 UTC is before or equal to from, move to next week
        if current <= from {
            current += Duration::weeks(1);
        }

        while current <= to {
            timestamps.push(current);
            current += Duration::weeks(1);
        }

        // Filter out Wednesdays before the decay start date (2019-01-01) to prevent
        // unfair decay for players active in community tournaments before tournament
        // data saving was implemented.
        let start = decay_start_date();
        timestamps.retain(|t| *t >= start);

        timestamps
    }

    /// Applies unified decay to all players for the Wednesdays cached by `prepare_decay_pass`.
    ///
    /// For each Wednesday:
    /// 1. Determine if each player is active or inactive AS OF that Wednesday
    /// 2. For inactive players: apply both rating AND volatility decay
    /// 3. For active players: apply volatility decay only
    ///
    /// Returns the number of adjustments created.
    ///
    /// **Note**: Call `prepare_decay_pass(up_to)` first to compute the pending Wednesdays.
    ///
    /// The system remembers what it has read of each player's adjustments, so
    /// between passes a player's adjustments may only be added to, never
    /// changed or removed.
    pub fn apply_decay<'a>(&mut self, player_ratings: impl IntoIterator<Item = &'a mut PlayerRating>) -> usize {
        if self.pending_wednesdays.is_empty() {
            return 0;
        }

        let mut total_adjustments = 0;

        // A player's decay depends only on their own history, so each player
        // can take every pending Wednesday in turn.
        for player_rating in player_ratings {
            let history = self
                .histories
                .entry((player_rating.player_id, player_rating.ruleset))
                .or_default();

            for &wednesday in &self.pending_wednesdays {
                history.advance_to(&player_rating.adjustments, wednesday);
                if let Some(adjustment) = Self::create_decay_adjustment(player_rating, history, wednesday) {
                    // Update player state
                    player_rating.rating = adjustment.rating_after;
                    player_rating.volatility = adjustment.volatility_after;
                    player_rating.adjustments.push(adjustment);
                    total_adjustments += 1;
                }
            }
        }

        if let Some(last) = self.pending_wednesdays.last() {
            self.last_processed_wednesday = Some(*last);
        }

        trace!(
            wednesdays = self.pending_wednesdays.len(),
            adjustments = total_adjustments,
            "Applied unified decay"
        );

        self.pending_wednesdays.clear();
        total_adjustments
    }

    /// Creates a decay adjustment for a player at the given Wednesday, if needed.
    ///
    /// Returns None if no changes are needed (player at both caps).
    /// `history` must have been advanced to `wednesday`.
    fn create_decay_adjustment(
        player_rating: &PlayerRating,
        history: &DecayHistory,
        wednesday: DateTime<FixedOffset>
    ) -> Option<RatingAdjustment> {
        // Get the player's state as of this Wednesday
        let (current_rating, current_volatility) = match history.latest {
            Some((_, index)) => {
                let adjustment = &player_rating.adjustments[index];
                (adjustment.rating_after, adjustment.volatility_after)
            }
            None => (player_rating.rating, player_rating.volatility)
        };

        // Check conditions. A player with no match yet has only an Initial
        // rating and never decays.
        let is_inactive = history
            .last_match
            .is_some_and(|last_match| (wednesday - last_match).num_days() >= DECAY_DAYS as i64);
        let at_volatility_cap = current_volatility >= VOLATILITY_DECAY_CAP;
        let peak_rating = history
            .peak_rating
            .map_or(player_rating.rating, |peak| peak.max(player_rating.rating));
        let decay_floor = Self::decay_floor(peak_rating);
        let at_rating_floor = current_rating <= decay_floor;

        // Skip if nothing to do
        if at_volatility_cap && (!is_inactive || at_rating_floor) {
            return None;
        }

        // Calculate new values
        let new_volatility = if at_volatility_cap {
            current_volatility
        } else {
            Self::calculate_new_volatility(current_volatility)
        };

        let new_rating = if is_inactive && !at_rating_floor {
            Self::calculate_decay_rating(current_rating, decay_floor)
        } else {
            current_rating
        };

        // Decay must never raise a rating or shrink volatility. Neither is
        // reachable through the logic above; clamp and warn so a future
        // regression surfaces in logs instead of silently boosting players.
        let (new_rating, new_volatility) = Self::enforce_decay_invariants(
            player_rating.player_id,
            wednesday,
            current_rating,
            new_rating,
            current_volatility,
            new_volatility
        );

        // Skip if no actual changes
        if (new_rating - current_rating).abs() < f64::EPSILON
            && (new_volatility - current_volatility).abs() < f64::EPSILON
        {
            return None;
        }

        let rating_changed = (new_rating - current_rating).abs() >= f64::EPSILON;

        let adjustment_type = if rating_changed {
            debug!(
                player_id = player_rating.player_id,
                rating_before = current_rating,
                rating_after = new_rating,
                volatility_before = current_volatility,
                volatility_after = new_volatility,
                "Applying decay (rating decreased)"
            );
            Decay
        } else {
            VolatilityDecay
        };

        Some(RatingAdjustment {
            player_id: player_rating.player_id,
            ruleset: player_rating.ruleset,
            match_id: None,
            rating_before: current_rating,
            rating_after: new_rating,
            volatility_before: current_volatility,
            volatility_after: new_volatility,
            timestamp: wednesday,
            adjustment_type
        })
    }

    /// Calculates the minimum rating (floor) for a player based on their peak rating.
    pub fn calculate_decay_floor(player_rating: &PlayerRating) -> f64 {
        let peak_rating = player_rating
            .adjustments
            .iter()
            .map(|adj| adj.rating_after)
            .fold(player_rating.rating, f64::max);

        Self::decay_floor(peak_rating)
    }

    /// The minimum rating decay can bring a player with this peak rating to.
    fn decay_floor(peak_rating: f64) -> f64 {
        DECAY_MINIMUM.max(0.5 * (DECAY_MINIMUM + peak_rating))
    }

    /// Calculates new volatility after a decay cycle.
    fn calculate_new_volatility(current_volatility: f64) -> f64 {
        let new_volatility = (current_volatility.powf(2.0) + DECAY_VOLATILITY_GROWTH_RATE).sqrt();
        new_volatility.min(VOLATILITY_DECAY_CAP)
    }

    /// Calculates new rating after decay, ensuring it doesn't fall below the decay floor.
    fn calculate_decay_rating(current_rating: f64, decay_floor: f64) -> f64 {
        (current_rating - DECAY_RATE).max(decay_floor)
    }

    /// Guards the decay invariants: a decay adjustment may never increase a
    /// player's rating or decrease their volatility. Returns clamped values,
    /// logging a warning if an unexpected decay attempt was blocked.
    fn enforce_decay_invariants(
        player_id: i32,
        wednesday: DateTime<FixedOffset>,
        current_rating: f64,
        new_rating: f64,
        current_volatility: f64,
        new_volatility: f64
    ) -> (f64, f64) {
        let mut rating = new_rating;
        let mut volatility = new_volatility;

        if rating > current_rating {
            warn!(
                player_id,
                timestamp = %wednesday,
                rating_before = current_rating,
                attempted_rating_after = rating,
                "Unexpected decay attempt would have increased rating; clamping to previous rating"
            );
            rating = current_rating;
        }

        if volatility < current_volatility {
            warn!(
                player_id,
                timestamp = %wednesday,
                volatility_before = current_volatility,
                attempted_volatility_after = volatility,
                "Unexpected decay attempt would have decreased volatility; clamping to previous volatility"
            );
            volatility = current_volatility;
        }

        (rating, volatility)
    }
}

impl Default for UnifiedDecaySystem {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        model::{constants::decay_start_date, structures::ruleset::Ruleset},
        utils::test_utils::generate_player_rating
    };
    use approx::assert_abs_diff_eq;
    use chrono::{Datelike, TimeZone, Timelike, Utc};

    /// Test helper that combines prepare_decay_pass + apply_decay in one call.
    fn apply_decay_up_to(
        system: &mut UnifiedDecaySystem,
        ratings: &mut [PlayerRating],
        up_to: DateTime<FixedOffset>
    ) -> usize {
        system.prepare_decay_pass(up_to);
        system.apply_decay(ratings)
    }

    #[test]
    fn test_get_wednesdays_between_multiple_wednesdays() {
        // Span 3 weeks - should have 3 Wednesdays
        let from = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset(); // Monday
        let to = Utc.with_ymd_and_hms(2024, 1, 22, 12, 0, 0).unwrap().fixed_offset(); // 3 weeks later

        let timestamps = UnifiedDecaySystem::get_wednesdays_between(from, to);
        assert_eq!(timestamps.len(), 3);

        for ts in &timestamps {
            assert_eq!(ts.weekday(), chrono::Weekday::Wed);
            assert_eq!(ts.hour(), 12);
        }
    }

    #[test]
    fn test_rating_chain_consistency() {
        let mut system = UnifiedDecaySystem::new();
        let initial_rating = 1500.0;
        let initial_volatility = 200.0;

        // Create an inactive player
        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            initial_rating,
            initial_volatility,
            2,
            Some(last_played),
            Some(last_played)
        )];

        // Establish baseline
        let first_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, first_time);

        // Process 3 Wednesdays
        let later_time = Utc.with_ymd_and_hms(2024, 1, 22, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, later_time);

        // Check chain consistency
        let decay_adjustments: Vec<_> = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay)
            .collect();

        assert!(decay_adjustments.len() >= 2, "Should have multiple decay adjustments");

        for window in decay_adjustments.windows(2) {
            assert_abs_diff_eq!(window[1].rating_before, window[0].rating_after, epsilon = 0.01);
            assert_abs_diff_eq!(window[1].volatility_before, window[0].volatility_after, epsilon = 0.01);
        }
    }

    #[test]
    fn test_at_floor_still_gets_volatility() {
        let mut system = UnifiedDecaySystem::new();

        // Create an inactive player at the decay floor
        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            DECAY_MINIMUM, // Already at floor
            200.0,
            2,
            Some(last_played),
            Some(last_played)
        )];

        // Establish baseline
        let first_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, first_time);

        // Process one Wednesday
        let second_time = Utc.with_ymd_and_hms(2024, 1, 8, 12, 0, 0).unwrap().fixed_offset();
        let count = apply_decay_up_to(&mut system, &mut ratings, second_time);

        assert_eq!(count, 1, "Should still create adjustment for volatility");

        let last_adj = ratings[0].adjustments.last().unwrap();
        assert_eq!(last_adj.adjustment_type, VolatilityDecay); // Rating unchanged, so VolatilityDecay
        assert_abs_diff_eq!(last_adj.rating_before, last_adj.rating_after); // Rating unchanged (at floor)
        assert!(last_adj.volatility_after > last_adj.volatility_before); // Volatility increased
    }

    #[test]
    fn test_at_cap_still_gets_rating_decay() {
        let mut system = UnifiedDecaySystem::new();

        // Create an inactive player at volatility cap
        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1500.0,
            VOLATILITY_DECAY_CAP, // At cap
            2,
            Some(last_played),
            Some(last_played)
        )];

        // Establish baseline
        let first_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, first_time);

        // Process one Wednesday
        let second_time = Utc.with_ymd_and_hms(2024, 1, 8, 12, 0, 0).unwrap().fixed_offset();
        let count = apply_decay_up_to(&mut system, &mut ratings, second_time);

        assert_eq!(count, 1, "Should still create adjustment for rating decay");

        let last_adj = ratings[0].adjustments.last().unwrap();
        assert_eq!(last_adj.adjustment_type, Decay); // Rating changes, so it's Decay
        assert!(last_adj.rating_after < last_adj.rating_before); // Rating decreased
        assert_abs_diff_eq!(last_adj.volatility_before, last_adj.volatility_after);
        // Volatility unchanged
    }

    #[test]
    fn test_initial_only_no_rating_decay() {
        let mut system = UnifiedDecaySystem::new();
        let first_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();

        // Only an Initial adjustment (no matches), above the decay floor so
        // that only the missing match keeps the rating from decaying
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1500.0,
            200.0,
            1,
            Some(first_time),
            Some(first_time)
        )];

        // Establish baseline
        apply_decay_up_to(&mut system, &mut ratings, first_time);

        // Process many Wednesdays (even past 184 days)
        let later_time = Utc.with_ymd_and_hms(2024, 12, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, later_time);

        // All adjustments should be VolatilityDecay (player never played, so not "inactive")
        let volatility_decay_adjustments: Vec<_> = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == VolatilityDecay)
            .collect();

        assert!(
            !volatility_decay_adjustments.is_empty(),
            "Should have VolatilityDecay adjustments"
        );
        for adj in &volatility_decay_adjustments {
            assert_abs_diff_eq!(adj.rating_before, adj.rating_after, epsilon = 0.01);
        }

        // Should have no Decay adjustments
        let decay_adjustments: Vec<_> = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay)
            .collect();
        assert!(
            decay_adjustments.is_empty(),
            "Should have no Decay adjustments for player who never played"
        );
    }

    #[test]
    fn test_adjustment_timestamps_are_wednesdays() {
        let mut system = UnifiedDecaySystem::new();
        let mut ratings = vec![generate_player_rating(1, Ruleset::Osu, 1000.0, 200.0, 2, None, None)];

        // Establish baseline
        let first_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, first_time);

        // Process several weeks
        let later_time = Utc.with_ymd_and_hms(2024, 2, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, later_time);

        // All decay adjustments (both Decay and VolatilityDecay) should be on Wednesdays at 12:00 UTC
        let decay_adjustments: Vec<_> = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay || a.adjustment_type == VolatilityDecay)
            .collect();

        assert!(!decay_adjustments.is_empty(), "Should have decay adjustments");
        for adj in decay_adjustments {
            assert_eq!(adj.timestamp.weekday(), chrono::Weekday::Wed);
            assert_eq!(adj.timestamp.with_timezone(&Utc).hour(), 12);
        }
    }

    #[test]
    fn test_prepare_decay_pass() {
        let mut system = UnifiedDecaySystem::new();
        let monday = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();

        // The first call only sets the baseline
        assert!(!system.prepare_decay_pass(monday));
        assert_eq!(system.last_processed_wednesday, Some(monday));

        // False lets OtrModel skip cloning every leaderboard before a match
        assert!(!system.prepare_decay_pass(monday + Duration::days(1)));
        assert!(system.prepare_decay_pass(monday + Duration::days(7)));
    }

    #[test]
    fn test_decay_rating_decrease_exactly_decay_rate() {
        let mut system = UnifiedDecaySystem::new();
        let initial_rating = 1500.0;
        let initial_volatility = 200.0;

        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            initial_rating,
            initial_volatility,
            2,
            Some(last_played),
            Some(last_played)
        )];

        let baseline = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, baseline);

        let after_one_wednesday = Utc.with_ymd_and_hms(2024, 1, 10, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, after_one_wednesday);

        let decay_adj = ratings[0]
            .adjustments
            .iter()
            .find(|a| a.adjustment_type == Decay)
            .expect("Should have Decay adjustment");

        let expected_decrease = DECAY_RATE;
        assert_abs_diff_eq!(
            decay_adj.rating_before - decay_adj.rating_after,
            expected_decrease,
            epsilon = 0.001
        );
    }

    #[test]
    fn test_decay_volatility_increase_formula_exact() {
        let mut system = UnifiedDecaySystem::new();
        let initial_volatility = 200.0;

        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1500.0,
            initial_volatility,
            2,
            Some(last_played),
            Some(last_played)
        )];

        let baseline = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, baseline);

        let after_one_wednesday = Utc.with_ymd_and_hms(2024, 1, 10, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, after_one_wednesday);

        let decay_adj = ratings[0]
            .adjustments
            .iter()
            .find(|a| a.adjustment_type == Decay)
            .expect("Should have Decay adjustment");

        let expected_volatility = (initial_volatility.powi(2) + DECAY_VOLATILITY_GROWTH_RATE)
            .sqrt()
            .min(VOLATILITY_DECAY_CAP);

        assert_abs_diff_eq!(decay_adj.volatility_after, expected_volatility, epsilon = 0.001);
    }

    #[test]
    fn test_decay_floor_formula_low_peak() {
        let rating = generate_player_rating(1, Ruleset::Osu, 500.0, 200.0, 2, None, None);

        let floor = UnifiedDecaySystem::calculate_decay_floor(&rating);

        assert_abs_diff_eq!(floor, DECAY_MINIMUM, epsilon = 0.001);
    }

    #[test]
    fn test_decay_floor_formula_high_peak() {
        let peak_rating = 2000.0;
        let rating = generate_player_rating(1, Ruleset::Osu, peak_rating, 200.0, 2, None, None);

        let floor = UnifiedDecaySystem::calculate_decay_floor(&rating);
        let expected_floor = 0.5 * (DECAY_MINIMUM + peak_rating);

        assert_abs_diff_eq!(floor, expected_floor, epsilon = 0.001);
    }

    #[test]
    fn test_decay_all_non_osu_rulesets() {
        use Ruleset::*;
        // Inactive player: last played 2023-01-01, baseline is 2024-01-01 (1 year inactive)
        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let baseline = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let after_one_wednesday = Utc.with_ymd_and_hms(2024, 1, 4, 12, 0, 0).unwrap().fixed_offset();

        for ruleset in [Taiko, Catch, ManiaOther, Mania4k, Mania7k] {
            let mut system = UnifiedDecaySystem::new();
            let mut ratings = vec![generate_player_rating(
                1,
                ruleset,
                1500.0,
                200.0,
                2,
                Some(last_played),
                Some(last_played)
            )];

            apply_decay_up_to(&mut system, &mut ratings, baseline);
            let count = apply_decay_up_to(&mut system, &mut ratings, after_one_wednesday);

            assert_eq!(count, 1, "{ruleset:?}");
            let adj = ratings[0].adjustments.last().unwrap();
            assert_eq!(adj.ruleset, ruleset);
            assert_eq!(adj.adjustment_type, Decay, "{ruleset:?}");
            assert!(adj.rating_after < adj.rating_before, "{ruleset:?}");
            assert!(adj.volatility_after > adj.volatility_before, "{ruleset:?}");
        }
    }

    #[test]
    fn test_decay_exactly_at_184_day_boundary() {
        let mut system = UnifiedDecaySystem::new();
        let initial_rating = 1500.0;
        let initial_volatility = 200.0;

        let last_played = Utc.with_ymd_and_hms(2024, 1, 4, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            initial_rating,
            initial_volatility,
            2,
            Some(last_played),
            Some(last_played)
        )];

        apply_decay_up_to(&mut system, &mut ratings, last_played);

        let day_183 = Utc.with_ymd_and_hms(2024, 7, 5, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, day_183);

        let volatility_decay_count = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == VolatilityDecay)
            .count();
        let decay_count = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay)
            .count();

        assert!(volatility_decay_count > 0, "Should have VolatilityDecay adjustments");
        assert_eq!(decay_count, 0, "Should NOT have Decay adjustments before 184 days");

        let day_188 = Utc.with_ymd_and_hms(2024, 7, 10, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, day_188);

        let decay_count_after = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay)
            .count();

        assert!(decay_count_after > 0, "Should have Decay adjustments after 184 days");
    }

    #[test]
    fn test_volatility_approaches_cap_gradually() {
        let mut system = UnifiedDecaySystem::new();
        let initial_volatility = 200.0;
        // Active player: last played matches first_time
        let first_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1000.0,
            initial_volatility,
            2,
            Some(first_time),
            Some(first_time)
        )];

        apply_decay_up_to(&mut system, &mut ratings, first_time);

        let many_weeks_later = Utc.with_ymd_and_hms(2024, 6, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, many_weeks_later);

        let volatility_decay_adjs: Vec<_> = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == VolatilityDecay)
            .collect();

        for adj in &volatility_decay_adjs {
            assert!(
                adj.volatility_after <= VOLATILITY_DECAY_CAP,
                "Volatility should never exceed cap"
            );
        }

        let last_volatility = ratings[0].volatility;
        assert!(
            last_volatility <= VOLATILITY_DECAY_CAP,
            "Final volatility should not exceed cap"
        );
    }

    #[test]
    fn test_volatility_at_cap_no_further_increase() {
        let mut system = UnifiedDecaySystem::new();
        // Active player at volatility cap: last played matches first_time
        let first_time = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1000.0,
            VOLATILITY_DECAY_CAP,
            2,
            Some(first_time),
            Some(first_time)
        )];

        apply_decay_up_to(&mut system, &mut ratings, first_time);

        let second_time = Utc.with_ymd_and_hms(2024, 1, 8, 12, 0, 0).unwrap().fixed_offset();
        let count = apply_decay_up_to(&mut system, &mut ratings, second_time);

        assert_eq!(
            count, 0,
            "Should not create adjustment when at volatility cap and active"
        );
    }

    #[test]
    fn test_decay_stops_exactly_at_floor() {
        let mut system = UnifiedDecaySystem::new();

        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1000.0,
            200.0,
            2,
            Some(last_played),
            Some(last_played)
        )];

        // Calculate the actual decay floor based on the generated player's peak rating
        let actual_decay_floor = UnifiedDecaySystem::calculate_decay_floor(&ratings[0]);

        let baseline = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, baseline);

        let many_weeks_later = Utc.with_ymd_and_hms(2024, 6, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, many_weeks_later);

        assert!(
            ratings[0].rating >= actual_decay_floor - 0.001,
            "Rating should not fall below floor"
        );
    }

    #[test]
    fn test_both_at_caps_produces_no_adjustment() {
        let mut system = UnifiedDecaySystem::new();

        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            DECAY_MINIMUM,
            VOLATILITY_DECAY_CAP,
            2,
            Some(last_played),
            Some(last_played)
        )];

        let baseline = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, baseline);

        let adj_count_before = ratings[0].adjustments.len();
        let second_time = Utc.with_ymd_and_hms(2024, 1, 8, 12, 0, 0).unwrap().fixed_offset();
        let count = apply_decay_up_to(&mut system, &mut ratings, second_time);

        assert_eq!(count, 0, "Should not create adjustment when at both caps");
        assert_eq!(
            ratings[0].adjustments.len(),
            adj_count_before,
            "Adjustment count should not change"
        );
    }

    #[test]
    fn test_multiple_players_independent_decay() {
        let mut system = UnifiedDecaySystem::new();

        let last_played_active = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let last_played_inactive = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();

        let active_player = generate_player_rating(
            1,
            Ruleset::Osu,
            1000.0,
            200.0,
            2,
            Some(last_played_active),
            Some(last_played_active)
        );

        let inactive_player = generate_player_rating(
            2,
            Ruleset::Osu,
            1500.0,
            200.0,
            2,
            Some(last_played_inactive),
            Some(last_played_inactive)
        );

        let mut ratings = vec![active_player, inactive_player];

        let baseline = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, baseline);

        // 2024-01-04 is Thursday, so only one Wednesday (2024-01-03) is between baseline and this
        let after_one_wednesday = Utc.with_ymd_and_hms(2024, 1, 4, 12, 0, 0).unwrap().fixed_offset();
        let count = apply_decay_up_to(&mut system, &mut ratings, after_one_wednesday);

        assert_eq!(count, 2, "Should create adjustment for each player");

        let active_adj = ratings[0].adjustments.last().unwrap();
        let inactive_adj = ratings[1].adjustments.last().unwrap();

        assert_eq!(active_adj.adjustment_type, VolatilityDecay);
        assert_eq!(inactive_adj.adjustment_type, Decay);
    }

    #[test]
    fn test_decay_transition_at_threshold() {
        let mut system = UnifiedDecaySystem::new();
        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1500.0,
            200.0,
            2,
            Some(last_played),
            Some(last_played)
        )];

        apply_decay_up_to(&mut system, &mut ratings, last_played);
        let end_date = last_played + Duration::days(DECAY_DAYS as i64 + 60);
        let total_count = apply_decay_up_to(&mut system, &mut ratings, end_date);

        let all_wednesdays = UnifiedDecaySystem::get_wednesdays_between(last_played, end_date);
        let expected_active = all_wednesdays
            .iter()
            .filter(|w| (**w - last_played).num_days() < DECAY_DAYS as i64)
            .count();
        let expected_inactive = all_wednesdays.len() - expected_active;

        let volatility_count = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == VolatilityDecay)
            .count();
        let decay_count = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay)
            .count();

        assert_eq!(volatility_count, expected_active);
        assert_eq!(decay_count, expected_inactive);
        assert_eq!(total_count, all_wednesdays.len());
    }

    #[test]
    fn test_enforce_decay_invariants_blocks_rating_increase() {
        let wednesday = Utc.with_ymd_and_hms(2024, 1, 3, 12, 0, 0).unwrap().fixed_offset();

        // A rating increase must be clamped back to the previous rating
        let (rating, volatility) =
            UnifiedDecaySystem::enforce_decay_invariants(1, wednesday, 900.0, 1000.0, 200.0, 210.0);
        assert_abs_diff_eq!(rating, 900.0);
        assert_abs_diff_eq!(volatility, 210.0);

        // A volatility decrease must be clamped back to the previous volatility
        let (rating, volatility) =
            UnifiedDecaySystem::enforce_decay_invariants(1, wednesday, 1500.0, 1497.0, 200.0, 150.0);
        assert_abs_diff_eq!(rating, 1497.0);
        assert_abs_diff_eq!(volatility, 200.0);

        // Valid decay values pass through untouched
        let (rating, volatility) =
            UnifiedDecaySystem::enforce_decay_invariants(1, wednesday, 1500.0, 1497.0, 200.0, 210.0);
        assert_abs_diff_eq!(rating, 1497.0);
        assert_abs_diff_eq!(volatility, 210.0);
    }

    #[test]
    fn test_inactive_player_below_floor_never_boosted() {
        // A player whose current rating sits below their decay floor must never
        // have decay raise them toward the floor
        let mut system = UnifiedDecaySystem::new();

        let last_played = Utc.with_ymd_and_hms(2023, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            900.0, // Below DECAY_MINIMUM (1000), therefore below any possible floor
            200.0,
            2,
            Some(last_played),
            Some(last_played)
        )];

        let baseline = Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, baseline);

        let many_weeks_later = Utc.with_ymd_and_hms(2024, 6, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, many_weeks_later);

        for adj in ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay || a.adjustment_type == VolatilityDecay)
        {
            assert!(
                adj.rating_after <= adj.rating_before + f64::EPSILON,
                "Decay must never increase rating"
            );
            assert!(
                adj.volatility_after >= adj.volatility_before - f64::EPSILON,
                "Decay must never decrease volatility"
            );
        }
        assert!(
            ratings[0].rating <= 900.0 + f64::EPSILON,
            "Rating must not be boosted toward the floor"
        );
    }

    // --- Decay window start date tests ---

    #[test]
    fn test_decay_starts_on_first_wednesday_after_start_date() {
        // 2019-01-01 is a Tuesday, so the first decay Wednesday should be 2019-01-02
        let start = decay_start_date();
        let first_wednesday = Utc.with_ymd_and_hms(2019, 1, 2, 12, 0, 0).unwrap().fixed_offset();

        // Get Wednesdays spanning the start date boundary
        let from = Utc.with_ymd_and_hms(2018, 12, 20, 12, 0, 0).unwrap().fixed_offset();
        let to = Utc.with_ymd_and_hms(2019, 1, 10, 12, 0, 0).unwrap().fixed_offset();
        let wednesdays = UnifiedDecaySystem::get_wednesdays_between(from, to);

        assert!(!wednesdays.is_empty(), "Should have at least one Wednesday");
        assert_eq!(
            wednesdays[0], first_wednesday,
            "First decay Wednesday should be 2019-01-02 (day after start date)"
        );
        // All Wednesdays should be on or after the start date
        for w in &wednesdays {
            assert!(*w >= start, "Wednesday {w} should be on or after decay start date");
        }
    }

    #[test]
    fn test_decay_spanning_start_date_boundary() {
        // A decay window crossing 2019-01-01 should only produce post-cutoff adjustments
        let mut system = UnifiedDecaySystem::new();

        // Player last played in 2017, so they're well past the inactivity threshold
        let last_played = Utc.with_ymd_and_hms(2017, 1, 1, 12, 0, 0).unwrap().fixed_offset();
        let mut ratings = vec![generate_player_rating(
            1,
            Ruleset::Osu,
            1500.0,
            200.0,
            2,
            Some(last_played),
            Some(last_played)
        )];

        // Establish baseline before the cutoff
        let baseline = Utc.with_ymd_and_hms(2018, 11, 1, 12, 0, 0).unwrap().fixed_offset();
        apply_decay_up_to(&mut system, &mut ratings, baseline);

        // Process across the boundary into 2019
        let after_cutoff = Utc.with_ymd_and_hms(2019, 2, 1, 12, 0, 0).unwrap().fixed_offset();
        let count = apply_decay_up_to(&mut system, &mut ratings, after_cutoff);

        assert!(count > 0, "Should have decay adjustments after 2019-01-01");

        // All adjustments should be on or after decay_start_date
        let start = decay_start_date();
        let decay_adjs: Vec<_> = ratings[0]
            .adjustments
            .iter()
            .filter(|a| a.adjustment_type == Decay || a.adjustment_type == VolatilityDecay)
            .collect();

        for adj in &decay_adjs {
            assert!(
                adj.timestamp >= start,
                "Adjustment at {} should be on or after decay start date",
                adj.timestamp
            );
        }
    }
}
