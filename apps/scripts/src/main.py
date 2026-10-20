import logging
import sys
import time
from collections.abc import Callable
from functools import partial

from lib import cli, logs, metrics, processor, public_html
from lib.constants import scripts
from lib.scripts import db, receipts_backfill, template_db

logger = logging.getLogger(__name__)


def main() -> int:
    args = cli.init()
    logs.init()

    script_map: dict[str, Callable[[], bool]] = {
        scripts.ARCHIVE: partial(db.archive, args),
        scripts.PROCESSOR: processor.run,
        scripts.RECOVERY: partial(db.recovery, args),
        scripts.REFRESH_INDEX: public_html.generate_index,
        scripts.TEMPLATE_DB: partial(template_db.run, args),
        scripts.BACKFILL_RECEIPTS: partial(receipts_backfill.run, args),
    }

    for script in args.scripts:
        with logs.script_log(args.log_dir, script) as log_path:
            logger.info(f"Running '{script}', logging to {log_path}")
            logger.info(f"Resolved args: {args}")

            # Only an explicit True is success, so a script that forgets to
            # return a result fails loudly instead of passing for a success.
            started = time.monotonic()
            try:
                succeeded = script_map[script]() is True
            except Exception:
                logger.exception(f"'{script}' failed")
                metrics.record_run(script, args, False, time.monotonic() - started)
                return 1

            metrics.record_run(script, args, succeeded, time.monotonic() - started)
            if not succeeded:
                logger.error(f"'{script}' failed")
                return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
