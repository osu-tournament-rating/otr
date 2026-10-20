# otr-replay

`otr-replay` reproduces osu! Tournament Rating (o!TR) player ratings as they were at a certain timestamp provided as input to this application.

Given a UTC timestamp, the program finds the weekly rating run whose ratings the
site showed at that time from the run's receipt, downloads the most recent public
database replica taken before that run started, imports it into a temporary
PostgreSQL container, runs the processor image the run ran, and writes the
resulting ratings to a CSV file. A reconciliation is also performed as described
in [our online documentation](https://docs.otr.stagec.net/steps-to-generate-ratings#decay-reconciliation).

## Rating run receipts

Every weekly rating run publishes a receipt beside the public replicas, at
[data.otr.stagec.net](https://data.otr.stagec.net), named for the time the run
started, such as `otr-rating-receipt_2026-10-20T12:00:04Z.json`. It records when
the run started and published, the time its decay ran to, the processor release
and image it ran, and how many ratings it published. `otr-replay` replays the
last run that published at or before the requested timestamp, so a failed deploy,
a rollback, or an off-schedule replica cannot change which processor or data it
uses. Runs from before receipts existed have back-populated receipts, whose
`inferred` field names what was inferred and from what.

A timestamp no receipt covers falls back to the most recent replica at that time
and the most recent processor release available when that replica was taken.
`otr-replay` prints a warning whenever its ratings may differ from the published
ones, and records it in the metadata.

`otr-replay` lives in the `apps/replay` folder of
[otr](https://github.com/osu-tournament-rating/otr). It was previously
developed in its own [otr-replay](https://github.com/osu-tournament-rating/otr-replay)
repository, which no longer receives updates.

## Processor releases

Without a receipt, `otr-replay` chooses a processor release by publication time.
The processor has been part of [otr](https://github.com/osu-tournament-rating/otr)
(`apps/processor`) since 2026-10-08, so its releases are otr releases, tagged
`YYYY.MM.DD`, or `YYYY.MM.DD.N` for later releases on the same day. Only a release
that changed the processor publishes a `stagecodes/otr-processor` image, and only a
release with both a GitHub release and that image counts; any other release left the
previous processor release in effect. A release becomes available at the later of its
GitHub publication and its image push.

Earlier releases, up to `2026.08.16`, come from the processor's former
[otr-processor](https://github.com/osu-tournament-rating/otr-processor) repository.
Some older otr releases share a tag with one of them, such as `2026.08.16`; the
image of that name belongs to otr-processor, so its release is the one used.

## Prerequisites

- [Docker](https://www.docker.com/get-started/)
- [uv](https://docs.astral.sh/uv/)

## Usage

Clone otr, then run the program from its `apps/replay` folder with the UTC
timestamp at which the tournament closed registrations, or another timestamp the
ratings were taken from:

```sh
git clone --depth 1 https://github.com/osu-tournament-rating/otr.git
cd otr/apps/replay
uv run otr-replay --as-of 2026-06-27T23:59
```

`--as-of` expects a timestamp in this format: `YYYY-MM-DDTHH:MM[:SS][Z]`. `:SS`
and the trailing `Z` are optional, and the timestamp is always interpreted as
UTC — so a public replica timestamp such as `2026-08-08T00:06:13Z` can be
pasted as-is.

## Output

Two files are written to the working directory and never overwritten:

- `otr-replay_<timestamp>.csv` with the columns `osu_id`, `username`, `ruleset`,
  `rating`, and `volatility`. `<timestamp>` is the `--as-of` value, e.g.
  `otr-replay_20260627T235900Z.csv`.
- A matching `.metadata.json` which records the inputs — the rating run and its receipt, replica snapshot, processor release, image digests — plus checksums, reconciliation counts, and warnings for auditing.

## License

MIT, unlike the rest of otr. See `LICENSE` in this folder.
