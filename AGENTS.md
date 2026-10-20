# otr agent guidance

o!TR (osu! Tournament Rating) rates osu! tournament players. It collects
tournament match data from osu!, people verify that data, and every week it
computes ratings from the verified matches. The website shows leaderboards,
player profiles, and tournaments, and has a public REST API. Everything lives
in this monorepo, and a merge to `master` ships to production.

Run commands from the repository root unless noted. `CLAUDE.md` is a symlink to
this file.

## Repository map

- `apps/web`: the Next.js site. It also serves the API: an internal oRPC
  endpoint for the site itself, and a public REST API with an OpenAPI
  reference.
- `apps/data-worker`: a Bun service that runs the jobs queued in Postgres. It
  fetches data from osu! and osu!track, runs automated data checks, and
  computes match and tournament stats.
- `apps/processor`: the Rust rating engine. It rebuilds every rating from
  scratch once a week.
- `apps/scripts`: Python operations scripts. They cover database archives and
  recovery, the weekly processor run, disposable template databases, and `otr`,
  which runs each worktree's own stack.
- `apps/docs`: the docs site at docs.otr.stagec.net, Markdown rendered by
  Quartz.
- `apps/replay`: `otr-replay`, a Python CLI that anyone can run to reproduce
  published ratings for a past date from a public database replica and the
  processor release of that time. It never touches production.
- `packages/otr-core` (`@otr/core`): the shared contract layer. It holds the
  database schema, domain enums, job queues and payloads, logging, tracing, and
  maintenance windows. Never duplicate any of these inside an app.
- `scripts/` (root) and `monitoring/` hold deployment tooling and production
  observability config. Never invoke anything in them. Don't confuse root
  `scripts/` with `apps/scripts/`.

The processor, scripts, replay, and docs are not Bun workspaces. Each has its own
toolchain and its own `AGENTS.md`; read that file before working there.

## How the pieces talk

PostgreSQL is the only shared state, and its `jobs` table carries all background
work. There is no message broker, no Redis, and no service-to-service HTTP. A
tournament's life:

1. A user submits a tournament on the site. The web app writes it to Postgres
   and, in the same transaction, queues fetch jobs for its matches.
2. The data worker fetches matches, beatmaps, and players from the osu! API, and
   rank history from osu!track. Once a tournament is fully fetched, the worker
   runs automated checks that mark its data pre-verified or pre-rejected.
3. Admins review the data on the site and set it verified or rejected. A
   rejection cascades down from tournament to match to game to score.
4. On Tuesdays at 12:00 UTC, a cron on the production host uses `apps/scripts`
   to run the processor. The processor rebuilds all ratings from verified data
   in one transaction, which also queues stats jobs for the data worker.
5. The site reads Postgres directly through Drizzle.

A failed job is retried after about 1 minute, 5 minutes, 30 minutes, and 2
hours, then marked failed. Finished jobs are deleted after 14 days; their daily
totals stay in `job_stats_daily`. A weekly maintenance window, Tuesdays
11:45–12:15 UTC, protects the rating run: admin writes return 503 and the
worker defers osu! fetches.

## Tech stack

- Bun workspaces and TypeScript throughout the JavaScript side.
- Web: Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui on Radix,
  react-hook-form with zod, Recharts, and SWR. oRPC with zod schemas serves
  both the internal endpoint and the public OpenAPI. better-auth provides osu!
  OAuth sign-in, sessions, admin roles, and API keys.
- Data: PostgreSQL 17 through Drizzle ORM.
- Processor: Rust, with an OpenSkill (Plackett–Luce) rating model plus decay.
- Scripts and replay: Python 3.14 with uv. Archives are stored in Google Cloud
  Storage.
- Operations: Docker Compose on a single production host, reached over
  Tailscale. Images are `stagecodes/otr-*` on Docker Hub. OpenTelemetry sends
  traces through Alloy to Tempo, with Loki, Prometheus, and Grafana alongside.

## Environments and releases

- Every merge to `master` deploys to production after CI passes, and is
  published as a GitHub release tagged by date. There is no staging.
- A deploy runs pending database migrations, then restarts the stack. It
  rebuilds the processor image only when `apps/processor` changed, and installs
  `apps/scripts` on the host every time.
- PR previews run when a PR has the `preview` label. A preview runs only the web
  app, with no data worker. Most previews share the dev tier's database, so
  their writes land in shared data. A PR that adds migrations gets its own
  copy.
