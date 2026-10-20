import logging
import subprocess
from collections.abc import Callable

from lib import receipt
from lib.config import config

logger = logging.getLogger(__name__)

# Each run's container goes by this name in Docker and in its logs. Docker
# refuses a second container with the same name, so runs cannot overlap.
CONTAINER_NAME = "otr-processor"


def _stream(cmd: list[str], on_line: Callable[[str], None] | None = None) -> int:
    """Run a command, logging each line of its output as it arrives"""
    with subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    ) as proc:
        for line in proc.stdout:
            line = line.rstrip("\n")
            logger.info(line)
            if on_line is not None:
                on_line(line)

    return proc.returncode


def run() -> bool:
    tag = config.tag
    image = f"stagecodes/otr-processor:{tag}"

    pull_cmd = f"docker pull {image}".split()

    # The digest names the exact image the run uses, whatever the tag points
    # at later.
    digests: list[str] = []

    def find_digest(line: str) -> None:
        if digest := receipt.pulled_digest(line):
            digests.append(digest)

    logger.info(f"Pulling {pull_cmd}")
    # A stale local image would rate with old code, so a failed pull stops here.
    if (code := _stream(pull_cmd, find_digest)) != 0:
        logger.error(f"Pulling {image} failed (code {code})")
        return False

    conn_str = f"postgresql://{config.db_user}:{config.db_password}@localhost:{config.db_port}/{config.db_name}"
    rust_log = "info"

    # --rm removes the container once it exits, so runs leave none behind
    run_cmd = f"docker run --rm --name {CONTAINER_NAME} --network host -e DATABASE_URL={conn_str} -e RUST_LOG={rust_log} {image}".split()

    # The processor prints its receipt line once its transaction commits.
    receipt_lines: list[str] = []

    def find_receipt(line: str) -> None:
        if receipt.is_processor_line(line):
            receipt_lines.append(line)

    logger.info("Running processor")
    if (code := _stream(run_cmd, find_receipt)) != 0:
        logger.error(f"Processor failed (code {code})")
        return False

    # The ratings are committed, so the receipt never decides the result.
    receipt.publish_run(receipt_lines, image, digests[-1] if digests else None)
    return True
