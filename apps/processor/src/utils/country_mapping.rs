use crate::database::db_structs::Player;
use std::collections::HashMap;

/// Maps each player id to the player's country code, or to an empty string
/// for a player with no country
pub fn build_country_mapping(players: &[Player]) -> HashMap<i32, String> {
    let mut mapping: HashMap<i32, String> = HashMap::new();
    for p in players {
        mapping.insert(p.id, p.country.clone().unwrap_or_default());
    }

    mapping
}
