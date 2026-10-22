#!/usr/bin/env bash
set -euo pipefail

# Manages the shared dev-tier database that PR previews read from.
#
#   capabilities     print the API version and subcommands
#   classify <db>    report <db> against EXPECTED_JOURNAL, changing nothing
#   check            verify the live database is usable
#   sync             bring the live database to EXPECTED_JOURNAL
#   restore          restore the dev replica into the seed, then rebuild live
#   clone <db>       create or reuse <db> from the seed, for migration PRs
#   verify <db>      assert <db> matches EXPECTED_JOURNAL
#   info <db>        size, provenance and data age of <db>
#   drop <db>        remove a cloned database
#   reap             remove per-PR databases with no open pull request
#
# Exit codes: 0 ok, 1 failure, 2 usage, 3 refused for capacity, 4 lock wait
# expired.
#
# Run from the dev tier directory, the one holding docker-compose.yml. Both
# workflows cd here first. Everything below can be overridden from the
# environment; the defaults describe the tier the workflows build.
#
# Two databases, never interchangeable: the seed is the restore target and
# stays idle so it can act as a template, and the live database is recreated
# from it and shared by every preview.
#
# EXPECTED_JOURNAL is computed on the runner, which has jq and the migration
# files; the host has neither. The runner uploads the same migration files as
# MIGRATIONS_ARCHIVE, so the migrator applies exactly what verify expects, and
# the migration image supplies only the runtime.

API_VERSION=3

# The .env compose reads sits beside it and carries the postgres credentials.
# Sourcing it keeps them in one place rather than a second secret that has to
# be kept in step. Its keys are DOCKER_-prefixed, so nothing here collides.
if [[ -r .env ]]; then
  set -a
  # shellcheck disable=SC1091 # written by the workflow, not in the repository
  . ./.env
  set +a
fi

# The workflows reach this over `ssh host bash -s`, a non-interactive shell,
# which reads neither ~/.profile nor the interactive half of ~/.bashrc. uv
# installs to ~/.local/bin and is on PATH only for a login shell, so restore
# cannot find it without this.
PATH="$HOME/.local/bin:$PATH"

# shellcheck source-path=SCRIPTDIR
. "$(dirname "${BASH_SOURCE[0]}")/dev-db-lib.sh"

CONTAINER="${DEV_DB_CONTAINER:-otr-dev-db}"
DB_USER="${DEV_DB_USER:-postgres}"
SEED_DB="${DEV_SEED_DB:-otr_dev_seed}"
LIVE_DB="${DEV_LIVE_DB:-otr_dev}"
# dev-tier.yml installs the operations scripts beside scripts/preview, at
# <DEV_REMOTE_PATH>/apps/scripts. The variable lets dev-db-test.sh stub them.
OTR_SCRIPTS_DIR="${OTR_SCRIPTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/apps/scripts}"
MAX_STALE_DAYS="${DEV_DB_MAX_STALE_DAYS:-14}"
EXPECTED_JOURNAL="${EXPECTED_JOURNAL:-}"
# The journal a restore migrates the seed to: MIGRATIONS_ARCHIVE's, which is
# the default branch's. A clone for a pull request with its own migrations
# expects that pull request's journal, which the seed never has, so the
# workflow passes the default branch's here. Unset, it is EXPECTED_JOURNAL.
SEED_JOURNAL="${SEED_JOURNAL:-$EXPECTED_JOURNAL}"
# A gzip tar holding apps/web/drizzle/meta/_journal.json and
# apps/web/drizzle/*.sql, relative to the migration image's WORKDIR.
MIGRATIONS_ARCHIVE="${MIGRATIONS_ARCHIVE:-}"
PREVIEW_REMOTE_PATH="${PREVIEW_REMOTE_PATH:-}"
MAX_CLONES="${DEV_DB_MAX_CLONES:-6}"
MIN_FREE_BYTES="${DEV_DB_MIN_FREE_BYTES:-21474836480}"
FREE_FACTOR_PERCENT="${DEV_DB_FREE_FACTOR_PERCENT:-120}"
LOCK_FILE="${DEV_DB_LOCK_FILE:-$PWD/.dev-db.lock}"
LOCK_WAIT="${DEV_DB_LOCK_WAIT:-1800}"
CLONE_MAX_AGE_DAYS="${DEV_DB_CLONE_MAX_AGE_DAYS:-14}"
REAP_LIMIT="${DEV_DB_REAP_LIMIT:-10}"
# Supplies the runtime that applies MIGRATIONS_ARCHIVE. Its own migrations are
# used only when no archive is given, and they can trail the default branch:
# the host shares production's Docker daemon, so latest here is the image
# production last deployed.
MIGRATION_IMAGE="${DEV_MIGRATION_IMAGE:-stagecodes/otr-web:latest}"
NETWORK="${DEV_NETWORK:-otr-dev}"

