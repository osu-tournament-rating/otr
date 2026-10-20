# otr-replay agent guidance

otr-replay lives in otr at `apps/replay`. It is Python, not a bun
workspace: run its commands from this directory through `uv`, unlike the rest
of otr, and do not call `pip` or `python` directly. Pull requests follow
the root `pull-request` skill. Python 3.14 is required. The app and Docker
tests need Docker.

Nothing deploys this directory. People run it from their own clone of otr,
so a merge to `master` reaches them on their next pull. It reads only public
data: the public replicas and rating run receipts, GitHub releases, and Docker
Hub tags. It never needs the root `.env` or a worktree stack.

The tool reproduces the ratings the site showed at a UTC `--as-of` time by
replaying the rating run that published them, from that run's receipt. It
writes a CSV and audit `.metadata.json`. Never overwrite output. Record every
receipt, replica, checksum, release, image digest, reconciliation counter, and
warning. Treat every timestamp, including an offset-less API value, as UTC.

## Commands

- `uv sync`; CI uses `--locked`, and runs every check below only when a change
  touches `apps/replay/**`.
- `uv run otr-replay --as-of 2026-06-27T23:59` runs the application.
- `uv run pytest` runs unit tests.
- `OTR_REPLAY_DOCKER_TEST=1 uv run pytest tests/test_reconcile_docker.py` runs
  Docker reconciliation tests.
- `uv run black --check .` and `uv run ruff check .` check style. Preserve
  one-flag-per-line argument lists marked with `# fmt: skip`.

## Pipeline and invariants

- `receipts.py` reads the rating run receipts listed on the public replicas
  site, which `apps/scripts` publishes after each weekly run
  (`src/lib/receipt.py`), and plans the replay. It replays the run with the
  latest `committed_at` (or `started_at`, when null) at or before `--as-of`:
  the image its receipt names, a replica, and decay reconciled to its
  `decay_horizon` (or start). The replica is the newest one taken in the 30
  minutes before the run started, which holds what the run read, or else
  whichever is nearer the start: the newest one before it, or the first one
  within a day after it, as replicas until mid-January 2026 were. It warns, in
  the console and the metadata, when a receipt was back-populated, is over a
  week older than `--as-of`, names no image, or the replica falls outside
  those 30 minutes. Only an `--as-of` no receipt covers falls back to
  `discovery.py`'s choice by publication time, with a warning. A receipt of
  another `receipt_version` stops the replay; the version is a contract with
  `apps/scripts`.
- `discovery.py` selects the newest public replica and the newest stable
  `YYYY.MM.DD[.N]` processor release usable at the cutoff, ordering tags
  numerically. Processor releases are otr releases, since the processor lives
  in its `apps/processor`; the former otr-processor repository holds the history,
  and its entry wins a tag both repositories have. A release counts only with a
  `stagecodes/otr-processor` Docker Hub tag, which otr pushes only when the
  processor changed. Ignore the tag's status: Docker Hub calls a tag inactive
  after a month without a push or pull, and its image still pulls. Usable time
  is the later GitHub publication or Docker push time. Read every page of a
  listing, and fail rather than truncate one. Preserve retry and rate-limit
  failure.
- `sandbox.py` owns run-labeled Docker resources, streams imports, uses processor
  image digests, and removes only resources with its label. Teardown never hides
  the original error.
- `sql.py` reconciles in one fail-closed transaction. Roll back decay types `1`
  and `3` past the horizon; abort on other later adjustments or rating mismatch.
- `output.py` claims output paths atomically, writes CSV through `.part`, checks
  row count, and writes metadata last.
- `console.py` owns visible progress. `models.py` owns frozen dataclasses.
- Raise `ReplayError(phase, message, hint)` with an actionable hint. Exit `130`
  on interrupt, `3` on unexpected exception, and `1` for expected failure.
- Verify each replica SHA-256, run images by digest, redact database credentials,
  and keep unit tests offline with `tests/fixtures/`.
