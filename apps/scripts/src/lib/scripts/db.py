# Archive the current state of the db and upload to gcp
import itertools
import logging
import re
import shlex
import subprocess
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from lib.cli import ScriptArgs
from lib.config import config
from lib.constants import buckets
from lib.gcs import gcs_utils
from lib.public_html import generate_index
from lib.security import hash

logger = logging.getLogger(__name__)


# Include data for exactly these tables in public archives
public_data_table_whitelist = [
    "drizzle.__drizzle_migrations",
    "public.beatmap_attributes",
    "public.beatmaps",
    "public.beatmapsets",
    "public.game_scores",
    "public.games",
    "public.join_beatmap_creators",
    "public.join_pooled_beatmaps",
    "public.matches",
    "public.player_osu_ruleset_data",
    "public.players",
    "public.tournaments",
]

# Dev archives mirror production row for row. These columns are credentials,
# not data; auth_accounts holds live osu! OAuth tokens for accounts o!TR does
# not control.
dev_secret_columns = {
    "public.api_keys": ("key",),
    "public.auth_accounts": (
        "access_token",
        "refresh_token",
        "id_token",
        "password",
    ),
    "public.auth_sessions": ("token",),
    "public.auth_verifications": ("value",),
    "public.o_auth_clients": ("secret",),
}

# Dev archives keep these tables' schema but none of their rows. Queued jobs
# belong to production, and a dev data worker would run them again.
dev_excluded_table_data = ["public.jobs"]

# Grafana reads production through this role, which web migration 0041
# creates. pg_dump keeps its grants but not the role, and recovery stops at the
# first error, so production archives create it first. The others carry no
# grants: the dev tier and replica imports have no use for the role.
GRAFANA_ROLE = "otr_grafana_read_only"
_ROLE_PREAMBLE = (
    "DO $$ BEGIN "
    f"IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{GRAFANA_ROLE}') THEN "
    f"CREATE ROLE {GRAFANA_ROLE} NOLOGIN; "
    "END IF; END $$;"
)

# Redacted values are text keyed on the row id, keeping NOT NULL and UNIQUE.
_redactable_types = {"text", "character varying", "character"}


@dataclass(frozen=True)
class Column:
    name: str
    data_type: str


def _compose(command: str) -> int:
    profile = " --profile node-exporter" if config.environment == "production" else ""
    return subprocess.run(
        f"docker compose{profile} {command}",
        shell=True,
        cwd=config.otr_web_dir,
        check=False,
    ).returncode


def _wait_for_db(timeout: float = 60) -> bool:
    deadline = time.monotonic() + timeout

    while True:
        ready = subprocess.run(
            ["docker", "exec", config.db_container, "pg_isready", "-U", config.db_user],
            capture_output=True,
            check=False,
        )
        if ready.returncode == 0:
            return True
        if time.monotonic() >= deadline:
            logger.error(f"{config.db_container} not ready after {timeout:.0f}s")
            return False
        time.sleep(1)


def _restore_steps(dump: Path) -> list[list[str]]:
    load = shlex.join(
        [
            "docker",
            "exec",
            "-i",
            config.db_container,
            "psql",
            "-U",
            config.db_user,
            "-d",
            config.db_name,
            "-v",
            "ON_ERROR_STOP=1",
            "--quiet",
        ]
    )

    return [
        _psql_command(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            f"WHERE datname = '{config.db_name}' AND pid <> pg_backend_pid()",
            db="template1",
        ),
        _psql_command(f"DROP DATABASE IF EXISTS {config.db_name}", db="template1"),
        _psql_command(f"CREATE DATABASE {config.db_name}", db="template1"),
        [
            "bash",
            "-o",
            "pipefail",
            "-c",
            f"gunzip -c {shlex.quote(str(dump))} | {load}",
        ],
    ]


def _restore(dump: Path, db_only: bool, migrate: bool) -> bool:
    """Replace the database with the dump, logging the step that failed"""
    if not db_only and _compose("down") != 0:
        logger.error(f"Stopping the stack failed, so {dump.name} was not restored")
        return False

    if _compose("up -d db") != 0:
        logger.error(
            f"Starting {config.db_container} failed, so {dump.name} was not restored"
        )
        return False

    if not _wait_for_db():
        return False

    started = time.monotonic()
    for step in _restore_steps(dump):
        returncode = subprocess.run(step, check=False).returncode
        if returncode != 0:
            logger.error(
                f"Restore of {dump.name} into {config.db_name} failed after "
                f"{time.monotonic() - started:.0f}s (exit code {returncode})"
            )
            return False

    if not migrate:
        logger.info(
            f"Restored {dump.name} into {config.db_name} in "
            f"{time.monotonic() - started:.0f}s, skipping migrations"
        )
        return True

    # The dump carries the schema of the tier it came from, so the deployed
    # image's pending migrations must be replayed before the stack serves it.
    if _compose("--profile migrate run --rm migrate") != 0:
        logger.error(
            f"Restored {dump.name} into {config.db_name} but migrating it failed "
            f"after {time.monotonic() - started:.0f}s; the stack is serving an "
            "outdated schema"
        )
        return False

    logger.info(
        f"Restored and migrated {dump.name} into {config.db_name} in "
        f"{time.monotonic() - started:.0f}s"
    )
    return True