- The dev tier is a shared environment, restored nightly from the newest
  redacted copy of production. `dev-archive.yml` makes a new copy every
  Wednesday.
- Dev tier `deploy` and nightly runs install `scripts/preview` on the dev host
  from `master`, and previews use that copy. A merge that changes
  `scripts/preview` or `docker-compose-dev.yml` runs the `deploy` action by
  itself.

## Starting in a worktree

Before working in a new worktree, fetch `origin/master` and merge it into the
worktree's branch. A worktree can be cut from a stale local branch, and work
must start from the latest `master`.

## Your stack

Work in a linked worktree runs against its own disposable stack, never the main
checkout's services on ports 5432 and 3000. This is a rule.

- Run `apps/scripts/otr up` before anything that needs a database or the
  running site: database tests, migrations, the processor, or a look at a page.
  It copies the local database in a few seconds, starts this worktree's web
  app, and prints the URLs.
- `otr up` points this worktree's `.env` at the stack, so ordinary commands
  such as `bunx drizzle-kit migrate` and `cargo run` use it too. Don't edit
  the block it writes. The `.env` itself comes from the main checkout.
- Only the database and web app start by default. Add `worker` or `monitoring`
  (Grafana with traces) to `otr up` when a task needs them; `--no-web` skips
  the site.
- osu! sign-in does not work on a stack's port. Sign in with
  `POST /api/auth/e2e/sign-in` and a body of `{"playerId": <id>, "admin": true}`.
- A manual call to `/rpc` needs `-H 'origin: <the stack's web URL>'`.
- Run `apps/scripts/otr down` when the task is done, unless the user still
  wants to look at the site. Say in your final report whether it is still up.
  `otr status` lists every stack, and `otr down --orphans` removes those whose
  worktree is gone.

## Gotchas

- Persisted enums are numbers, and the Rust processor reads those numbers
  directly. Never renumber or reorder an enum. Many enums are bitflags, so test
  them with `&`, not equality. Verification statuses are not ordered by
  meaning, so never compare them with `<`.
- The processor reads and writes tables with raw SQL, so TypeScript cannot catch
  a broken contract. Treat SQL table and column names, and the JSON shape of
  job payloads, as contracts with the processor.
- The schema lives in `packages/otr-core/src/db/schema.ts`, but migrations are
  generated into `apps/web/drizzle`. Run `bunx drizzle-kit generate` from the
  root, read the emitted SQL, and commit the schema, SQL, snapshot, and journal
  together. Merged migrations are immutable: never edit, rename, reorder, or
  delete them.
- Apply migrations only to your own stack's database (see Your stack). The
  database at `localhost:5432` belongs to the developer: `otr` only reads it to
  make copies, and nothing else may touch it.
- Grafana reads production through `otr_grafana_read_only`, which can read
  every table, including ones added later, except credential columns. A
  migration that adds a credential column must hide it from that role, as
  migration 0041 does, and add it to `dev_secret_columns` in `apps/scripts`.
- Generated columns, such as a score's final value and the search vectors,
  cannot be written. IDs are identity columns.
- Admin writes go through `adminMutationProcedure` so the maintenance window
  applies, and every other write, except marking reports as seen, goes through
  `protectedMutationProcedure`. Both refuse a write from a page built from
  another release. Authorization happens in procedures and server-side page
  checks. Next middleware does no authorization.
- Only procedures tagged `public` appear in the REST API. Changing one is a
  public API change.
- Server components call the site's own oRPC endpoint over HTTP, so a wrong
  `INTERNAL_APP_BASE_URL` breaks server rendering.
- `/rpc` serves only the site: same-origin browser calls, and server-side
  calls that carry a token derived from `BETTER_AUTH_SECRET`. Everyone else
  gets a 403 and uses `/api`. Any client can forge the browser headers the
  gate checks, so the gate only deters; the rate limits protect.
  `RPC_RATE_LIMIT` sets them to `enforce`, `observe`, or `off`. Unset, they
  follow `NODE_ENV`: production builds enforce them, PR previews included,
  and `next dev` leaves them off.
- Configuration comes from one root `.env`, which the web app, worker,
  migrations, and processor all load. `apps/scripts` reads only its own `.env`.
  Variables already set in the shell win over `.env`.
