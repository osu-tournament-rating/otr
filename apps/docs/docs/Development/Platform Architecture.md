The o!TR platform relies on multiple projects and technologies to function. These projects were recently overhauled to incorporate [queueing](https://en.wikipedia.org/wiki/Message_queue). This is a very important aspect of our architecture to be aware of in order to understand how data flows throughout the system.

This section details the high-level architecture of the platform and each software project. To skip straight to development, jump to the [[Development/Development Guide|development guide]].

### Queueing

Here are a few scenarios that showcase exactly how data flows across applications using a message broker (powered by [RabbitMQ](https://www.rabbitmq.com/)).

#### Tournament submission

1. An admin submits a tournament.
2. The web backend enqueues messages for each osu! beatmap and match ID provided, and for the forum topic when the forum URL links to one.
3. The queues `data.osu.matches` and `data.osu.beatmaps` are now populated, so the data worker activates to empty these queues by fetching data from the osu! API.
4. Once all queues are empty, the data worker enqueues a message to `processing.checks.tournaments` to run automated checks for that tournament.
5. The `processing.checks.tournaments` queue sees a new message and runs automated checks for the tournament.

#### Resetting automated checks

1. Admin clicks button to reset automated checks for a tournament.
2. The web backend enqueues a message to reset automated checks for the tournament.
3. Automated checks are reset by the `processing.checks.tournaments` queue consumer (data worker).

Thus, a pattern emerges. Usually, the web backend publishes new queue messages, but the great thing about queues is that anyone can publish a new queue message. This means the processor can publish queue messages to regenerate stats after generating ratings for all tournaments. Another benefit is that the queue will always be live, so even if the data worker goes down, it will resume where it left off upon restart.

### Web application

The web application, located under `otr/apps/web`, is both the public-facing site and our API layer. It runs on [Next.js](https://nextjs.org/) using Bun and features server-side rendered pages, oRPC procedures, and auth management via BetterAuth.

### Data worker

The data worker lives under `otr/apps/data-worker`. This Bun-based application consumes and publishes [RabbitMQ](https://www.rabbitmq.com/) messages to fetch external osu! data, generate statistics, and run all [[Automated Checks|automated checks]]. It relies on queues to know when to fetch data, what data to fetch, and which tournaments need stats or automated checks to be processed.

Further, it natively supports message queue priority. The platform utilizes priority queues to separate background data fetching from manual data fetching requests. This means admin actions and user submissions are always handled as fast as possible.

#### Beatmap files and attributes

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

#### Tournament forum posts

The data worker stores the BBCode of each tournament's forum post in `tournament_forum_posts`, one row per osu! forum topic. It fetches the topic from `https://osu.ppy.sh/api/v2/forums/topics/{topic}` and keeps only the opening post, with the topic title and the post's last edit time. Each tournament links to its row through `tournaments.forum_post_id`, and tournaments that share a topic share a row. A tournament whose forum URL is a wiki page has no row.

- A submission queues the topic's fetch. An admin's change to a tournament's forum URL clears the link and queues the new topic, and the worker links the tournament once the fetch is done.
- On every start, the data worker links tournaments to topics it already stored, then queues one low-priority fetch for each topic that unlinked tournaments point at. The first start after the table was added backfills every tournament this way, and later starts catch fetches that never reached the queue.
- A fetch requested before the topic was last fetched only updates links, so a backfill queued twice costs no extra osu! requests.
- A topic osu! no longer serves is skipped without a retry. A post stored earlier stays, tournaments on the topic link to it, and the next start queues the topic again.
- Organizers' later edits to a post are not picked up until the topic is fetched again.
- `forum_post_id` is left out of tournament audits, because the worker derives it from the audited `forum_url`.

### Processor

The processor, located under `otr/apps/processor`, is a [Rust](https://www.rust-lang.org/) CLI tool. A cron job on the production host runs it [[Rating Calculation Overview#Rating update schedule|once a week]], on Tuesdays at 12:00 UTC. It looks at all verified tournament data and builds a rating network from individual match data by utilizing OpenSkill[^1], an open-source multiplayer rating algorithm ([source code](https://crates.io/crates/openskill)). For each game the processor hasn't processed before, placements for the game's scores are stored in the `game_scores` table.

Processor releases up to `2026.08.16` were published from the [otr-processor](https://github.com/osu-tournament-rating/otr-processor) repository; later processor releases are [otr releases](https://github.com/osu-tournament-rating/otr/releases) that changed the processor. The [[Processor Changelog|processor changelog]] records them.

[^1]: Weng, Ruby & Lin, Chih-Jen. (2011). A Bayesian Approximation Method for Online Ranking. Journal of Machine Learning Research. 12. 267-300. <https://jmlr.csail.mit.edu/papers/volume12/weng11a/weng11a.pdf>.
