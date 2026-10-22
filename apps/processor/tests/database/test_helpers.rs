use serde::Deserialize;
use std::{
    fs,
    path::Path,
    process::{Command, Stdio}
};
use testcontainers::{runners::AsyncRunner, ContainerAsync, ImageExt};
use testcontainers_modules::postgres::Postgres;
use tokio_postgres::{Client, NoTls};

/// otr's drizzle migrations, which own the schema the processor reads and writes.
const MIGRATIONS_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../web/drizzle");

/// Production's PostgreSQL major version.
const POSTGRES_TAG: &str = "17";

/// The comment lines that open the baseline migration, above its commented-out SQL.
const BASELINE_HEADER_LINES: usize = 3;

#[derive(Deserialize)]
struct Journal {
    entries: Vec<JournalEntry>
}

#[derive(Deserialize)]
struct JournalEntry {
    tag: String
}

pub struct TestDatabase {
    pub connection_string: String,
    _container: ContainerAsync<Postgres>
}

impl TestDatabase {
    pub async fn new() -> Result<Self, Box<dyn std::error::Error>> {
        // Start PostgreSQL container
        let container = Postgres::default().with_tag(POSTGRES_TAG).start().await?;
        let port = container.get_host_port_ipv4(5432).await?;

        let connection_string = format!(
            "host=localhost port={} user=postgres password=postgres dbname=postgres",
            port
        );

        // Connect and create schema
        let (mut client, connection) = tokio_postgres::connect(&connection_string, NoTls).await?;

        // Spawn the connection handler
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("Database connection error: {}", e);
            }
        });

        apply_migrations(&mut client).await?;

        Ok(TestDatabase {
            connection_string,
            _container: container
        })
    }

    pub async fn get_client(&self) -> Result<Client, Box<dyn std::error::Error>> {
        let (client, connection) = tokio_postgres::connect(&self.connection_string, NoTls).await?;

        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("Database connection error: {}", e);
            }
        });

        Ok(client)
    }

    pub async fn seed_test_data(&self) -> Result<(), Box<dyn std::error::Error>> {
        let client = self.get_client().await?;

        // Insert test players
        client
            .execute(
                "INSERT INTO players (username, osu_id, country) 
             OVERRIDING SYSTEM VALUE
             VALUES 
             ('TestPlayer1', 1001, 'US'),
             ('TestPlayer2', 1002, 'US'),
             ('TestPlayer3', 1003, 'GB'),
             ('TestPlayer4', 1004, 'GB')",
                &[]
            )
            .await?;

        // Get the inserted player IDs
        let rows = client.query("SELECT id FROM players ORDER BY osu_id", &[]).await?;
        let player_ids: Vec<i32> = rows.iter().map(|row| row.get(0)).collect();

        // Insert player_osu_ruleset_data (this is what maps to ruleset_data in the Player struct)
        let ruleset_data = vec![
            (player_ids[0], 0, 5000.0, 1000),
            (player_ids[1], 0, 4000.0, 2000),
            (player_ids[2], 0, 3000.0, 3000),
            (player_ids[3], 0, 2000.0, 4000),
        ];

        for (player_id, ruleset, pp, global_rank) in ruleset_data {
            client
                .execute(
                    "INSERT INTO player_osu_ruleset_data (player_id, ruleset, pp, global_rank) VALUES 
                 ($1, $2, $3, $4)",
                    &[&player_id, &ruleset, &pp, &global_rank]
                )
                .await?;
        }

        // Insert player highest ranks for testing
        for (i, player_id) in player_ids.iter().enumerate() {
            let rank = (i + 1) * 1000;
            client.execute(
                "INSERT INTO player_highest_ranks (player_id, ruleset, global_rank, global_rank_date, country_rank, country_rank_date) VALUES 
                 ($1, 0, $2, '2024-01-01 00:00:00+00', $3, '2024-01-01 00:00:00+00')",
                &[player_id, &(rank as i32), &(((i + 1) * 100) as i32)]
            ).await?;
        }

        // Insert a test tournament
        client.execute(
            "INSERT INTO tournaments (name, abbreviation, forum_url, rank_range_lower_bound, ruleset, lobby_size, verification_status) 
             OVERRIDING SYSTEM VALUE
             VALUES 
             ('Test Tournament', 'TT', 'https://example.com', 0, 0, 8, 4)",
            &[]
        ).await?;

        let tournament_id: i32 = client
            .query_one("SELECT id FROM tournaments WHERE abbreviation = 'TT'", &[])
            .await?
            .get(0);

        // Insert test matches
        client
            .execute(
                "INSERT INTO matches (osu_id, name, start_time, end_time, verification_status, tournament_id) 
             OVERRIDING SYSTEM VALUE
             VALUES 
             (12345, 'Test Match 1', '2024-01-01 12:00:00+00', '2024-01-01 13:00:00+00', 4, $1),
             (12346, 'Test Match 2', '2024-01-02 12:00:00+00', '2024-01-02 13:00:00+00', 4, $1)",
                &[&tournament_id]
            )
            .await?;

        let match_ids: Vec<i32> = client
            .query("SELECT id FROM matches ORDER BY osu_id", &[])
            .await?
            .iter()
            .map(|row| row.get(0))
            .collect();

        // No need to link matches to tournament - it's done via foreign key

        // Insert games
        client.execute(
            "INSERT INTO games (osu_id, match_id, start_time, end_time, beatmap_id, ruleset, scoring_type, team_type, mods, verification_status) 
             OVERRIDING SYSTEM VALUE
             VALUES 
             (1, $1, '2024-01-01 12:00:00+00', '2024-01-01 12:10:00+00', NULL, 0, 0, 0, 0, 4),
             (2, $1, '2024-01-01 12:15:00+00', '2024-01-01 12:25:00+00', NULL, 0, 0, 0, 0, 4),
             (3, $2, '2024-01-02 12:00:00+00', '2024-01-02 12:10:00+00', NULL, 0, 0, 0, 0, 4)",
            &[&match_ids[0], &match_ids[1]]
        ).await?;

        let game_ids: Vec<i32> = client
            .query("SELECT id FROM games ORDER BY osu_id", &[])
            .await?
            .iter()
            .map(|row| row.get(0))
            .collect();

        // Insert game scores: (player index, game index, raw score, max combo, placement).
        // The columns the processor never reads take one fixed value.
        let score_values = [
            (0, 0, 1000000, 500, 1),
            (1, 0, 900000, 450, 2),
            (2, 0, 800000, 400, 3),
            (3, 0, 700000, 350, 4),
            (0, 1, 950000, 480, 2),
            (1, 1, 1000000, 500, 1),
            (2, 1, 850000, 420, 3),
            (3, 1, 750000, 370, 4),
            (0, 2, 980000, 490, 1),
            (1, 2, 920000, 460, 2)
        ];

        for (player, game, raw_score, max_combo, placement) in score_values {
            client
                .execute(
                    "INSERT INTO game_scores (player_id, game_id, raw_score, max_combo, placement, accuracy, pass, is_perfect_combo, legacy_perfect, legacy_total_score, grade, mods, team, ruleset, verification_status, rejection_reason)
                     VALUES ($1, $2, $3, $4, $5, 0.95, true, false, false, $3, 0, 0, 0, 0, 4, 0)",
                    &[&player_ids[player], &game_ids[game], &raw_score, &max_combo, &placement]
                )
                .await?;
        }

        Ok(())
    }
}