# Minimum rows for the replica to be considered intact, set near half of
# current production so a truncated restore fails but ordinary drift does not.
read -ra ROW_FLOORS <<<"${DEV_DB_ROW_FLOORS:-players:50000 tournaments:1500 \
matches:75000 games:500000 game_scores:2000000 rating_adjustments:2000000}"

query() { # query <database> <sql>
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$1" -tAc "$2" </dev/null
}

# Only the migration container needs a URL, and it dials over the otr-dev
# network, so the host is the container alias rather than localhost. Built on
# demand: drop and clone must still work when the password is not readable.
db_url() { # db_url <database>
  if [[ -n "${DEV_DB_URL_PREFIX:-}" ]]; then
    echo "${DEV_DB_URL_PREFIX}$1"
    return
  fi
  : "${DOCKER_POSTGRES_PASSWORD:?not set, and no .env beside the compose file to read it from}"
  echo "postgresql://${DB_USER}:${DOCKER_POSTGRES_PASSWORD}@${CONTAINER}:5432/$1"
}

fail() {
  echo "dev-db: $1" >&2
  exit 1
}

refuse() {
  echo "dev-db: $1" >&2
  exit 3
}

database_exists() {
  [[ "$(query postgres "select 1 from pg_database where datname='$1'")" == "1" ]]
}

# DROP DATABASE and CREATE ... TEMPLATE both require zero connections.
disconnect() {
  query postgres "select pg_terminate_backend(pid) from pg_stat_activity
    where datname='$1' and pid <> pg_backend_pid()" >/dev/null
}

now() { date +%s; }

require_journal() {
  [[ -n "$EXPECTED_JOURNAL" ]] || fail "EXPECTED_JOURNAL is not set"
}

# Checked before a restore starts, so a bad upload fails in seconds rather
# than after minutes of restoring. The messages leave out the path, which is
# a directory on the host.
require_migrations_archive() {
  [[ -n "$MIGRATIONS_ARCHIVE" ]] || return 0
  [[ -f "$MIGRATIONS_ARCHIVE" && -r "$MIGRATIONS_ARCHIVE" ]] ||
    fail "MIGRATIONS_ARCHIVE is not a readable file"
  tar -tzf "$MIGRATIONS_ARCHIVE" apps/web/drizzle/meta/_journal.json >/dev/null 2>&1 ||
    fail "MIGRATIONS_ARCHIVE has no apps/web/drizzle/meta/_journal.json"
}

require_clone_name() {
  [[ "$1" =~ ^otr_pr_[0-9]+$ ]] || fail "$1 is not a per-PR database name"
}

applied_journal() { # applied_journal <database>
  [[ "$(query "$1" "select to_regclass('drizzle.__drizzle_migrations') is not null")" == t ]] || return 0
  query "$1" "select coalesce(string_agg(created_at || ' ' || hash, chr(10) order by id), '')
    from drizzle.__drizzle_migrations"
}

provenance() { # provenance <database>
  query postgres "select coalesce(shobj_description(oid, 'pg_database'), '')
    from pg_database where datname='$1'"
}

stamp() { # stamp <database> <seed generation>
  query postgres "comment on database $1 is
    '{\"generation\":$2,\"created\":$(now)}'" >/dev/null
}

database_size() { # database_size <database>
  query postgres "select pg_database_size('$1')"
}

# Which migrations migrate ran, for verify to name when the result falls short.
MIGRATION_SOURCE=''

migrate() { # migrate <database>
  require_migrations_archive
  if [[ -n "$MIGRATIONS_ARCHIVE" ]]; then
    MIGRATION_SOURCE="the default branch's migrations from the runner"
  else
    MIGRATION_SOURCE="the migrations inside $MIGRATION_IMAGE"
    echo "dev-db: MIGRATIONS_ARCHIVE is not set; migrating with $MIGRATION_SOURCE" >&2
  fi

  local output status=0
  if [[ -n "${DEV_MIGRATOR_COMMAND:-}" ]]; then
    # shellcheck disable=SC2086 # the seam is a command line, not one word
    output="$($DEV_MIGRATOR_COMMAND "$1" 2>&1 </dev/null)" || status=$?
  elif [[ -n "$MIGRATIONS_ARCHIVE" ]]; then
    # The archive arrives on stdin, never the workflow's script. The image's
    # own copy is removed first so none of its migrations mix in.
    output="$(docker run --rm -i --network "$NETWORK" \
      -e DATABASE_URL="$(db_url "$1")" \
      "$MIGRATION_IMAGE" sh -c \
      'set -e; rm -rf apps/web/drizzle; tar -xzf - -C .; exec ./scripts/run-migrations.sh' \
      2>&1 <"$MIGRATIONS_ARCHIVE")" || status=$?
  else
    output="$(docker run --rm --network "$NETWORK" \
      -e DATABASE_URL="$(db_url "$1")" \
      "$MIGRATION_IMAGE" ./scripts/run-migrations.sh 2>&1 </dev/null)" || status=$?
  fi
  redact <<<"$output"
  [[ "$status" == 0 ]] || fail "migrating $1 failed"
}

