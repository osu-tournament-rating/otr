# otr-processor agent guidance

The processor lives in otr at `apps/processor`. It is not a bun workspace:
run its commands from this directory, unlike the rest of otr. Stable Rust is
pinned in `rust-toolchain.toml` to match `rust-version` in `Cargo.toml`.
`cargo +nightly fmt` is the one nightly command because `rustfmt.toml` uses
unstable options.

This app owns rating calculation and full-rebuild SQL. The rest of otr owns
the schema and migrations. Treat the boundary as a contract. Start task
configuration from the root `.env.example`; never copy credentials, commit
`.env`, or log a credentialed PostgreSQL URL.

`dotenvy` looks for `.env` in the working directory, then in each parent, and
loads the first one it finds without overriding variables already set. A run
from `apps/processor` therefore reads the root `.env` of its checkout. A `.env`
in this directory would shadow the root one.

Running the binary rewrites every rating in its target database, so run it only
against your worktree's own stack. `apps/scripts/otr up --no-web` points the
worktree's `DATABASE_URL` at that stack, and a run from this directory then
uses it. The stats jobs a run queues wait in that database's `jobs` table until
a data worker claims them. Never run the binary from the main checkout, whose
`.env` targets the developer's database, or against production, the dev tier,
or a template database. Testcontainers tests start their own databases.

## Commands

- `cargo run -- --help` lists options. A run needs `DATABASE_URL`, which the
  production cron passes, and nothing else: it queues stats jobs in the same
  database, with no broker. Keep the fallback to the legacy
  `CONNECTION_STRING`. otr-replay and the manual rating reproduction steps
  pass that name, because every processor release reads it.
- `cargo test` runs unit tests. Database tests use Testcontainers and Docker,
  and build each database from otr's drizzle migrations.
  A test that spawns the binary sets `DATABASE_URL` itself; otherwise the root
  `.env` supplies it.
- Before handoff: `cargo +nightly fmt -- --check`, `cargo clippy`, `cargo test`,
  and `git diff --check`. Report unavailable infrastructure as blocked.
- CI runs fmt, clippy with `-D warnings`, and tests only when a change touches
  `apps/processor/**`, `apps/web/drizzle/**`, `packages/otr-core/src/db/**`,
  `packages/otr-core/src/jobs/**`, `packages/otr-core/src/osu/enums.ts`, or
  `packages/otr-core/src/messages/values.ts`, and builds the image on such a
  pull request.
- A release pushes `stagecodes/otr-processor:<release tag>` only when this
  directory changed since the previous release; release notes name the image
  each release runs. Production's cron runs `latest` weekly, Tuesdays 12:00 UTC.

## Ownership

`src/main.rs` orchestrates one recomputation transaction. Keep math in
`src/model/`, persistence, including the stats jobs a run queues, in
`src/database/`, CLI or environment parsing in `src/args.rs`, and shared
helpers in `src/utils/`. Use structured `tracing` fields for diagnostics.

Centralize rating constants in their existing domain modules. A constant change
can rewrite all history; pair it with explicit impact analysis and deterministic
tests.

## Rating invariants

- Preserve chronological match order, match-end fallback, decay boundaries,
  ranking ties, participation behavior, and rating floor semantics.
- Persisted `Ruleset` is `0..=5`; `RatingAdjustmentType` is `0..=3`. Never
  reorder or renumber them. `tests/contracts/` checks them, and the verified
  status the SQL filters on, against `@otr/core`.
- Changes to match weights, initial bounds, decay, volatility, or floors need
  focused unit tests and full-rating tests with expected impact.
- Skip a verified game with fewer than two verified scores and retain its
  data-integrity warning.
- Keep overall ranking, country ranking, percentile, rating history, and highest
  rank consistent for every ruleset.
- Use deterministic fixtures with explicit times and placements. Give float
  assertions a meaningful tolerance.

## Database and job contracts

- `src/database/` consumes the otr schema at
  `packages/otr-core/src/db/schema.ts`; migrations live in `apps/web/drizzle/`.
  Both paths are from the otr root.
  Update row structs, raw SQL, and `COPY` columns for an affected contract.
  The database tests run against a schema built from those migrations, so
  update their seed data when a column they insert changes. Use additive
  migrations.
- Keep recomputation writes on one connection inside the transaction guard.
  Preserve rollback around truncation, `COPY`, score updates, stale-stat
  deletion, and stats job inserts.
- Tournament stats jobs are rows in otr's `jobs` table, inserted inside the
  rating transaction, so they commit or roll back with the ratings. A failed
  insert fails the run. The one exception is a database with no `jobs` table,
  such as an older public replica that otr-replay runs a newer release
  against: the run logs a warning and queues nothing.
- Never add a dedup key or `ON CONFLICT` to that insert. Under repeatable read,
  a conflict with a row committed after the run's snapshot raises a
  serialization failure and rolls back the whole run. Duplicate stats jobs are
  harmless, since each rewrites the tournament's stats.
- The queue name `processing.stats.tournaments`, the camel-case payload
  `{"tournamentId": <id>}`, and the column defaults the insert relies on,
  pending status and normal priority, are contracts with the data worker.
  `tests/contracts/` checks the queue name, `JobStatus.Pending`, and
  `MessagePriority.Normal` against `@otr/core`, and the database tests check the
  payload against `packages/otr-core/src/jobs/__fixtures__/`, which the worker's
  tests also read.
- Every stats job a run queues carries the run id, logged when the run starts,
  as its `correlation_id`.