def _import(dump: Path, db_only: bool = False, migrate: bool = True) -> bool:
    """Import a local dump to the database

    Args:
        dump: Path to the gzipped database dump to restore.
        db_only: When True, leave the docker-compose stack running and restore
            in place, dropping only the connections to the target database.
        migrate: When False, skip the docker-compose migrate service. The dev
            tier has no such service; its dev-db.sh migrates the database
            itself once the restore returns.
    """
    if dump.suffix != ".gz":
        logger.error(f"Expected dump path to end with '.gz': {dump}")
        return False

    restored = _restore(dump, db_only, migrate)

    # A full restore stops the stack, so it comes back even when the restore
    # failed part way.
    if not db_only and _compose("up -d") != 0:
        logger.error("Restarting the stack failed; its services may still be down")
        return False

    return restored


def prune_dumps(keep: Path):
    """Remove older archives of the same kind as `keep` from its directory"""
    kind = keep.name.rsplit("_", 1)[0]

    for old in keep.parent.glob(f"{kind}_*.gz"):
        if old.name < keep.name:
            old.unlink(missing_ok=True)
            logger.info(f"Removed {old}")


def _pg_dump_options(option: str, patterns: list[str]) -> list[str]:
    return list(
        itertools.chain.from_iterable((option, pattern) for pattern in patterns)
    )


def _pg_dump_command(
    options: list[str], clean: bool = True, privileges: bool = True
) -> str:
    clean_options = ["-c", "--if-exists"] if clean else []
    privilege_options = [] if privileges else ["--no-privileges"]
    return shlex.join(
        [
            "docker",
            "exec",
            "-i",
            config.db_container,
            "pg_dump",
            *clean_options,
            *privilege_options,
            "-U",
            config.db_user,
            *options,
            "-d",
            config.db_name,
        ]
    )


def _gzip_dump_command(dump_commands: list[str], dest: Path) -> str:
    if len(dump_commands) == 1:
        dump_command = dump_commands[0]
    else:
        dump_command = "{ " + " && ".join(dump_commands) + "; }"

    return f"{dump_command} | gzip > {shlex.quote(str(dest))}"


_identifier = re.compile(r"^[a-z_][a-z0-9_]*$")


def _split_table(table: str) -> tuple[str, str]:
    """Split a qualified name, rejecting anything not safe to inline into SQL."""
    schema, _, name = table.partition(".")

    if not _identifier.match(schema) or not _identifier.match(name):
        raise RuntimeError(f"Unsupported table name: {table}")

    return schema, name


def _psql_command(sql: str, db: str | None = None) -> list[str]:
    return [
        "docker",
        "exec",
        "-i",
        config.db_container,
        "psql",
        "-U",
        config.db_user,
        "-d",
        db or config.db_name,
        "-Aqt",
        "--no-psqlrc",
        "-c",
        sql,
    ]


def _table_columns(table: str) -> list[Column]:
    """Read a table's COPY-able columns, in ordinal order, from the database."""
    schema, name = _split_table(table)

    sql = (
        "SELECT column_name, data_type FROM information_schema.columns "
        f"WHERE table_schema = '{schema}' AND table_name = '{name}' "
        "AND is_generated <> 'ALWAYS' ORDER BY ordinal_position"
    )

    result = subprocess.run(
        _psql_command(sql),
        capture_output=True,
        text=True,
        check=True,
    )

    columns = [
        Column(*line.split("|", 1))
        for line in result.stdout.splitlines()
        if line.strip()
    ]

    if not columns:
        raise RuntimeError(f"No columns found for {table}; is the schema applied?")

    return columns


def _redacted_select(column: Column) -> str:
    if column.data_type not in _redactable_types:
        raise RuntimeError(
            f"Cannot redact {column.name}: expected a text column, got {column.data_type}"
        )

    return (
        f'CASE WHEN "{column.name}" IS NULL THEN NULL '
        f"ELSE 'redacted:{column.name}:' || \"id\" END"
    )