/// Builds the processor binary and returns its path.
pub fn processor_binary() -> &'static str {
    let build_output = Command::new("cargo")
        .args(["build", "--bin", "otr-processor"])
        .output()
        .expect("Failed to execute cargo build");

    if !build_output.status.success() {
        panic!(
            "Failed to build processor: {}\n{}",
            String::from_utf8_lossy(&build_output.stdout),
            String::from_utf8_lossy(&build_output.stderr)
        );
    }

    if cfg!(debug_assertions) {
        "target/debug/otr-processor"
    } else {
        "target/release/otr-processor"
    }
}

/// A processor run against the test database. `DATABASE_URL` is set because
/// dotenvy would otherwise load it from otr's root .env and reach the local
/// database.
pub fn processor(binary: &str, test_db: &TestDatabase) -> Command {
    let mut command = Command::new(binary);
    command
        .env("DATABASE_URL", &test_db.connection_string)
        .env("RUST_LOG", "warn")
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    command
}

/// Every row of `table` as text in a stable order, so snapshots compare by content.
pub async fn snapshot(client: &Client, table: &str) -> String {
    client
        .query_one(
            &format!("SELECT COALESCE(string_agg(t::text, E'\\n' ORDER BY t::text), '') FROM {table} t"),
            &[]
        )
        .await
        .expect("Failed to snapshot table")
        .get(0)
}

pub async fn row_count(client: &Client, table: &str) -> i64 {
    client
        .query_one(&format!("SELECT COUNT(*) FROM {table}"), &[])
        .await
        .expect("Failed to count rows")
        .get(0)
}

/// Builds the schema from otr's drizzle migrations, as `drizzle-kit migrate`
/// does for a new database: every migration in journal order, inside one
/// transaction, one statement-breakpoint chunk at a time. The processor reads
/// and writes these tables with raw SQL, so its tests must see the schema that
/// production runs, not a hand-maintained copy of it.
async fn apply_migrations(client: &mut Client) -> Result<(), Box<dyn std::error::Error>> {
    let dir = Path::new(MIGRATIONS_DIR);
    let journal: Journal = serde_json::from_str(&fs::read_to_string(dir.join("meta/_journal.json"))?)?;

    let transaction = client.transaction().await?;
    for (index, entry) in journal.entries.iter().enumerate() {
        let mut sql = fs::read_to_string(dir.join(format!("{}.sql", entry.tag)))?;
        if index == 0 {
            sql = uncomment_baseline(&entry.tag, &sql);
        }

        for statement in sql.split("--> statement-breakpoint") {
            transaction.batch_execute(statement).await.map_err(|e| {
                let detail = e.as_db_error().map_or_else(|| e.to_string(), |db| db.to_string());
                format!("migration {} failed: {}", entry.tag, detail)
            })?;
        }
    }
    transaction.commit().await?;

    Ok(())
}

/// The baseline migration ships commented out so `drizzle-kit migrate` leaves
/// existing databases alone. This drops its header and strips each `-- `
/// prefix, the same edit CI's web test job makes with
/// `sed -e '1,3d' -e 's/^-- //'`. It panics if the file has changed shape, so a
/// new layout fails here instead of building a partial schema.
fn uncomment_baseline(tag: &str, sql: &str) -> String {
    let mut lines = sql.lines();
    let header: Vec<_> = lines.by_ref().take(BASELINE_HEADER_LINES).collect();
    assert!(
        header.len() == BASELINE_HEADER_LINES && header.iter().all(|line| line.starts_with("-- ")),
        "{tag} no longer opens with a {BASELINE_HEADER_LINES}-line comment header"
    );

    lines
        .map(|line| {
            if line.is_empty() {
                return line;
            }
            line.strip_prefix("-- ")
                .unwrap_or_else(|| panic!("{tag} has a line that is not commented out: {line}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}
