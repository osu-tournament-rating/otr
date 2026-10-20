//! Reads the verified data a rebuild rates.

use super::{
    db::{ruleset_column, DbClient},
    db_structs::{Game, GameScore, Match, Player, RulesetData},
    error::DbResult
};
use crate::model::structures::ruleset::Ruleset;
use std::{collections::HashMap, time::Instant};
use tracing::{info, warn};

impl DbClient {
    /// Fetches every verified match of a verified tournament, ordered by start
    /// time, with its verified games and their verified scores in id order.
    ///
    /// A game with fewer than two verified scores cannot be rated, so it is
    /// left out with a data-integrity warning. A match left with no games is
    /// still returned, with a warning of its own.
    pub async fn get_matches(&self) -> DbResult<Vec<Match>> {
        info!("Fetching matches...");
        let started = Instant::now();

        let mut matches = self.fetch_verified_matches().await?;
        let mut games_by_match = self.fetch_verified_games().await?;
        let mut scores_by_game = self.fetch_verified_scores().await?;

        // The sort is stable, so matches that start together stay in id order.
        matches.sort_by_key(|match_| match_.start_time);

        for match_ in &mut matches {
            let games = games_by_match.remove(&match_.id).unwrap_or_default();
            match_.games = games
                .into_iter()
                .filter_map(|mut game| {
                    game.scores = scores_by_game.remove(&game.id).unwrap_or_default();
                    if game.scores.len() >= 2 {
                        return Some(game);
                    }

                    warn!(
                        game_id = game.id,
                        match_id = match_.id,
                        match_name = %match_.name,
                        score_count = game.scores.len(),
                        "DATA INTEGRITY: Verified game has <2 verified scores - skipping (requires o!TR Admin inspection)"
                    );
                    None
                })
                .collect();

            if match_.games.is_empty() {
                warn!(
                    match_id = match_.id,
                    match_name = %match_.name,
                    "DATA INTEGRITY: Match has no valid games after filtering - will be skipped (requires o!TR Admin inspection)"
                );
            }
        }

        info!(count = matches.len(), elapsed = ?started.elapsed(), "Fetched matches");
        Ok(matches)
    }

    /// Verified matches of verified tournaments, in id order and without games.
    ///
    /// A match osu! returned no data for has no start time, so it cannot be
    /// rated or ordered. It is left out with a data-integrity warning instead
    /// of failing the run.
    async fn fetch_verified_matches(&self) -> DbResult<Vec<Match>> {
        let mut matches = Vec::new();

        self.for_each_row(
            "
            SELECT m.id, m.name, m.start_time, m.end_time, t.ruleset
            FROM matches m
            JOIN tournaments t ON t.id = m.tournament_id
            WHERE t.verification_status = 4 AND m.verification_status = 4
            ORDER BY m.id
            ",
            &[],
            |row| {
                let id: i32 = row.try_get("id")?;
                let name: String = row.try_get("name")?;
                let Some(start_time) = row.try_get("start_time")? else {
                    warn!(
                        match_id = id,
                        match_name = %name,
                        "DATA INTEGRITY: Verified match has no start time - skipping (requires o!TR Admin inspection)"
                    );
                    return Ok(());
                };

                matches.push(Match {
                    id,
                    name,
                    start_time,
                    end_time: row.try_get("end_time")?,
                    // A match is rated in its tournament's ruleset.
                    ruleset: ruleset_column(&row, "match")?,
                    games: Vec::new()
                });
                Ok(())
            }
        )
        .await?;

        Ok(matches)
    }

    /// The verified games of [`Self::fetch_verified_matches`], without scores,
    /// grouped by match in id order.
    async fn fetch_verified_games(&self) -> DbResult<HashMap<i32, Vec<Game>>> {
        let mut games: HashMap<i32, Vec<Game>> = HashMap::new();

        self.for_each_row(
            "
            SELECT g.id, g.match_id, g.ruleset, g.start_time, g.end_time
            FROM games g
            JOIN matches m ON m.id = g.match_id
            JOIN tournaments t ON t.id = m.tournament_id
            WHERE g.verification_status = 4
              AND m.verification_status = 4
              AND t.verification_status = 4
            ORDER BY g.match_id, g.id
            ",
            &[],
            |row| {
                games.entry(row.try_get("match_id")?).or_default().push(Game {
                    id: row.try_get("id")?,
                    ruleset: ruleset_column(&row, "game")?,
                    start_time: row.try_get("start_time")?,
                    end_time: row.try_get("end_time")?,
                    scores: Vec::new()
                });
                Ok(())
            }
        )
        .await?;

        Ok(games)
    }

    /// The verified scores of [`Self::fetch_verified_games`], grouped by game
    /// in id order.
    async fn fetch_verified_scores(&self) -> DbResult<HashMap<i32, Vec<GameScore>>> {
        let mut scores: HashMap<i32, Vec<GameScore>> = HashMap::new();

        self.for_each_row(
            "
            SELECT gs.id, gs.game_id, gs.player_id, gs.score, gs.placement
            FROM game_scores gs
            JOIN games g ON g.id = gs.game_id
            JOIN matches m ON m.id = g.match_id
            JOIN tournaments t ON t.id = m.tournament_id
            WHERE gs.verification_status = 4
              AND g.verification_status = 4
              AND m.verification_status = 4
              AND t.verification_status = 4
            ORDER BY gs.game_id, gs.id
            ",
            &[],
            |row| {
                let game_id: i32 = row.try_get("game_id")?;
                scores.entry(game_id).or_default().push(GameScore {
                    id: row.try_get("id")?,
                    player_id: row.try_get("player_id")?,
                    game_id,
                    score: row.try_get("score")?,
                    placement: row.try_get("placement")?
                });
                Ok(())
            }
        )
        .await?;

        Ok(scores)
    }

    /// Fetches every player who has ruleset data, in id order, with that data
    /// in ruleset order.
    ///
    /// A player without ruleset data is left out, because the data worker has
    /// not finished fetching them. Data for a ruleset the processor does not
    /// know is skipped.
    pub async fn get_players(&self) -> DbResult<Vec<Player>> {
        info!("Fetching players...");
        let mut players: Vec<Player> = Vec::new();

        self.for_each_row(
            "
            SELECT p.id, p.username, p.country,
                   prd.ruleset, prd.global_rank, prd.earliest_global_rank
            FROM players p
            JOIN player_osu_ruleset_data prd ON prd.player_id = p.id
            ORDER BY p.id, prd.ruleset
            ",
            &[],
            |row| {
                let id: i32 = row.try_get("id")?;
                if players.last().map(|player| player.id) != Some(id) {
                    players.push(Player {
                        id,
                        username: row.try_get("username")?,
                        country: row.try_get("country")?,
                        ruleset_data: Some(Vec::new())
                    });
                }

                if let Ok(ruleset) = Ruleset::try_from(row.try_get::<_, i32>("ruleset")?) {
                    let player = players.last_mut().expect("the row's player was pushed above");
                    player.ruleset_data.get_or_insert_default().push(RulesetData {
                        ruleset,
                        global_rank: row.try_get("global_rank")?,
                        earliest_global_rank: row.try_get("earliest_global_rank")?
                    });
                }
                Ok(())
            }
        )
        .await?;

        info!(count = players.len(), "Fetched players");
        Ok(players)
    }
}
