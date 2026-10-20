# otr-replay agent guidance

otr-replay lives in otr at `apps/replay`. It is Python, not a bun
workspace: run its commands from this directory through `uv`, unlike the rest
of otr, and do not call `pip` or `python` directly. Pull requests follow
the root `pull-request` skill. Python 3.14 is required. The app and Docker
tests need Docker.

Nothing deploys this directory. People run it from their own clone of otr,
so a merge to `master` reaches them on their next pull. It reads only public
data: GitHub releases, Docker Hub tags, and the public replicas. It never needs
the root `.env` or a worktree stack.

The tool reproduces published ratings at a UTC `--as-of` time from the newest
eligible public replica and processor release. It writes a CSV and audit
`.metadata.json`. Never overwrite output. Record every replica, checksum,
release, image digest, and reconciliation counter. Treat every timestamp,
including an offset-less API value, as UTC.

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

- `discovery.py` selects the newest public replica and the newest stable
  `YYYY.MM.DD[.N]` processor release usable at the cutoff, ordering tags
  numerically. Processor releases are otr releases, since the processor lives
  in its `apps/processor`; the former otr-processor repository holds the history,
  and its entry wins a tag both repositories have. A release counts only with a
  `stagecodes/otr-processor` Docker Hub tag, which otr pushes only when the
  processor changed. Ignore the tag's status: Docker Hub calls a tag inactive
  after a month without a push or pull, and its image still pulls. Usable time
  is the later GitHub publication or Docker push time. Preserve retry and
  rate-limit failure.
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
