The o!TR platform is made of several applications that share one PostgreSQL database. The applications never call each other directly. Each one reads and writes the database, and background work passes between them as rows in its `jobs` table, so following those jobs is the key to understanding how data flows through the system.

This page details the high-level architecture of the platform and each application. To skip straight to development, jump to the [[Development/Development Guide|development guide]].

## Background Jobs

The data worker runs every background job. Each job is a row in the `jobs` table, in one of these queues:

- `data.osu` fetches matches, beatmaps, players, and forum topics from the osu! API.
- `data.osutrack` fetches a player's rank history from osu!track.
- `processing.checks.tournaments` runs [[Automated Checks|automated checks]] for a tournament.
- `processing.stats.tournaments` calculates a tournament's stats.
- `processing.attributes.beatmaps` stores a beatmap's file and calculates its [[#Beatmap files and attributes|difficulty attributes]].

A job is queued in the same transaction that saves the data it needs, so the two are saved together or not at all. Jobs with a higher priority run first, which keeps admin requests and submissions ahead of background refreshes. A repeated request for work that is already queued or running merges into the existing job, except in `processing.stats.tournaments`: duplicate stats jobs are harmless, since each one rewrites the tournament's stats. A failed job is retried after about 1 minute, 5 minutes, 30 minutes, and 2 hours, then marked failed. Finished jobs are deleted after 14 days. Since jobs are stored in the database, none are lost while the data worker is down, and it resumes where it left off when it restarts.

### Tournament submission

1. A user submits a tournament.
1. In the transaction that saves the tournament, the web backend queues a `data.osu` job for each osu! match and beatmap ID provided, and for the forum topic when the forum URL links to one.
1. The data worker fetches each of them from the osu! API.
1. Once every match and beatmap of the tournament is fetched, the data worker queues a `processing.checks.tournaments` job.
1. The data worker runs automated checks for the tournament, marking its data `PreVerified` or `PreRejected`.

### Resetting automated checks

1. An admin resets automated checks for a tournament.
1. The web backend queues a `processing.checks.tournaments` job for the tournament.
1. The data worker runs automated checks for the tournament again.

### Weekly rating run

