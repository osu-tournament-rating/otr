# otr-scripts agent guidance

The scripts live in otr at `apps/scripts`. They are Python, not a bun
workspace: run their commands from this directory with Python 3.14 and `uv`,
unlike the rest of otr. Pull requests follow the root `pull-request` skill.

Merging a change here deploys it. Every release installs this directory on
the production host, where the Tuesday processor cron runs it, and the dev
tier's deploy and nightly runs install it from `master` on the dev host, where
`dev-db.sh` restores the replica with it. `.github/scripts/deploy-ops-scripts.sh`
does the install and documents its layout. Each host's `.env` comes from that
GitHub environment's `SCRIPTS_ENV` secret.

`archive`, `recovery`, `processor`, and `backfill-receipts` operate on
configured infrastructure.
Never run them, upload archives, publish indexes, or deploy while developing.
Stop for manual intervention when a task truly requires one.

`.env` contains credentials and infrastructure paths. `lib.config` loads
`apps/scripts/.env` at import, and only that file: never otr's root `.env`,
which holds different variables. Never commit or print it. Bucket names and
table inclusion policy remain in their existing constants and
`lib/scripts/db.py`.

`otr` and `template-db` are the development exceptions. `otr` manages
per-worktree agent stacks; see Agent stacks below and the root `AGENTS.md`.
`template-db`'s `seed`, `create`, `drop`, and `list` actions manage a dedicated
PostgreSQL container and refuse ports `5432` and `5433`. They can start or
mutate that container; run only the action the task needs. Neither uses the
configured application database.

## Commands

- Setup: `uv sync --locked` installs the versions in `uv.lock`. Add
  `--extra e2e` when pytest-based checks are required. The extra supplies
  pytest; installing it does not authorize external test execution. A new
  worktree gets a copy of the main checkout's `.env` when it has one;
  otherwise build one from `.env.example` and do not copy secrets into it.
- CLI: `uv run python src/main.py --script <operation> [options]`.
- Checks: `uv run ruff check src tests`, `uv run black --check src tests`,
  `uv run python -m compileall -q src`, and focused
  `uv run --extra e2e python -m pytest <path>` tests. Use mocked unit tests for
  operational commands; do not replace execution with test collection. CI runs
  ruff, compileall, black, and `pytest tests -m 'not e2e'` only when a change
  touches `apps/scripts/**`.
- Before database-dependent work, run `./otr up --no-web`. It gives the
  worktree its own copy of the local database with the branch's migrations
  applied. Documentation-only work does not require a database.
- `uv run --extra e2e python -m pytest -m e2e tests/e2e` needs Docker and GCS
  credentials and imports a public archive into an isolated container. Run only
  for an explicitly authorized archive validation.

## Operations and code

- Public archives contain the full schema and only data from
  `public_data_table_whitelist`, publish a SHA-256 file, and refresh the HTML
  index. Dev archives mirror production data except `dev_secret_columns`, which
  are reinserted redacted. Add every new credential column to that list, and
  hide it from `otr_grafana_read_only` in a migration as web migration 0041
  does. They also leave out the rows of `dev_excluded_table_data`, the queued
  jobs, whose tables restore empty.
- Production archives begin by creating `otr_grafana_read_only`, the role
  Grafana reads through, because `pg_dump` keeps its grants but not the role,
  and recovery stops at the first error. Public and dev archives carry no
  grants at all. The deploy's migrate step gives the role its password.
- `recovery` stops services, replaces its configured database, and replays the
  deployed image's pending migrations through the Compose `migrate` profile
  before the stack returns; a failed migration fails the run. It removes only
  older archives of the same kind. `--db-only` leaves the Compose stack running
  and drops only connections to the target database. `--skip-migrations` skips
  the `migrate` service, for the dev tier, which has none: `dev-db.sh` migrates
  the restored seed itself.
- `processor` runs the configured image against configured PostgreSQL. Do not
  treat it as a test command. It passes `DATABASE_URL` and no RabbitMQ URL, so
  it requires an image that queues stats jobs in the database.
- After a run commits, `processor` publishes its receipt (`src/lib/receipt.py`):
  the processor's `OTR_RECEIPT=` stdout line plus the image digest the pull
  printed and that image's release, as `otr-rating-receipt_<start>.json` in
  the public bucket, where otr-replay reads it. Only production publishes;
  other environments keep the file under `DUMP_DIR/receipts`. The ratings are
  already committed, so a receipt problem logs an error and never fails the
  run. With `METRICS_DIR` set, production records
  `otr_rating_receipt_published 0` instead, which raises the
  `RatingReceiptMissing` alert. The processor prints that line and the receipt's run fields; keep them
  in step with `apps/processor/src/receipt.rs` and `apps/replay`.
