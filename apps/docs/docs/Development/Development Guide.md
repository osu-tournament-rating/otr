## Overview

This article details how to clone and configure the otr repository, which contains the website, data worker, and processor. By the end, these projects will be ready for local execution via docker or standalone commands.

> [!note]
> Testing locally with an outdated database replica is out of this article's scope. In short, checkout the latest tag created prior to the date of the replica. See [[Steps to Generate Ratings]] for more information on this.

### Prerequisites

> [!warning]
> Windows users may encounter difficulty installing Docker and Rust as they require additional configuration. Docker requires virtualization settings to be enabled while Rust may require editing the system PATH variable manually.

- [git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/) (optional)
- [Bun](https://bun.sh/) (1.3+)
- [Rust](https://rust-lang.org/tools/install/) (1.97.1, pinned by `apps/processor/rust-toolchain.toml`)
- Download the latest [public replica](https://data.otr.stagec.net/) (`.gz` file)
- Create an [osu! API v2 client](https://osu.ppy.sh/home/account/edit) and set the `Application Callback URLs` field to `http://localhost:3000/api/auth/oauth2/callback/osu`.

### Clone the repository

> [!important]
> Outside contributors need to first fork the [otr repository](https://github.com/osu-tournament-rating/otr) on GitHub. This is only necessary for those who intend to author code contributions.

Clone otr, which contains every project in this article:

```
git clone https://github.com/osu-tournament-rating/otr.git
```

### Environment files

In `otr`, copy the `.env.example` file into `.env` :

```
cd otr
cp .env.example .env
```

Populate the `WEB_OSU_CLIENT_ID` and `WEB_OSU_CLIENT_SECRET` variables using the information from your osu! API v2 client. The same client ID and client secret can be used in the `DATA_WORKER_OSU_CLIENT_ID` and `DATA_WORKER_OSU_CLIENT_SECRET` variables. It is not necessary to change any other defaults.

### Start Postgres and RabbitMQ

From the `otr/` directory, start the database and queue manager:

```
docker compose up -d db rabbitmq
```

This starts Postgres 17 and RabbitMQ 4. The RabbitMQ management UI is viewable at `http://localhost:15672/` (default user `admin`, password `admin`).

> [!important]
> The database and queue manager will run so long as Docker is running, even after rebooting. To stop the programs indefinitely, run `docker compose down` in the `otr` directory.

#### Database import

> [!note]
> Windows users should run this command in git bash or some other terminal that supports `gunzip` natively. If using git bash, the path `C:\Users\Foo\Downloads` translates to `/c/Users/Foo/Downloads`.

Import the replica downloaded from earlier, changing `/path/to/replica.gz` to the path of the `.gz` database dump.

```shell
gunzip -c /path/to/replica.gz | docker exec -i db bash -c "psql -U postgres -d template1 -c 'DROP DATABASE IF EXISTS postgres;' && psql -U postgres -d template1 -c 'CREATE DATABASE postgres;' && psql -U postgres -d postgres"
```

##### Troubleshooting

If this error occurs:

```
ERROR:  database "postgres" is being accessed by other users
DETAIL:  There are 2 other sessions using the database.
```

Run `docker stop db && docker start db`, then try the import again.

### Install dependencies

```
bun i --frozen-lockfile
```

### Run the web app and data worker

> [!important]
> `bun run dev` fails in git bash. Run the below `bun run --filter ...` commands in separate terminal instances instead.

Use the combined development script to start both applications:

```
bun run dev
```

To run one application at a time, run these commands in separate terminal windows:

```
bun run --filter web dev
bun run --filter data-worker dev
```

The web app listens on `http://localhost:3000`. The data worker runs in the background and connects to the RabbitMQ instance.

### Verify the setup

Visit `http://localhost:3000` and sign in with osu! to confirm BetterAuth is configured correctly. RabbitMQ queues and message activity are visible at `http://localhost:15672/`.

Note that ratings will not appear until the processor is run successfully.

### Processor configuration

The processor needs no configuration of its own. It reads the `.env` file at the otr root, connecting to the database at `DATABASE_URL` and to RabbitMQ at `RABBITMQ_AMQP_URL`. It also accepts its former variable names, `CONNECTION_STRING` and `RABBITMQ_URL`.

> [!warning]
> A processor run rewrites every rating in the database at `DATABASE_URL`. Only run it against a local database.

### Run the processor

The processor lives in `apps/processor`. Unlike the Bun commands above, its commands run from that directory:

```
cd apps/processor
```

Use these commands to test and run the processor:

- `cargo test` - run tests, all should pass. Database tests require Docker.
- `cargo run -r` - run the processor.
- `cargo run -- --help` - list the processor's options.
- `cargo clippy` - lint the code.
- `cargo +nightly fmt` - format the code. This is the only command that uses the nightly toolchain.

After running the processor and revisiting the website locally, ratings should be present and the leaderboard will be populated.

### Run the entire stack

It is possible to run the entire stack locally identically to how it runs in production. To run the stack in a production-like state, run these commands inside `otr/`:

- Build the `otr-web:local` and `otr-data-worker:local` images: `./scripts/local-up.sh`
- (Linux only) Start the compose stack with system monitoring `docker compose --profile node-exporter up`
- (Windows & MacOS) Start the compose stack `docker compose up`

As in production, the site runs in two containers: `web` on port 3000 and `web-standby` on port 3002. Set `WEB_PORT` or `WEB_STANDBY_PORT` in `.env` if either port is taken.
