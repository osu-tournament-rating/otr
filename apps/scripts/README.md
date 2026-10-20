# otr-scripts

Operations scripts for the o!TR platform: database archives and recovery, the
weekly processor run and its receipts, and disposable template databases.
They live in otr under `apps/scripts`; run the commands below from this
directory. The scripts read their configuration from `apps/scripts/.env`,
which starts from `.env.example`.

## Getting started

Install deps:

```
uv sync --locked
```

## Agent stacks

`otr` gives each linked worktree of this repository its own disposable
stack: a copy of the database on localhost:5432 and the worktree's web app,
plus the data worker or Grafana on request. Copies share disk blocks with one
another on btrfs or XFS, so each takes about a second to make.

```
./otr up                  # database and web app
./otr up worker           # add the data worker
./otr up monitoring       # add Grafana, Tempo, Loki, and Prometheus
./otr down                # dispose the whole stack
./otr status              # every stack on this machine
./otr down --orphans      # remove stacks whose worktree is gone
```

See "Agent stacks" in `AGENTS.md` for how it works.

## End-to-end tests

External e2e tests live under `tests/e2e`. The public replica import scenario
downloads the latest public archive and hash from GCS, verifies the SHA256
line, and restores the dump into an isolated `postgres:17` Docker container.
The dev replica scenario seeds a disposable container with known credentials,
exports a dev archive, and fails if any secret reaches it.

```
uv sync --locked --extra e2e
uv run python -m pytest -m e2e tests/e2e
```

Unit tests need neither Docker nor credentials:

```
uv run python -m pytest tests -m 'not e2e'
```

## Dev replicas

Dev archives mirror production: every table and every row, audits
included. Only the credential columns in `dev_secret_columns`
(`src/lib/scripts/db.py`) are redacted, keyed on the row id so `NOT NULL` and
`UNIQUE` still hold and `NULL` stays `NULL`. Everything else, including real
user records, is present, so a dev archive is production data and belongs only
on trusted infrastructure.

## Back-populating rating run receipts

Each weekly rating run publishes a receipt in the public bucket, which
otr-replay reads to replay that run. Runs from before receipts existed have
none. `backfill-receipts` derives a receipt for each of them from the Tuesday
12:00 UTC schedule and the release and deploy history, or from the run's log
when one is given. Each derived receipt lists what was inferred, with the
evidence, in `inferred`. `src/lib/scripts/receipts_backfill.py` describes the
derivation.

### Before you start

1. Merge the release that added receipts and let its deploy finish. The deploy
   installs this operation on the production host and points
   `stagecodes/otr-processor:latest` at a processor that prints receipts.
1. Check that the production crontab runs the installed copy at
   `<REMOTE_PATH>/apps/scripts`, so every later Tuesday publishes its own
   receipt.
1. Run the steps below any time after that, except on a Tuesday from 12:00 UTC
   until that day's receipt appears. Until then, the day's run counts as
   missing and would get a derived receipt beside its own.

Derive and upload on the production host, from that installed copy. Its
`.env`, which each deploy writes from the production environment's
`SCRIPTS_ENV` secret, holds everything the operation uses:

- `GCS_SA_JSON_PATH`, the service account that lists and uploads to the public
  bucket, `GCS_PUBLIC_BUCKET`.
- `DUMP_DIR`, under which the receipts are written for review.
- `PUBLIC_HTML_DIR`, where an upload refreshes the index of the public
  replicas site, the list otr-replay reads.
- `METRICS_DIR`, where an upload records that receipts were published.

The operation does not check `ENVIRONMENT`, so never run it with another
host's `.env`: an upload would publish to the bucket that `.env` names and
write the index on the wrong machine. It reads GitHub and Docker Hub
anonymously, or with `GITHUB_TOKEN` when the environment sets one.

Either use a shell on the host:

```
cd <REMOTE_PATH>/apps/scripts
.venv/bin/python src/main.py -s backfill-receipts --logs-dir <log directory>
```

or run the Run script workflow (`run-script.yml`) with environment
`production` and the arguments after `src/main.py` above. It runs in the
`production-ops` environment, uses the same installed copy, and streams the
log. It splits its arguments on whitespace, so no path can contain a space.
Reading the receipt files themselves needs a shell on the host.

### Processor logs