# Prints what is wrong with <database> and returns 1, or prints nothing.
health_problem() { # health_problem <database>
  local database="$1" value entry table floor

  if ! docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 </dev/null; then
    echo "postgres is not accepting connections"
    return 1
  fi
  if ! database_exists "$database"; then
    echo "database $database does not exist"
    return 1
  fi

  # A restore that dies partway still loads rows, so verify the constraints
  # that only get added once the data is fully in.
  value="$(query "$database" "select count(*) from pg_constraint where contype='f'
    and conrelid = to_regclass('public.matches')" 2>/dev/null || true)"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || ((value == 0)); then
    echo "matches has no foreign keys; restore was incomplete"
    return 1
  fi

  for entry in "${ROW_FLOORS[@]}"; do
    table="${entry%%:*}"
    floor="${entry##*:}"
    value="$(query "$database" "select count(*) from $table" 2>/dev/null || true)"
    if [[ ! "$value" =~ ^[0-9]+$ ]] || ((value < floor)); then
      echo "$table has ${value:-no} rows, expected at least $floor"
      return 1
    fi
  done

  value="$(query "$database" "select coalesce(max(created), 'epoch') <
    now() - interval '$MAX_STALE_DAYS days' from matches" 2>/dev/null || true)"
  if [[ "$value" != "f" ]]; then
    echo "newest match is older than $MAX_STALE_DAYS days"
    return 1
  fi
}

status_of() { # status_of <database>
  classify_journal "$(applied_journal "$1")" "$EXPECTED_JOURNAL"
}

capabilities() {
  echo "version=$API_VERSION"
  echo "commands=capabilities classify check sync restore clone verify info drop reap"
}

classify() { # classify <database>
  require_journal
  docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 </dev/null ||
    fail "postgres is not accepting connections"
  database_exists "$1" || fail "database $1 does not exist"

  local applied
  applied="$(applied_journal "$1")"
  echo "status=$(classify_journal "$applied" "$EXPECTED_JOURNAL")"
  echo "applied=$(count_lines "$applied")"
  echo "expected=$(count_lines "$EXPECTED_JOURNAL")"
}

check() {
  require_journal
  local problem status
  if ! problem="$(health_problem "$LIVE_DB")"; then
    fail "$problem"
  fi
  status="$(status_of "$LIVE_DB")"
  [[ "$status" != diverged ]] || fail "$LIVE_DB diverged from the expected journal"
  echo "dev-db check passed, $LIVE_DB is $status"
}

sync() {
  require_journal
  require_migrations_archive
  local problem applied status
  if ! problem="$(health_problem "$SEED_DB")" || ! problem="$(health_problem "$LIVE_DB")"; then
    echo "sync: restoring, $problem"
    restore
    return
  fi

  applied="$(applied_journal "$LIVE_DB")"
  status="$(classify_journal "$applied" "$EXPECTED_JOURNAL")"
  case "$status" in
    match)
      echo "sync: $LIVE_DB already matches the expected journal"
      ;;
    behind)
      echo "sync: migrating $LIVE_DB forward, it is behind the expected journal"
      migrate "$LIVE_DB"
      verify "$LIVE_DB"
      ;;
    ahead)
      # Each run reads the journal once, so a run that started before a
      # migration merged sees a database a newer run already migrated.
      # Restoring would roll the shared database back under every preview.
      fail "$LIVE_DB is ahead of the expected journal: applied $(count_lines "$applied"), expected $(count_lines "$EXPECTED_JOURNAL"). The default branch gained a migration after this run read it; run it again."
      ;;
    *)
      echo "sync: restoring, $LIVE_DB diverged from the expected journal"
      restore
      ;;
  esac
}

