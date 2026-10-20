//! The website calls a player inactive in a ruleset once their rating would
//! start to decay, and hides them from the leaderboard by default. It counts
//! the days in `@otr/core`, so this test reads the TypeScript source.

use otr_processor::model::constants::DECAY_DAYS;
use std::fs;

/// `@otr/core`'s player activity rule, from the otr root.
const PLAYER_ACTIVITY: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/otr-core/src/db/player-activity.ts"
);

#[test]
fn test_inactive_after_days_matches_decay_days() {
    let source = fs::read_to_string(PLAYER_ACTIVITY).expect("Failed to read @otr/core player-activity.ts");
    let value = source
        .lines()
        .find_map(|line| line.trim().strip_prefix("export const INACTIVE_AFTER_DAYS = "))
        .expect("@otr/core no longer exports INACTIVE_AFTER_DAYS")
        .trim_end_matches(';');

    assert_eq!(
        value.parse::<u64>().expect("INACTIVE_AFTER_DAYS is not a plain number"),
        DECAY_DAYS
    );
}