- Each workspace declares every package it imports or runs, including in config
  files and tests. Bun hoists packages, and a worktree resolves anything it
  lacks from the main checkout, so an undeclared package passes locally and
  fails in CI. Root `bun run lint`, which pre-commit and CI run, starts with
  `lint:deps`. First, `lib/deps/check-install.ts` checks that every declared
  package is installed in this checkout at a version its range allows. When it
  reports a stale or missing install, run the reinstall command it prints; new
  desktop worktrees copy the main checkout's `node_modules`. Then knip checks
  that each workspace, or the root, declares the packages its code, config, and
  test files import, and the binaries its `package.json` scripts call directly.
  knip lets an import through when a declared package lists it as a peer and
  it resolves from anywhere, including the main checkout, so
  `lib/deps/check-peer-imports.ts` reports those imports first. Neither checks
  hook commands, workflow steps, or FlatCompat plugin names.

## Testing

A test exists to fail when behavior breaks. Before you write, change, or
delete a test, or decide what to do about a failing one, load the `testing`
skill in `.claude/skills/testing/SKILL.md`.

- A failing test is a report, not an obstacle. Never delete, skip, or weaken a
  test, or copy the code's current output into its expected values, to make a
  run pass.
- When a test your change does not touch fails, compare it with `master` in
  the same environment, as the skill describes. If `master` fails it too, open
  an issue and leave the test alone. If it fails only with your change, fix
  the code.
- Change what an existing test expects only when the task changes that
  behavior. List every such test under `## Tests changed` in the pull request.
  CI fails a pull request that edits or deletes an existing test without one,
  but it catches most such edits, not all.
- Watch every new test fail before it passes: break the code it covers, run
  the test, then undo the break. When you fix a bug, first write a test that
  fails on `master`, then fix the code.
- Test behavior that people or other programs depend on. Don't test markup,
  one component's class strings, restated constants, or library behavior.
  Contract values, such as persisted enum numbers, and the UI conventions
  below, checked across the whole kit, are the exceptions.

## UI conventions

- Before you build or change UI in `apps/web`, load the `web-design` skill.
  It documents the shared component library with do and don't examples. A
  change to a shared component, token, or pattern updates the skill in the
  same pull request, and when you find part of the skill out of date, fix that
  part.
- All user-facing text uses the Inter sans font, including chart axes,
  tooltips, table headers, and numbers. Use sentence case: no `uppercase` and
  no `tracking-wide`. `text-xs` is the minimum size; fix smaller overrides when
  you find them.
- Color text with semantic tokens, never palette classes like
  `text-orange-500`. Status tokens (`success`, `warning`, `destructive`) are for
  fills, borders, and icons. Their `*-foreground` tokens are for text.
  `text-primary-foreground` goes only on `bg-primary-solid`, and blue text uses
  `text-link`. On a solid `bg-success` fill, use `text-green-950`.
- Never put a `z-*` class on shadcn overlay content (popover, dropdown,
  tooltip); it overrides the portal's stacking. Wrap a tooltip around
  `DialogTrigger`, never around `Dialog`.

## Tracing

Every oRPC call gets a span, and each database statement becomes a child span.
Job rows carry the trace into the data worker. Nothing is exported unless
`OTEL_EXPORTER_OTLP_ENDPOINT` is set. Logs carry `traceId`. Never put query
parameters or user input on a span.

## Commits

Write [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`type(scope): description`, lowercase and short, one concern per commit. Use
the area as the scope: `web`, `worker`, `core`, `db`, `processor`, `scripts`,
`replay`, `docs`, `ci`, or `preview`. Types are `feat`, `fix`, `perf`, `refactor`,
`docs`, `test`, `build`, `ci`, `chore`, `style`, and `revert`. When a body is
needed, it explains why, not what. Branch commits stay in `master`'s history,
so keep them clean.

## Pull requests

Before you open a pull request or edit one's title or description, read and
follow the `pull-request` skill in `.claude/skills/pull-request/SKILL.md`.

## Issues

Open an issue for anything you notice outside your task, such as an unrelated
bug, a risk, dead code, or documentation that no longer matches the code. Do not
fix it in the current change. The one exception is the `web-design` skill: fix
an out-of-date part of it in place, in the change you are making.

Before you open, edit, or label an issue, read and follow the `issue` skill in
`.claude/skills/issue/SKILL.md`.

## Signature

End everything you post publicly on the user's behalf with `^claude` on its
own final line. That covers issues, pull requests, comments, and reviews. In a
pull request, the signature goes after `<!-- changelog:end -->`.
