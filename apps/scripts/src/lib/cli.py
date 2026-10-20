import argparse
from argparse import ArgumentParser, Namespace
from dataclasses import dataclass
from pathlib import Path

from lib.constants import buckets, scripts


@dataclass(frozen=True)
class ScriptArgs:
    scripts: list[str]
    log_dir: Path
    archive_bucket: str | None
    recovery_bucket: str | None
    recovery_src: Path | None
    db_only: bool
    skip_migrations: bool
    upload_hash: bool
    template_action: str | None
    template_name: str | None
    template_src: Path | None
    template_web_dir: Path | None = None
    logs_dirs: tuple[Path, ...] = ()
    receipts_upload: bool = False


_script_options = [
    scripts.ARCHIVE,
    scripts.PROCESSOR,
    scripts.RECOVERY,
    scripts.REFRESH_INDEX,
    scripts.TEMPLATE_DB,
    scripts.BACKFILL_RECEIPTS,
]
_template_actions = [
    scripts.SEED,
    scripts.CREATE,
    scripts.DROP,
    scripts.LIST,
]
_buckets = [
    buckets.TEST,
    buckets.DEV,
    buckets.PUBLIC,
    buckets.PROD,
]


def init() -> ScriptArgs:
    """Initializes CLI args

    Returns:
        ScriptArgs: Resolved configuration from CLI args
    """
    parser = argparse.ArgumentParser(
        prog="otr-scripts", description="Run one or more scripts"
    )

    args = add_args(parser)
    validate_args(args, parser)

    # For each script provided as an argument, get the enum

    # Return the type-safe args
    return ScriptArgs(
        args.script,
        Path(args.log_dir),
        args.archive_bucket,
        args.recovery_bucket,
        Path(args.recovery_src) if args.recovery_src else None,
        args.db_only,
        args.skip_migrations,
        args.upload_hash,
        args.template_action,
        args.template_name,
        Path(args.template_src) if args.template_src else None,
        Path(args.template_web_dir) if args.template_web_dir else None,
        tuple(Path(directory) for directory in args.logs_dir or ()),
        args.upload,
    )


def add_args(parser: ArgumentParser):
    parser.add_argument(
        "-s",
        "--script",
        type=str,
        required=True,
        choices=_script_options,
        nargs="+",
    )

    parser.add_argument("--log-dir", type=str, required=False, default="./logs")

    archive_args = parser.add_argument_group(
        "archive", f"Args specific to the {scripts.ARCHIVE} script"
    )
    archive_args.add_argument(
        "--archive-bucket",
        help="GCS bucket used for publishing archives",
        choices=_buckets,
    )
    archive_args.add_argument(
        "--upload-hash",
        action="store_true",
        help="Whether to upload a SHA256 hash with the archive "
        "(public archives always upload one)",
    )

    recovery_args = parser.add_argument_group(
        "recovery", f"Args specific to the {scripts.RECOVERY} script"
    )
    recovery_src_args = recovery_args.add_mutually_exclusive_group()
    recovery_src_args.add_argument(
        "--recovery-bucket",
        help="GCS bucket used for disaster recovery",
        choices=_buckets,
    )
    recovery_src_args.add_argument(
        "--recovery-src",
        type=str,
        help="Path to a local database archive to use in recovery instead of a GCS bucket",
    )
    recovery_args.add_argument(
        "--db-only",
        action="store_true",
        help="During recovery, restore in place instead of restarting the "
        "docker-compose stack",
    )
    recovery_args.add_argument(
        "--skip-migrations",
        action="store_true",
        help="During recovery, leave the restored schema as the dump had it "
        "instead of running the docker-compose migrate service, for a caller "
        "that migrates the database itself",
    )

    template_args = parser.add_argument_group(
        "template-db", f"Args specific to the {scripts.TEMPLATE_DB} script"
    )
    template_args.add_argument(
        "--template-action",
        help="Action to perform against the template database container",
        choices=_template_actions,
    )
    template_args.add_argument(
        "--template-name",
        type=str,
        help="Name of the instance database to create or drop",
    )
    template_args.add_argument(
        "--template-src",
        type=str,
        help="Path to a local archive to seed the template with instead of the "
        "latest dev archive",
    )

    template_args.add_argument(
        "--template-web-dir",
        type=Path,
        help="Task otr checkout with installed dependencies (required for create)",
    )

    receipt_args = parser.add_argument_group(
        "backfill-receipts", f"Args specific to the {scripts.BACKFILL_RECEIPTS} script"
    )
    receipt_args.add_argument(
        "--logs-dir",
        action="append",
        help="Directory of processor run logs to read; repeat for several. "
        "Each logged run replaces the schedule's guess for its day",
    )
    receipt_args.add_argument(
        "--upload",
        action="store_true",
        help="Publish the derived receipts in the public bucket instead of only "
        "writing them for review",
    )

    args = parser.parse_args()
    return args


def validate_args(args: Namespace, parser: ArgumentParser):
    validate_archive(args, parser)
    validate_disaster_recovery(args, parser)
    validate_template_db(args, parser)


def validate_archive(args: Namespace, parser: ArgumentParser):
    if scripts.ARCHIVE not in args.script:
        return

    if not args.archive_bucket:
        parser.error("An archive bucket must be supplied to perform an archive")


def validate_disaster_recovery(args: Namespace, parser: ArgumentParser):
    if scripts.RECOVERY not in args.script:
        return

    if not args.recovery_bucket and not args.recovery_src:
        parser.error(
            "Either a recovery bucket (--recovery-bucket) or a local source "
            "(--recovery-src) must be supplied to perform a disaster recovery"
        )


def validate_template_db(args: Namespace, parser: ArgumentParser):
    if scripts.TEMPLATE_DB not in args.script:
        return

    if not args.template_action:
        parser.error(
            "An action (--template-action) must be supplied to manage template databases"
        )

    if (
        args.template_action in (scripts.CREATE, scripts.DROP)
        and not args.template_name
    ):
        parser.error(
            f"An instance name (--template-name) must be supplied to "
            f"{args.template_action} a template database"
        )

    if args.template_action == scripts.CREATE and not args.template_web_dir:
        parser.error("A task web checkout (--template-web-dir) is required for create")
