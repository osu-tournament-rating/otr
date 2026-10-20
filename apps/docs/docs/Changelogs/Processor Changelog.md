This page records changes to the o!TR processor, which is developed in [otr](https://github.com/osu-tournament-rating/otr) under [`apps/processor`](https://github.com/osu-tournament-rating/otr/tree/master/apps/processor). Changelog format is based on [keep a changelog](https://keepachangelog.com/en/1.1.0/).

Processor releases up to `2026.08.16` were published from the [otr-processor](https://github.com/osu-tournament-rating/otr-processor) repository, and their entries link there. Later processor releases are [otr releases](https://github.com/osu-tournament-rating/otr/releases) that changed the processor, so a processor version is the tag of that otr release.

> [!note]
> This changelog began tracking releases on 2026.08.16. Changes made before that date are not recorded on this page.

## Unreleased

### Added

- Improved the processor's database performance. A production-sized run takes less time and memory, with the same ratings.
- Improved match processing speed. Processing a match no longer rereads every player's full rating history, and ratings are unchanged.

### Fixed

- Fixed the processor logging the default RabbitMQ address, `localhost:5672`, instead of the broker it connected to. It now logs that broker's host, port, and vhost.
- Fixed the processor reconnecting to the default RabbitMQ address instead of the configured broker when it lost its connection during a run.
- Fixed a database error during a run causing a panic, or discarding every rating while reporting success. The run now rolls back and exits with a failure.
- Fixed players with exactly equal ratings in the same country swapping [country ranks](https://otr.stagec.net/leaderboard) between weekly updates. Equal ratings now rank by lower player ID, as global ranks already did, so two runs on the same data write identical rows.
- Fixed a blank environment variable, such as `RUST_LOG=`, stopping the processor at startup. A blank value now counts as unset.
- Fixed rosters remaining on matches and games that are no longer verified. Each run now deletes the rosters of matches and games that are not verified at every level.
- Fixed osu!mania 4K and 7K [[Initial Ratings|starting ratings]] to use each variant's own starting rank, which the data worker aligns to the player's first match in that variant, before the overall osu!mania starting rank.

### Other

- Changed the processor to be developed and released from [otr-web](https://github.com/osu-tournament-rating/otr/tree/master/apps/processor) under `apps/processor`. Releases up to `2026.08.16` remain in the [otr-processor](https://github.com/osu-tournament-rating/otr-processor/releases) repository.
- Changed the processor to read `DATABASE_URL` and `RABBITMQ_AMQP_URL`, the names in otr-web's `.env`, before falling back to `CONNECTION_STRING` and `RABBITMQ_URL`.
- Removed the ineffective `--ignore-constraints` option. Passing it now fails at startup, and a leftover `IGNORE_CONSTRAINTS` variable is ignored.
- Changed the processor to queue tournament stats jobs in otr's `jobs` table, inside the rating transaction, instead of publishing them to RabbitMQ. A run now needs only a database. Against a database with no `jobs` table, such as an older public replica, it logs a warning and queues nothing.
- Removed the processor's RabbitMQ settings: `RABBITMQ_AMQP_URL`, `RABBITMQ_URL`, and `RABBITMQ_ROUTING_KEY`.

## [2026.08.16](https://github.com/osu-tournament-rating/otr-processor/compare/2026.08.04...2026.08.16)

### Fixed

- Pinned the processor's required Rust version to match the documentation.