- `backfill-receipts` derives receipts for the weekly runs from before
  receipts (`src/lib/scripts/receipts_backfill.py`). The schedule, Tuesdays
  12:00 UTC, gives each start; otr-processor's Docker Hub push times and
  otr's successful deploy runs give the image `latest` named then; logs read
  from `--logs-dir` replace both with what the run printed. Each receipt lists
  what was inferred, with its evidence, in `inferred`. It writes them under
  `DUMP_DIR/receipts-backfill` for review, uploads only with `--upload`, and
  never replaces a receipt already in the bucket. A successful upload records
  `otr_rating_receipt_published 1`, which clears that alert.
- `template-db seed` explicitly restores an archive into `otr_template`.
  `create` fetches the supplied web checkout's `origin` default-branch revision,
  runs those migrations on the source template, clones it, and runs the task
  checkout's migrations on the clone using its installed Drizzle tool. A local
  per-user lock serializes seed and create across scripts checkouts.
  Source migration failure blocks creation; repair or explicitly reseed manually.
  Task migration failure retains the clone for inspection and returns failure.
  Existing databases are never replaced. Migrate applies pending migrations; it
  does not establish compatibility with every divergent schema or history.
  `drop` removes an instance, and `list` shows instances and sizes. Names match
  `^[a-z][a-z0-9_]{0,30}$`.
- Confirm environment, image tag, database container and name, web directory,
  and bucket mapping before a live operation.
- Keep CLI contracts in `src/lib/cli.py`, configuration in `src/lib/config.py`,
  and operations in `src/lib/`.
- Prefer argument lists for subprocesses. Preserve upstream failure and quote
  paths when a shell pipeline is unavoidable.
- The cron, `run-script.yml`, and `dev-archive.yml` see only the exit code and
  the log. Each operation returns `True` only when every step worked, and logs
  one error naming the step that failed. `main.py` exits 1 on any other result
  or an uncaught exception. Check every subprocess's return code.
- When `METRICS_DIR` is set, `main.py` also records how each scheduled run on
  the production host ended in node-exporter's textfile collector
  (`src/lib/metrics.py`): the cron's `processor`, `refresh-index`, and
  `archive` to the production and public buckets, and the weekly `archive` to
  the dev bucket that `.github/workflows/dev-archive.yml` runs over SSH. The
  cron must run this installed copy, not an older checkout. Production's alert
  rules in `monitoring/prod/prometheus/rules` raise a Discord alert when the
  last run failed or none finished within its interval. Their thresholds
  follow the production crontab and that workflow's schedule, so update them
  when either changes.

## Agent stacks

`./otr up|down|status` (`apps/scripts/otr` from the repository root) gives
each linked worktree its own stack. The code is `src/otr.py` and
`src/lib/stack/`. It uses only the standard library, so the wrapper runs it
without syncing the venv. It refuses to run in the main checkout.

- The shared base is an online `pg_basebackup` of the container publishing
  port 5432, taken only after checking that it holds an o!TR database. Its
  other databases, and directories no database owns, are dropped. A stack's
  database is a `cp --reflink=auto` copy of the base, which is nearly instant
  and shares disk blocks on btrfs or XFS. `up --fresh` rebuilds the base and
  replaces the stack's copy.
- A new copy's jobs are deleted before its migrations run, so the stack's
  worker never runs jobs queued in the local database. A worker still running
  when `up --fresh` replaces the copy is stopped until then. Restarting a stack
  keeps its jobs.
- Each `up` runs `bun install --frozen-lockfile` and the worktree's pending
  migrations. The web app and worker run on the host from the worktree's code,
  in their own process groups. Monitoring (`grafana/otel-lgtm`) runs in the
  stack's Compose project, from `src/lib/stack/compose.yml`.
- State lives in `~/.local/share/otr/stacks` (or `$OTR_STACKS_DIR`): `base/`,
  one directory per stack with its data, registry entry, and process records,
  and `locks/`. Logs go to the worktree's `.tmp/otr/`.
- Stack slot `n` owns ports `20000 + 10n` through `+9`: web `+0`, PostgreSQL
  `+1`, worker health `+4`, Grafana `+5`, and OTLP over HTTP `+6` and gRPC
  `+7`. `+2` and `+3` were RabbitMQ's and stay unused, so no port moves.
  Everything binds to loopback.
- `up` writes a marked block into the worktree's `.env`. It holds the stack's
  URLs and ports. It turns on test sign-in (`E2E_TEST_AUTH`), and turns off
  scheduled player refetches and the maintenance window. It blanks
  `BEATMAP_FILES_BUCKET`, `BEATMAP_FILES_ACCESS_KEY_ID`, and
  `BEATMAP_FILES_SECRET_ACCESS_KEY`, so a stack never writes to the production
  bucket, and leaves `BEATMAP_FILES_DIR` to the agent, who can set it to store
  beatmap files in a local directory. The tracing endpoint is set only while
  monitoring runs. A running process whose settings changed is restarted.
  After `down`, the block still points at the disposed stack, so nothing falls
  back to the main checkout's services.