`--logs-dir` names a directory of processor run logs, the files
`-s processor` writes to its `--log-dir`. Repeat it once for each directory.
The operation reads the `*.log` files directly inside each one, not in
subdirectories, and fails when one is not a directory. A logged run that
committed gets its receipt from its log instead of the schedule: its start and
commit times, the image digest its `docker pull` printed when the log has it,
and its decay horizon and counts when the processor printed a receipt line.
Without `--logs-dir`, every receipt comes from the schedule.

Give it the directory the crontab's processor runs log to, which the
crontab's `--log-dir` names, and every other directory holding logs of
production processor runs started by hand. The Run script workflow logs to
`logs/` inside the install it ran from, under `<REMOTE_PATH>/apps/.scripts/`,
and deploys keep only the three newest installs. Give it only production's
logs, since every logged run becomes a production receipt.

Gather every directory before the first upload. A day whose logged runs all
failed gets no receipt, so leaving out the log of a successful rerun drops
that week. Once a day has a receipt in the bucket, a later run skips a logged
run of that day only if it started within a minute of that receipt's time.
Otherwise it adds a second receipt for the same run.

### Derive and review

1. Run the command above. Without `--upload`, nothing is published. The run
   writes the receipts to `DUMP_DIR/receipts-backfill` and logs one line per
   receipt with the release it names and the fields it inferred, then a
   warning for each run it could not fully infer, then a total:

   ```
   otr-rating-receipt_2026-06-23T12:00:00Z.json: release 2026.05.18, inferred started_at, processor
   Derived <n> receipts into <DUMP_DIR>/receipts-backfill from <n> logged runs; <n> receipts were already published
   Review them, then run again with --upload to publish them
   ```

1. Check that every Tuesday since 2025-10-07, the first after the first
   public replica, has a receipt here or in the bucket. A committed logged run
   replaces its day's schedule guess, and a day whose logged runs all failed
   has none.
1. Check that `processor.release` changes where you expect, and that
   `inferred.processor` names the release build or deploy that pointed
   `latest` at that image before the run.
1. Resolve every warning, as described below.

The directory keeps the files of earlier runs. A run's receipts are the files
its log lists.

### Warnings

- `<log>: the run that started <time> never committed`: that run failed. If
  every logged run of that day failed, the day gets no receipt. When ratings
  were published that day anyway, add the directory holding the log of the
  run that published them.
- `No processor image is known to have been latest at <time>`, or
  `The image latest named at <time> is unknown: <evidence>`: the receipt names
  no image, as after a release was redeployed by hand, which the deploy
  history does not record. A log of that run supplies the digest its pull
  printed. Without one, the receipt still gives otr-replay the run's start,
  and otr-replay chooses the processor release by publication time and warns
  that the receipt names no image.
- `Skipped <log>: <error>`: the log could not be read, so its run is derived
  as if no log were given.

An upload publishes exactly what the operation derives, so only more logs can
improve a receipt. Editing the files changes nothing.

### Upload

Run the same command again, with the same `--logs-dir` options, plus
`--upload`:

```
.venv/bin/python src/main.py -s backfill-receipts --logs-dir <log directory> --upload
```

The upload derives the receipts again instead of publishing the reviewed
files, so check that its list matches the review's. It uploads each receipt
to the public bucket, refreshes the public replicas index, logs
`Published <n> receipts`, and records `otr_rating_receipt_published 1`, which
clears the `RatingReceiptMissing` alert. If anything fails, it logs the step,
such as `uploading <receipt>`, and exits 1.

### Confirm

1. Open the [public replicas site](https://data.otr.stagec.net) and check that
   **Rating run receipts** lists the uploaded receipts.
1. From `apps/replay` in a checkout of otr's `master`, replay a time in a
   back-populated week:

   ```
   uv run otr-replay --as-of 2026-06-27T23:59
   ```

   The first step shows the replica and processor release the receipt chose,
   a warning says the receipt was back-populated and names the inferred
   fields, and the summary's `Rating run` row and the metadata's `rating_run`
   name the receipt.

### Running it again

Every run lists the bucket first and derives only the receipts still missing,
so once every week has one it derives none, apart from the logged runs
described under Processor logs. It never replaces or deletes a receipt in the
bucket. After an upload that failed partway, run it again: the receipts that
were uploaded are skipped.

The same steps publish the receipt of a later run that committed without
publishing its own: give `--logs-dir` the directory holding that run's log.