def _redacted_copy_command(table: str, columns: list[Column]) -> str:
    _split_table(table)
    secrets = dev_secret_columns[table]

    known = {column.name for column in columns}
    missing = [secret for secret in secrets if secret not in known]
    if missing:
        raise RuntimeError(f"{table} is missing redacted columns: {', '.join(missing)}")
    if "id" not in known:
        raise RuntimeError(f"{table} has no id column to key redacted values on")

    selected = ", ".join(
        _redacted_select(column) if column.name in secrets else f'"{column.name}"'
        for column in columns
    )
    column_list = ", ".join(f'"{column.name}"' for column in columns)

    header = shlex.join(
        ["printf", "%s\\n", f"COPY {table} ({column_list}) FROM stdin;"]
    )
    rows = shlex.join(_psql_command(f"COPY (SELECT {selected} FROM {table}) TO STDOUT"))
    terminator = shlex.join(["printf", "%s\\n", "\\."])

    return f"{{ {header} && {rows} && {terminator}; }}"


def _dev_export_command(columns_by_table: dict[str, list[Column]], dest: Path) -> str:
    # Dump by section so the redacted rows land alongside the rest of the data,
    # before post-data adds the foreign keys that would validate against them.
    tables = list(dev_secret_columns)

    return _gzip_dump_command(
        [
            _pg_dump_command(["--section=pre-data"], privileges=False),
            _pg_dump_command(
                [
                    "--section=data",
                    *_pg_dump_options(
                        "--exclude-table-data", [*tables, *dev_excluded_table_data]
                    ),
                ],
                clean=False,
                privileges=False,
            ),
            *(
                _redacted_copy_command(table, columns_by_table[table])
                for table in tables
            ),
            _pg_dump_command(["--section=post-data"], clean=False, privileges=False),
        ],
        dest,
    )


def _export_command(replica: str, dest: Path) -> str:
    if replica == buckets.DEV:
        return _dev_export_command(
            {table: _table_columns(table) for table in dev_secret_columns}, dest
        )

    if replica == buckets.PUBLIC:
        # Match the original public archive script: dump the full schema so
        # extensions, functions, triggers, and FK targets exist, then include
        # data only for public-safe tables.
        return _gzip_dump_command(
            [
                _pg_dump_command(["--schema-only"], privileges=False),
                _pg_dump_command(
                    [
                        "--data-only",
                        "--disable-triggers",
                        *_pg_dump_options("--table", public_data_table_whitelist),
                    ],
                    clean=False,
                    privileges=False,
                ),
            ],
            dest,
        )

    preamble = shlex.join(["printf", "%s\\n", _ROLE_PREAMBLE])
    return _gzip_dump_command([preamble, _pg_dump_command([])], dest)


def _export(replica: str) -> Path | None:
    dump_file_format = datetime.now(UTC).strftime(
        f"otr-{replica}-replica_%Y-%m-%dT%H:%M:%SZ.gz"
    )
    config.dump_dir.mkdir(parents=True, exist_ok=True)

    dest = config.dump_dir / dump_file_format

    cmd = _export_command(replica, dest)

    logger.info(f"Running subprocess {cmd}")

    result = subprocess.run(["bash", "-o", "pipefail", "-c", cmd], check=False)

    if result.returncode != 0:
        # A truncated dump is not a backup, so it must not sit beside real ones.
        dest.unlink(missing_ok=True)
        logger.error(f"Exporting {dest.name} failed (exit code {result.returncode})")
        return None

    logger.info("Database archive creation succeeded")
    return dest


def archive(args: ScriptArgs) -> bool:
    bucket = args.archive_bucket
    if not bucket:
        raise ValueError("Archive bucket must be populated")

    # Names the step in progress, so a failure says which one broke.
    step = f"exporting the {bucket} replica"
    try:
        dump = _export(bucket)
        if dump is None:
            return False

        step = f"uploading {dump.name}"
        gcs_utils.upload(dump, bucket)

        # Public replicas are always published with a checksum so consumers
        # (including otr-replay) can verify their downloads.
        if args.upload_hash or bucket == buckets.PUBLIC:
            step = f"hashing {dump.name}"
            hash_loc = hash(dump)

            step = f"uploading {hash_loc.name}"
            gcs_utils.upload(hash_loc, bucket)

            # Remove after upload
            hash_loc.unlink()

        if bucket == buckets.PUBLIC:
            step = "refreshing the public index"
            generate_index()

        step = "removing local dumps"
        prune_dumps(dump)
        dump.unlink()

    except Exception:
        logger.exception(f"Archive failed while {step}")
        return False

    return True


def recovery(args: ScriptArgs) -> bool:
    if args.recovery_src:
        # Just import this local dump, no GCS connection needed
        return _import(
            args.recovery_src,
            db_only=args.db_only,
            migrate=not args.skip_migrations,
        )

    bucket = args.recovery_bucket
    if not bucket:
        raise ValueError("Recovery bucket must be populated")

    # Download and import
    out_file = gcs_utils.download_latest(bucket, config.dump_dir)
    if not out_file:
        return False

    if not _import(out_file, db_only=args.db_only, migrate=not args.skip_migrations):
        return False

    prune_dumps(out_file)
    return True