1. The [[#Processor|processor]] rebuilds every rating in one transaction.
1. In the same transaction, it queues a `processing.stats.tournaments` job for each tournament whose stats need a refresh.
1. Once the ratings are saved, the data worker calculates those tournaments' stats.

## Web Application

The web application, located under `otr/apps/web`, is both the public-facing site and our API layer. It runs on [Next.js](https://nextjs.org/) using Bun and features server-side rendered pages, oRPC procedures, and auth management via BetterAuth.

## Data Worker

The data worker lives under `otr/apps/data-worker`. This Bun-based application runs the jobs in the `jobs` table: it fetches external osu! and osu!track data, calculates statistics and beatmap attributes, and runs all [[Automated Checks|automated checks]]. It also queues jobs of its own, such as a tournament's automated checks once its data is fetched, and scheduled refreshes of player data.

### Beatmap files and attributes

Each time the data worker fetches a beatmap, it queues a `processing.attributes.beatmaps` job. The job stores the beatmap's `.osu` file, downloaded from `https://osu.ppy.sh/osu/{id}`, and calculates difficulty attributes from it with [rosu-pp-js](https://github.com/MaxOhn/rosu-pp-js). Files are stored for every ruleset, but attributes are calculated only for osu! standard beatmaps.

- Files are stored at `beatmaps/{osu! beatmap ID}/{MD5}.osu` in the Google Cloud Storage bucket named by `BEATMAP_FILES_BUCKET`, or under `BEATMAP_FILES_DIR` for local development. `.env.example` lists the settings. With neither set, the feature is off.
- The bucket's HMAC key needs a service account that can create, read, and overwrite objects in the bucket, such as one with the Storage Object User role (`roles/storage.objectUser`) on it. Storage Object Creator is not enough: overwriting an object needs `storage.objects.delete`, and the probe the data worker runs at startup overwrites `beatmaps/.probe`. When the probe fails, jobs from beatmap fetches wait in the queue until a start passes it.
- The `beatmap_files` table records the checksum of each beatmap's stored file and a `fetch_status`.
- `beatmap_attributes` holds one row per beatmap and mod key, with `sr`, `ar`, `cs`, `od`, and `hp`. A key is a bitmask of `EZ`, `HD`, `HR`, and `DT`, so `HDHR` and `HRHD` share a row.
- `NC` counts as `DT`, and mods that do not change difficulty, such as `NF` and `SD`, are dropped from the key. Plays with `HT`, `FL`, `TD`, `RX`, or `AP` have no row yet. Values assume each mod's default settings, such as `DT` at 1.5x speed.
- A beatmap gets an `NM` row, plus a row for each key played by any score in its verified osu! standard games, whatever the score's own status. A row whose key is no longer played, such as after a game is rejected, is removed the next time a job runs for that beatmap.
- `ar` and `od` include the speed change of `DT`. `cs` and `hp` change only with `EZ` and `HR`.
- Values follow the osu! difficulty algorithm of the pinned rosu-pp-js release, which can lag behind the star rating osu! shows. The `NM` row can therefore differ from `beatmaps.sr`, which comes from the osu! API. The `calculator` column names the release that produced each row.
- o!TR fetches a beatmap once, unless someone refetches it, and the job stores the file osu! serves at that time. The backfill stores the current file, even for beatmaps from old matches, so a stored file can be newer than the version that was played. A refetch downloads the file again when osu! reports a new checksum.
- When a download gives no usable file but an older file is stored, the job calculates from the stored file. A refusal, an HTML page, or a server error from osu! fails the job, so the queue retries it.
- A beatmap without a usable stored file, because osu! never served one or the calculator rejects it, has no attributes until a refetch gets a usable file. The calculator rejects maps that rosu-pp-js flags as suspicious, and maps whose slider curves would take too long to calculate.

Every 10 minutes, when the queue is empty, the data worker queues up to 1,000 low-priority jobs, so jobs from beatmap fetches go first. It picks osu! standard beatmaps whose attributes are missing or came from another calculator, then fetched beatmaps in a game or mappool that have no stored file yet. This sweep is the backfill, and it also adds rows for mods that newly verified games played. Once it finds no beatmap that needs attributes, it looks again only after an hour. A failed sweep job is not retried, because the next sweep finds the beatmap again.

To roll out a star rating change once rosu-pp-js releases it:

1. In `apps/data-worker`, run `bun add --exact rosu-pp-js@<version>`.
1. Set `CALCULATOR` in `apps/data-worker/src/beatmap-attributes/calculator.ts` to `rosu-pp-js@<version>`. A test fails while the two differ.
1. Merge the change, which deploys it. The sweep then recalculates every row from the stored files, with no downloads from osu!. At 1,000 jobs per sweep this takes hours, and until it finishes, rows from both releases coexist.

Files the calculator rejected keep `fetch_status` 4 (Error) and are not recalculated. To try them with the new release, set `fetch_status` to 2 (Fetched) on the `beatmap_files` rows that have a checksum, and the sweep picks them up.

### Tournament forum posts

The data worker stores the BBCode of each tournament's forum post in `tournament_forum_posts`, one row per osu! forum topic. It fetches the topic from `https://osu.ppy.sh/api/v2/forums/topics/{topic}` and keeps only the opening post, with the topic title and the post's last edit time. Each tournament links to its row through `tournaments.forum_post_id`, and tournaments that share a topic share a row. A tournament whose forum URL is a wiki page has no row.

- A submission queues the topic's fetch. An admin's change to a tournament's forum URL clears the link and queues the new topic, and the worker links the tournament once the fetch is done.
- On every start, the data worker links tournaments to topics it already stored, then queues one low-priority fetch for each topic that unlinked tournaments point at. The first start after the table was added backfills every tournament this way, and later starts catch fetches that never reached the queue.
- A fetch requested before the topic was last fetched only updates links, so a backfill queued twice costs no extra osu! requests.
- A topic osu! no longer serves is skipped without a retry. A post stored earlier stays, tournaments on the topic link to it, and the next start queues the topic again.
- Organizers' later edits to a post are not picked up until the topic is fetched again.
- `forum_post_id` is left out of tournament audits, because the worker derives it from the audited `forum_url`.

## Processor

The processor, located under `otr/apps/processor`, is a [Rust](https://www.rust-lang.org/) CLI tool. A cron job on the production host runs it [[Rating Calculation Overview#Rating update schedule|once a week]], on Tuesdays at 12:00 UTC. It looks at all verified tournament data and builds a rating network from individual match data by utilizing OpenSkill[^1], an open-source multiplayer rating algorithm ([source code](https://crates.io/crates/openskill)). Every run rebuilds all ratings from scratch in one transaction. It first recalculates the placement of every score in every game, stored in the `game_scores` table, and finally queues the stats jobs described in [[#Weekly rating run|weekly rating run]].

Processor releases up to `2026.08.16` were published from the [otr-processor](https://github.com/osu-tournament-rating/otr-processor) repository; later processor releases are [otr releases](https://github.com/osu-tournament-rating/otr/releases) that changed the processor. The [[Processor Changelog|processor changelog]] records them.

[^1]: Weng, Ruby & Lin, Chih-Jen. (2011). A Bayesian Approximation Method for Online Ranking. Journal of Machine Learning Research. 12. 267-300. <https://jmlr.csail.mit.edu/papers/volume12/weng11a/weng11a.pdf>.
