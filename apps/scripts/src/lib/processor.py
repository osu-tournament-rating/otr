import logging
import subprocess

from lib.config import config

logger = logging.getLogger(__name__)

# Each run's container goes by this name in Docker and in its logs. Docker
# refuses a second container with the same name, so runs cannot overlap.
CONTAINER_NAME = "otr-processor"


def _stream(cmd: list[str]) -> int:
    """Run a command, logging each line of its output as it arrives"""
    with subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    ) as proc:
        for line in proc.stdout:
            logger.info(line.rstrip("\n"))

    return proc.returncode


def run() -> bool:
    tag = config.tag
    image = f"stagecodes/otr-processor:{tag}"

    pull_cmd = f"docker pull {image}".split()

    logger.info(f"Pulling {pull_cmd}")
    # A stale local image would rate with old code, so a failed pull stops here.
    if (code := _stream(pull_cmd)) != 0:
        logger.error(f"Pulling {image} failed (code {code})")
        return False

    conn_str = f"postgresql://{config.db_user}:{config.db_password}@localhost:{config.db_port}/{config.db_name}"
    rust_log = "info"

    # --rm removes the container once it exits, so runs leave none behind
    run_cmd = f"docker run --rm --name {CONTAINER_NAME} --network host -e DATABASE_URL={conn_str} -e RUST_LOG={rust_log} {image}".split()

    logger.info("Running processor")
    if (code := _stream(run_cmd)) != 0:
        logger.error(f"Processor failed (code {code})")
        return False

    return True
