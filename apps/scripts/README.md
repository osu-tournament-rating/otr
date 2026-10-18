# otr-scripts

Operations scripts for the o!TR platform: database archives and recovery, the
weekly processor run, and disposable template databases. They live in otr
under `apps/scripts`; run the commands below from this directory. The scripts
read their configuration from `apps/scripts/.env`, which starts from
`.env.example`.

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