restore() {
  require_journal
  require_migrations_archive
  echo "restoring $SEED_DB from the dev replica"
  # --db-only keeps this to the dev tier's own db container. The scoping that
  # keeps it off production lives in the scripts' .env, the dev environment's
  # SCRIPTS_ENV secret: OTR_WEB_DIR must point at the dev tier directory and
  # DB_NAME at the seed. --skip-migrations because this tier's compose file has
  # no migrate service; the seed is migrated below instead.
  local output status=0
  # shellcheck disable=SC2086 # the seam is a command line, not one word
  output="$(cd "$OTR_SCRIPTS_DIR" && ${DEV_RESTORE_COMMAND:-uv run python src/main.py \
    --script recovery --recovery-bucket dev --db-only --skip-migrations} 2>&1 </dev/null)" || status=$?
  redact <<<"$output"
  [[ "$status" == 0 ]] || fail "restore of $SEED_DB failed (exit $status)"

  database_exists "$SEED_DB" || fail "restore did not produce $SEED_DB"

  # The replica carries whatever schema production is on, which can trail the
  # default branch. Previews run branch code, so bring the seed forward before
  # anything clones from it.
  echo "migrating $SEED_DB"
  migrate "$SEED_DB"
  verify "$SEED_DB" "$SEED_JOURNAL"
  local problem
  if ! problem="$(health_problem "$SEED_DB")"; then
    fail "restore left $SEED_DB unusable: $problem"
  fi
  stamp "$SEED_DB" "$(now)"

  echo "rebuilding $LIVE_DB from $SEED_DB"
  disconnect "$LIVE_DB"
  query postgres "drop database if exists $LIVE_DB" >/dev/null
  disconnect "$SEED_DB"
  # wal_log, the default, spends minutes on a seed this size
  query postgres "create database $LIVE_DB template $SEED_DB strategy file_copy" >/dev/null
  echo "rebuilt $LIVE_DB"
}

capacity() { # capacity <target>
  local free seed clones verdict
  free="$(docker exec "$CONTAINER" sh -c 'df -P -B1 "${PGDATA:-/var/lib/postgresql/data}"' </dev/null |
    awk 'NR == 2 { print $4 }')"
  seed="$(database_size "$SEED_DB")"
  clones="$(query postgres "select count(*) from pg_database
    where datname ~ '^otr_pr_[0-9]+\$' and datname <> '$1'")"

  verdict="$(check_capacity "$free" "$seed" "$clones" "$MAX_CLONES" \
    "$FREE_FACTOR_PERCENT" "$MIN_FREE_BYTES")"
  case "$verdict" in
    refuse-cap)
      refuse "$clones preview databases already exist and the cap is $MAX_CLONES. Close a stale pull request, or run the Dev tier reap action."
      ;;
    refuse-disk)
      refuse "the postgres volume has $free bytes free and a copy of $seed bytes needs ${FREE_FACTOR_PERCENT}% of that plus $MIN_FREE_BYTES headroom. Close a stale pull request, or run the Dev tier reap action."
      ;;
  esac
  echo "capacity ok, $free bytes free, $clones of $MAX_CLONES preview databases"
}

clone() { # clone <database>
  require_journal
  require_clone_name "$1"

  local problem
  if ! problem="$(health_problem "$SEED_DB")"; then
    echo "clone: restoring first, $problem"
    restore
  fi

  local seed_generation exists=false status='' generation='' created='' age='' action
  seed_generation="$(provenance_field "$(provenance "$SEED_DB")" generation)"

  if database_exists "$1"; then
    local recorded
    exists=true
    recorded="$(provenance "$1")"
    generation="$(provenance_field "$recorded" generation)"
    created="$(provenance_field "$recorded" created)"
    status="$(status_of "$1")"
    if [[ "$created" =~ ^[0-9]+$ ]]; then
      age="$(($(now) - created))"
    fi
  fi

  action="$(decide_clone_action "$exists" "$status" "$generation" "$seed_generation" \
    "$age" "$((CLONE_MAX_AGE_DAYS * 86400))")"
  echo "action=$action"

  case "$action" in
    create | recreate)
      capacity "$1"
      disconnect "$1"
      query postgres "drop database if exists $1" >/dev/null
      disconnect "$SEED_DB"
      query postgres "create database $1 template $SEED_DB strategy file_copy" >/dev/null
      # TEMPLATE does not copy the comment.
      stamp "$1" "${seed_generation:-0}"
      ;;
    reuse)
      echo "reusing $1, it already matches the expected journal"
      ;;
    reuse-migrate)
      echo "reusing $1, it is behind the expected journal"
      ;;
  esac
  info "$1"
}

