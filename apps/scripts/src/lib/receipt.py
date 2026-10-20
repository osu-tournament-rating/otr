"""Rating run receipts

A receipt records what one rating run did: when it ran, which processor image
it ran, and what it rated. Receipts are published in the public bucket beside
the replicas, where otr-replay reads them to replay the run that published the
ratings of a given time, instead of guessing it from publication times.

The processor prints the run's half of a receipt as one stdout line after its
transaction commits (apps/processor/src/receipt.rs). `processor.run` adds the
image it ran and publishes the result. Receipts for runs from before then are
derived by `lib.scripts.receipts_backfill`, which marks what it inferred.
"""

import json
import logging
import re
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from lib.config import config
from lib.constants import buckets
from lib.gcs import gcs_utils
from lib.public_html import generate_index

logger = logging.getLogger(__name__)

# The layout below. otr-replay reads receipts of this version only.
RECEIPT_VERSION = 1

# Starts the processor's receipt line; apps/processor/src/receipt.rs prints it.
PROCESSOR_PREFIX = "OTR_RECEIPT="

# Receipts are named for when their run started, so they sort by time.
NAME_PREFIX = buckets.RECEIPT_PREFIX
_NAME = re.compile(
    rf"^{NAME_PREFIX}(\d{{4}})-(\d{{2}})-(\d{{2}})T(\d{{2}}):(\d{{2}}):(\d{{2}})Z\.json$"
)

PROCESSOR_IMAGE = "stagecodes/otr-processor"
DOCKER_HUB_TAGS = (
    "https://hub.docker.com/v2/repositories/stagecodes/otr-processor/tags"
    "?page_size=100"
)
# Docker Hub lists about 100 tags a page, so this bounds the listing far above
# any real count while still ending a listing that never stops.
_MAX_PAGES = 100

# The line `docker pull` prints with the digest of the image it pulled.
_PULLED_DIGEST = re.compile(r"^Digest: (sha256:[0-9a-f]{64})$")
# Release tags: YYYY.MM.DD, then YYYY.MM.DD.N for later releases that day.
_RELEASE_TAG = re.compile(r"^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$")
# otr's deploy also tags each image it builds with the commit it built.
_COMMIT_TAG = re.compile(r"^sha-([0-9a-f]{40})$")


def is_processor_line(line: str) -> bool:
    """Whether a processor output line is its receipt line"""
    return line.startswith(PROCESSOR_PREFIX)


def parse_processor_line(line: str) -> dict:
    """The run half of a receipt from the processor's receipt line"""
    run = json.loads(line.removeprefix(PROCESSOR_PREFIX))
    if not isinstance(run, dict) or not isinstance(run.get("started_at"), str):
        raise TypeError(f"the processor's receipt line has no start time: {line}")
    return run


def pulled_digest(line: str) -> str | None:
    """The image digest from a `docker pull` output line, or None"""
    match = _PULLED_DIGEST.match(line.strip())
    return match.group(1) if match else None


def receipt_name(started_at: datetime) -> str:
    return f"{NAME_PREFIX}{started_at.astimezone(UTC):%Y-%m-%dT%H:%M:%SZ}.json"


def parse_receipt_name(name: str) -> datetime | None:
    """When the run a receipt's file name describes started, or None"""
    match = _NAME.match(name)
    if match is None:
        return None
    try:
        return datetime(*map(int, match.groups()), tzinfo=UTC)
    except ValueError:
        return None


def format_utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return (
        parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    )


def image_release(digest: str, tags: list[dict]) -> tuple[str | None, str | None]:
    """The release tag and build commit of the image with `digest`

    otr writes each release tag once, on the image that release built, and
    tags the image with its commit as `sha-<commit>`. `latest` names the same
    image and is not a release. Either is None when no tag of its kind names
    the image, as for images built by the former otr-processor repository,
    which carry no commit tag.
    """
    release = commit = None
    for tag in tags:
        if tag.get("digest") != digest:
            continue
        name = tag.get("name", "")
        if _RELEASE_TAG.match(name):
            release = name
        elif match := _COMMIT_TAG.match(name):
            commit = match.group(1)
    return release, commit


def fetch_docker_tags() -> list[dict]:
    """Every tag of the processor image on Docker Hub"""
    tags: list[dict] = []
    url = DOCKER_HUB_TAGS
    for _ in range(_MAX_PAGES):
        page = get_json(url)
        tags.extend(page["results"])
        url = page.get("next")
        if url is None:
            return tags
    raise RuntimeError(f"Docker Hub listed more than {_MAX_PAGES} pages of tags")


def get_json(url: str) -> dict | list:
    request = urllib.request.Request(url, headers={"user-agent": "otr-scripts"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def build(
    run: dict,
    *,
    environment: str,
    requested: str | None,
    digest: str | None,
    release: str | None,
    commit: str | None,
    inferred: dict[str, str] | None = None,
) -> dict:
    """A complete receipt

    `run` holds what the processor printed: run_id, started_at, decay_horizon,
    committed_at, and counts. `inferred` names each field that was not
    observed, with what it was inferred from, and is empty for a receipt a
    run published itself.
    """
    return {
        "receipt_version": RECEIPT_VERSION,
        "environment": environment,
        "run_id": run.get("run_id"),
        "started_at": run["started_at"],
        "decay_horizon": run.get("decay_horizon"),
        "committed_at": run.get("committed_at"),
        "processor": {
            "release": release,
            "commit": commit,
            "image": f"{PROCESSOR_IMAGE}@{digest}" if digest else None,
            "requested": requested,
        },
        "counts": run.get("counts"),
        "inferred": inferred or {},
    }


def write(receipt: dict, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / receipt_name(parse_utc(receipt["started_at"]))
    path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return path


def local_dir() -> Path:
    return config.dump_dir / "receipts"


def publish_run(lines: list[str], requested: str, digest: str | None) -> None:
    """Publishes the receipt of the processor run that just committed

    `lines` holds the receipt lines the processor printed. The ratings are
    already committed, so nothing here may fail the run: every problem is
    logged as an error and the receipt is skipped. Only production publishes
    receipts, since the public bucket describes production's ratings.
    """
    try:
        if len(lines) != 1:
            logger.error(
                f"The processor printed {len(lines)} receipts instead of one, so "
                "this run has no receipt. Its ratings are committed."
            )
            return
        run = parse_processor_line(lines[0])

        release = commit = None
        if digest is None:
            logger.error(
                f"Pulling {requested} printed no image digest, so the receipt "
                "names no image"
            )
        else:
            try:
                release, commit = image_release(digest, fetch_docker_tags())
            except Exception:
                logger.exception(
                    f"Looking up the release of {PROCESSOR_IMAGE}@{digest} on "
                    "Docker Hub failed, so the receipt names the image only"
                )

        receipt = build(
            run,
            environment=config.environment,
            requested=requested,
            digest=digest,
            release=release,
            commit=commit,
        )
        path = write(receipt, local_dir())
        logger.info(f"Wrote the run's receipt to {path}")

        if config.environment != "production":
            logger.info(
                f"Not publishing the receipt: only production publishes receipts, "
                f"and this is {config.environment}"
            )
            return

        gcs_utils.upload(path, buckets.PUBLIC)
        generate_index()
        logger.info(f"Published {path.name}")
    except Exception:
        logger.exception(
            "Publishing the run's receipt failed. Its ratings are committed. "
            "The backfill-receipts script can publish the receipt from this log."
        )
