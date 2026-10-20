use chrono::Utc;
use clap::Parser;
use otr_processor::{
    args::{first_env, unset_blank_env, Args, ARGS_ENV_VARS, DATABASE_URL_VARS},
    database::db::DbClient,
    model::{otr_model::OtrModel, rating_utils::create_initial_ratings},
    receipt::{RunCounts, RunReceipt},
    utils::country_mapping::build_country_mapping
};
use std::{
    collections::{BTreeSet, HashMap},
    io::Write,
    time::Instant
};
use tracing::{debug, error, info, warn};
use tracing_indicatif::IndicatifLayer;
use tracing_subscriber::{prelude::*, EnvFilter};
use uuid::Uuid;

#[tokio::main]
async fn main() {
    // Used for time tracking
    let start = Instant::now();
    let started_at = Utc::now();

    // Initialize env vars
    let _ = dotenvy::dotenv();

    // Parse args, treating a blank variable as unset
    unset_blank_env(&ARGS_ENV_VARS);
    let args = Args::parse();

    // Initialize tracing with indicatif integration
    init_tracing(&args.log_level);

    // Every stats job this run queues carries the run id as its correlation id
    let run_id = Uuid::new_v4().to_string();
    info!(run_id, "Begin processing...");

    let client: DbClient = client().await;

    let transaction_guard = client.begin_transaction().await.expect("Failed to begin transaction");
    info!("BEGIN TRANSACTION");

    // Execute all operations
    let process_result = async {
        // 1. Calculate and update game score placements
        // This must happen before data fetching and rating processing
        client.calculate_and_update_game_score_placements().await?;
        info!("Game score placements calculated and updated.");

        // 2. Fetch matches and players for processing
        let matches = client.get_matches().await?;
        let players = client.get_players().await?;

        if matches.is_empty() {
            warn!("No matches found to process! Check that matches have verification_status=4");
        } else {
            info!("Found {} matches ready for processing", matches.len());
        }

        debug!("Fetched {} matches and {} players.", matches.len(), players.len());

        // Fetch tournament information for processed matches
        let tournament_info = client.get_tournament_info_for_matches(&matches).await?;
        info!(
            "Fetched tournament information for {} tournaments.",
            tournament_info.len()
        );
        let all_tournament_ids: Vec<i32> = tournament_info.keys().copied().collect();

        // 3. Generate initial ratings
        let initial_ratings = create_initial_ratings(&players, &matches);
        info!("Initial ratings generated.");

        // 4. Generate country mapping and set
        let country_mapping: HashMap<i32, String> = build_country_mapping(&players);
        info!("Country mapping generated.");

        // 5. Create the model
        let mut model = OtrModel::new(&initial_ratings, &country_mapping);
        info!("OTR model created.");

        // 6. Process matches
        let results = model.process(&matches);
        info!("Matches processed.");

        // 7. Save results in database
        client.snapshot_match_rating_adjustments().await?;

        client.save_results(&results).await?;
        info!("Results saved to database.");

        let rating_changed_tournament_ids = client.get_tournaments_with_changed_rating_adjustments().await?;

        // 8. Remove lingering stats and rosters for tournaments/matches/games rejected since the last run
        client.delete_rejected_player_stats().await?;

        // 9. Queue stats jobs for tournaments needing a refresh. They commit
        // with the ratings, and a failed insert rolls back the whole run.
        let mut tournaments_needing_refresh: BTreeSet<i32> = client
            .get_tournaments_needing_stats_refresh(&all_tournament_ids)
            .await?
            .into_iter()
            .collect();

        let rating_change_count = rating_changed_tournament_ids.len();
        let unavailable_rating_changes = rating_changed_tournament_ids
            .iter()
            .filter(|tournament_id| !tournament_info.contains_key(tournament_id))
            .count();
        tournaments_needing_refresh.extend(
            rating_changed_tournament_ids
                .into_iter()
                .filter(|tournament_id| tournament_info.contains_key(tournament_id))
        );

        if unavailable_rating_changes > 0 {
            warn!(
                unavailable_rating_changes,
                "Rating changes were detected for tournaments without currently processable matches"
            );
        }

        let skipped = tournament_info.len().saturating_sub(tournaments_needing_refresh.len());
        info!(
            rating_changed_tournaments = rating_change_count,
            "Enqueueing {} of {} tournaments for stats refresh ({} unchanged)",
            tournaments_needing_refresh.len(),
            tournament_info.len(),
            skipped
        );

        let tournament_ids: Vec<i32> = tournaments_needing_refresh.into_iter().collect();
        client.enqueue_tournament_stats_jobs(&tournament_ids, &run_id).await?;

        let counts = RunCounts {
            matches: matches.len(),
            players: players.len(),
            tournaments: tournament_info.len(),
            ratings: results.len(),
            stats_jobs: tournament_ids.len()
        };
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>((counts, model.decay_horizon()))
    }
    .await;

    match process_result {
        Ok((counts, decay_horizon)) => {
            // COMMIT TRANSACTION
            // A failed COMMIT has already rolled the transaction back.
            if let Err(e) = transaction_guard.commit().await {
                error!("Failed to commit transaction: {}", e);
                std::process::exit(1);
            }
            info!("COMMIT TRANSACTION");

            // Only a committed run has a receipt, and the ratings are already
            // published, so a receipt that cannot be written is only logged.
            print_receipt(&RunReceipt {
                run_id,
                started_at,
                decay_horizon: decay_horizon.map(|horizon| horizon.with_timezone(&Utc)),
                committed_at: Utc::now(),
                counts
            });

            let end = Instant::now();
            info!("Processing complete in {:.2?}", (end - start));
        }
        Err(e) => {
            // ROLLBACK TRANSACTION
            error!("Processing failed: {}", e);
            if let Err(rollback_err) = transaction_guard.rollback().await {
                error!("Failed to rollback transaction: {}", rollback_err);
                error!("WARNING: Transaction may be left in an inconsistent state");
            } else {
                error!("ROLLBACK TRANSACTION completed");
            }
            std::process::exit(1);
        }
    }
}

/// Prints the run's receipt as the one line on stdout. A failure logs an error
/// and leaves the exit code alone, since the run itself succeeded.
fn print_receipt(receipt: &RunReceipt) {
    let line = match receipt.line() {
        Ok(line) => line,
        Err(e) => {
            error!("Failed to write the run receipt: {}", e);
            return;
        }
    };

    let mut stdout = std::io::stdout().lock();
    if let Err(e) = writeln!(stdout, "{line}").and_then(|()| stdout.flush()) {
        error!("Failed to print the run receipt: {}", e);
    }
}

async fn client() -> DbClient {
    let connection_string =
        first_env(&DATABASE_URL_VARS).expect("DATABASE_URL or CONNECTION_STRING environment variable must be set");

    match DbClient::connect(&connection_string).await {
        Ok(client) => client,
        Err(e) => {
            error!("Failed to connect to database: {}", e);
            error!("Application cannot start without a valid database connection");
            std::process::exit(1);
        }
    }
}

fn init_tracing(log_level: &str) {
    let indicatif_layer = IndicatifLayer::new();
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(log_level));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_writer(indicatif_layer.get_stderr_writer()))
        .with(indicatif_layer)
        .init();
}