verify() { # verify <database> [<journal>], EXPECTED_JOURNAL by default
  require_journal
  local journal="${2:-$EXPECTED_JOURNAL}" applied status message
  applied="$(applied_journal "$1")"
  status="$(classify_journal "$applied" "$journal")"
  if [[ "$status" != match ]]; then
    message="$1 is $status: applied $(count_lines "$applied"), expected $(count_lines "$journal")"
    if [[ -n "$MIGRATION_SOURCE" ]]; then
      message+="; the migrator ran $MIGRATION_SOURCE"
    fi
    fail "$message"
  fi
  echo "verified $1 against $(count_lines "$journal") expected migrations"
}

info() { # info <database>
  database_exists "$1" || fail "database $1 does not exist"
  local recorded age
  recorded="$(provenance "$1")"
  age="$(query "$1" "select coalesce(extract(epoch from now() - max(created))::bigint, -1)
    from matches" 2>/dev/null || true)"

  echo "database=$1"
  echo "size=$(database_size "$1")"
  echo "size_pretty=$(query postgres "select pg_size_pretty(pg_database_size('$1'))")"
  echo "generation=$(provenance_field "$recorded" generation)"
  echo "cloned=$(provenance_field "$recorded" created)"
  echo "data_age_seconds=${age:--1}"
}

drop() { # drop <database>
  require_clone_name "$1"
  disconnect "$1"
  query postgres "drop database if exists $1" >/dev/null
  echo "dropped $1"
}

reap() { # reap [--dry-run] [--force]
  local dry=false force=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) dry=true ;;
      --force) force=true ;;
      *) usage ;;
    esac
    shift
  done

  # Unset means the runner never asked GitHub; empty means nothing is open.
  [[ -n "${OPEN_PRS+set}" ]] || fail "OPEN_PRS is not set; the runner must pass it in"

  local existing candidates count database number size total=0
  existing="$(query postgres "select datname from pg_database
    where datname ~ '^otr_pr_[0-9]+\$' order by datname")"
  candidates="$(select_reapable "$existing" "$OPEN_PRS")"
  count="$(count_lines "$candidates")"

  if ((count > REAP_LIMIT)) && [[ "$force" != true ]]; then
    fail "$count databases to reap exceeds DEV_DB_REAP_LIMIT of $REAP_LIMIT; pass --force"
  fi

  while IFS= read -r database; do
    [[ -n "$database" ]] || continue
    number="${database##otr_pr_}"
    size="$(database_size "$database")"
    total=$((total + size))
    if [[ "$dry" == true ]]; then
      echo "would remove $database ($size bytes) and the pr-$number stack"
      continue
    fi
    remove_stack "$number"
    disconnect "$database"
    query postgres "drop database if exists $database" >/dev/null
    echo "removed $database ($size bytes) and the pr-$number stack"
  done <<<"$candidates"

  echo "reap: $count databases, $total bytes"
}

remove_stack() { # remove_stack <pr number>
  local directory="$PREVIEW_REMOTE_PATH/pr-$1"
  if [[ -n "$PREVIEW_REMOTE_PATH" && -d "$directory" ]]; then
    (
      cd "$directory"
      # No -v: the compose file names shared volumes.
      docker compose -p "otr-pr-$1" down --remove-orphans </dev/null
    ) || true
    rm -rf "$directory"
  else
    docker ps -aq --filter "label=com.docker.compose.project=otr-pr-$1" |
      xargs -r docker rm -f >/dev/null
  fi
}

usage() {
  echo "usage: $0 {capabilities|classify <db>|check|sync|restore|clone <db>|verify <db>|info <db>|drop <db>|reap [--dry-run] [--force]}" >&2
  exit 2
}

# Taken once, here; read-only subcommands share it.
lock() { # lock <-s|-x>
  exec 9>"$LOCK_FILE"
  flock -w "$LOCK_WAIT" -E 4 "$1" 9 || {
    echo "dev-db: another dev tier operation still holds the lock after ${LOCK_WAIT}s" >&2
    exit 4
  }
}

command="${1:-}"
shift || true
case "$command" in
  classify | info | clone | verify | drop) [[ -n "${1:-}" ]] || usage ;;
esac

case "$command" in
  capabilities) capabilities ;;
  classify)
    lock -s
    classify "$1"
    ;;
  check)
    lock -s
    check
    ;;
  info)
    lock -s
    info "$1"
    ;;
  sync)
    lock -x
    sync
    ;;
  restore)
    lock -x
    restore
    ;;
  clone)
    lock -x
    clone "$1"
    ;;
  verify)
    lock -s
    verify "$1"
    ;;
  drop)
    lock -x
    drop "$1"
    ;;
  reap)
    lock -x
    reap "$@"
    ;;
  *) usage ;;
esac
