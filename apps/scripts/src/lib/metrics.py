import logging
import os
import time

from lib.cli import ScriptArgs
from lib.config import config
from lib.constants import buckets, scripts

logger = logging.getLogger(__name__)

# What production's cron runs. Recovery, template-db, and archives to other
# buckets are run by hand, so a failed one would keep alerting until someone
# ran it again.
RECORDED = {scripts.ARCHIVE, scripts.PROCESSOR, scripts.REFRESH_INDEX}
RECORDED_BUCKETS = {buckets.PROD, buckets.PUBLIC}


def record_run(
    script: str, args: ScriptArgs, succeeded: bool, duration_seconds: float
) -> None:
    """Records how a run ended for node-exporter's textfile collector

    The rules in monitoring/prod/prometheus/rules alert when the last run
    failed, and when no run has finished for longer than its cron interval,
    which also covers a run that crashed before reaching here or never started.
    Each script, and each archive bucket, has its own file, so one run never
    overwrites another's result. Does nothing unless METRICS_DIR is set.
    """
    if config.metrics_dir is None or script not in RECORDED:
        return
    if script == scripts.ARCHIVE and args.archive_bucket not in RECORDED_BUCKETS:
        return

    labels = f'script="{script}"'
    name = script
    if script == scripts.ARCHIVE:
        labels += f',bucket="{args.archive_bucket}"'
        name += f"_{args.archive_bucket}"

    text = (
        "# HELP otr_script_last_run_timestamp_seconds When the last run finished.\n"
        "# TYPE otr_script_last_run_timestamp_seconds gauge\n"
        f"otr_script_last_run_timestamp_seconds{{{labels}}} {time.time():.0f}\n"
        "# HELP otr_script_last_run_success Whether the last run succeeded.\n"
        "# TYPE otr_script_last_run_success gauge\n"
        f"otr_script_last_run_success{{{labels}}} {int(succeeded)}\n"
        "# HELP otr_script_last_run_duration_seconds How long the last run took.\n"
        "# TYPE otr_script_last_run_duration_seconds gauge\n"
        f"otr_script_last_run_duration_seconds{{{labels}}} {duration_seconds:.0f}\n"
    )

    path = config.metrics_dir / f"otr_script_{name}.prom"
    # node-exporter reads only *.prom files, so it never sees a partial write.
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")

    # The exit code already reports the run itself, and a missing result
    # raises the overdue alert, so a failed write only logs.
    try:
        partial.write_text(text)
        # node-exporter runs as another user.
        partial.chmod(0o644)
        os.replace(partial, path)
    except OSError:
        logger.exception(f"Recording the '{script}' run in {path} failed")
        partial.unlink(missing_ok=True)
