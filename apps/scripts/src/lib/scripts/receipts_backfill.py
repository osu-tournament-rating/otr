"""Back-populates rating run receipts

Weekly rating runs published ratings long before they published receipts.
This derives a receipt for each of those runs from what still exists, so
otr-replay can replay them as it replays runs with receipts:

- Each run started on schedule, Tuesdays at 12:00 UTC, the time the docs have
  always given. Runs begin with the first Tuesday after the first public
  replica, since a replay needs a replica taken before its run.
- Each run ran the image stagecodes/otr-processor:latest named when it started.
  Until the processor moved into otr, each otr-processor release build pushed
  its version tag and latest together, so latest moved when Docker Hub
  received the version tag. Since then, otr's deploy points latest at the
  image its release notes name, as the last step of a successful run, so a
  deploy that failed or a rollback is followed.
- A processor log, when given, replaces both with what the run printed, and
  a Tuesday whose logged runs all failed gets no receipt.

Every receipt lists what was inferred, and from what, in `inferred`.
Receipts already in the public bucket are never replaced.
"""

import json
import logging
import os
import re
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from lib import receipt
from lib.cli import ScriptArgs
from lib.config import config
from lib.constants import buckets
from lib.gcs import gcs_utils
from lib.public_html import generate_index

logger = logging.getLogger(__name__)

GITHUB_API = "https://api.github.com/repos"
# The processor's former repository, whose releases end with 2026.08.16.
PROCESSOR_REPOSITORY = "osu-tournament-rating/otr-processor"
OTR_REPOSITORY = "osu-tournament-rating/otr"

# The weekly run, as the docs' rating update schedule gives it.
RUN_WEEKDAY = 1  # Tuesday
RUN_TIME = (12, 0)

# A logged run this close to a published receipt is the run that published it.
SAME_RUN = timedelta(minutes=1)

_RELEASE_TAG = re.compile(r"^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$")
# The line .github/scripts/release-notes.ts writes into every otr release.
_PROCESSOR_NOTE = re.compile(
    r"^Processor image: stagecodes/otr-processor:(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)"
    r"(?: \(unchanged since that release\))?$",
    re.MULTILINE,
)
_REPLICA = re.compile(
    r"^otr-public-replica_(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z\.gz$"
)
_NEXT_LINK = re.compile(r'<([^>]+)>;\s*rel="next"')
_PAGES = 100

# Processor log lines, from the scripts' log of a processor run.
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_UTC = r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)"
_BEGIN = re.compile(_UTC + r"\s+INFO\b.*?\bBegin processing")
_COMMIT = re.compile(_UTC + r"\s+INFO\b.*?\bCOMMIT TRANSACTION")
_RUN_ID = re.compile(
    r'\brun_id="?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
)
_RECEIPT_LINE = re.compile(
    re.escape(receipt.PROCESSOR_PREFIX) + r"(\{.*\})[ \t]*$", re.MULTILINE
)
_REQUESTED = re.compile(r"(stagecodes/otr-processor:[\w.-]+)")
_DIGEST = re.compile(r"\bDigest: (sha256:[0-9a-f]{64})")


@dataclass(frozen=True)
class Move:
    """stagecodes/otr-processor:latest pointing at a new image"""

    at: datetime
    # None when the image it moved to cannot be identified.
    digest: str | None
    evidence: str


@dataclass(frozen=True)
class LoggedRun:
    """A processor run as one of the scripts' logs recorded it"""

    source: str
    started_at: datetime
    # None for a run that never committed.
    committed_at: datetime | None
    run_id: str | None
    requested: str | None
    digest: str | None
    # The run half of the receipt, when the processor printed one.
    printed: dict | None


def scheduled_runs(after: datetime, before: datetime) -> list[datetime]:
    """Every scheduled run start after `after` and before `before`"""
    day = after.astimezone(UTC).replace(
        hour=RUN_TIME[0], minute=RUN_TIME[1], second=0, microsecond=0
    )
    day += timedelta(days=(RUN_WEEKDAY - day.weekday()) % 7)
    if day <= after:
        day += timedelta(days=7)
    runs = []
    while day < before:
        runs.append(day)
        day += timedelta(days=7)
    return runs


def latest_moves(
    processor_releases: Iterable[dict],
    otr_releases: Iterable[dict],
    tag_commits: dict[str, str],
    deploy_runs: Iterable[dict],
    tags: Iterable[dict],
) -> list[Move]:
    """Every time stagecodes/otr-processor:latest moved, oldest first

    `tag_commits` maps otr's tags to the commits they name, and `tags` holds
    the image's Docker Hub tags.
    """
    images = {tag["name"]: tag for tag in tags if tag.get("digest")}
    moves = []

    for release in processor_releases:
        tag = release["tag_name"]
        if release.get("draft") or not _RELEASE_TAG.match(tag) or tag not in images:
            continue
        pushed = receipt.parse_utc(images[tag]["tag_last_pushed"])
        moves.append(
            Move(
                pushed,
                images[tag]["digest"],
                f"otr-processor's release build of {tag} pushed it as latest at "
                f"{_show(pushed)}",
            )
        )

    notes = {
        release["tag_name"]: match.group(1)
        for release in otr_releases
        if not release.get("draft")
        and (match := _PROCESSOR_NOTE.search(release.get("body") or ""))
    }
    releases_by_commit: dict[str, list[str]] = {}
    for tag, commit in tag_commits.items():
        releases_by_commit.setdefault(commit, []).append(tag)

    for run in deploy_runs:
        if run.get("conclusion") != "success":
            continue
        finished = receipt.parse_utc(run["updated_at"])
        url = run.get("html_url", f"run {run.get('id')}")
        if run.get("event") != "push":
            moves.append(
                Move(
                    finished,
                    None,
                    f"deploy {url} redeployed a release by hand at {_show(finished)}, "
                    "and which one is not recorded",
                )
            )
            continue
        released = [
            tag
            for tag in releases_by_commit.get(run.get("head_sha", ""), [])
            if tag in notes
        ]
        if not released:
            # A release from before the processor moved into otr, or a commit
            # that was never released, leaves latest where it was.
            continue
        release = released[0]
        image = notes[release]
        moves.append(
            Move(
                finished,
                images[image]["digest"] if image in images else None,
                f"deploy {url} of release {release} pointed latest at {image} at "
                f"{_show(finished)}",
            )
        )

    return sorted(moves, key=lambda move: move.at)


def move_at(moves: list[Move], at: datetime) -> Move | None:
    """The last move at or before `at`"""
    current = None
    for move in moves:
        if move.at > at:
            break
        current = move
    return current


def parse_log(text: str, source: str) -> LoggedRun | None:
    """The processor run a scripts log recorded, or None if it holds none

    Raises ValueError for a log that holds more than one run.
    """
    text = _ANSI.sub("", text)
    begins = _BEGIN.findall(text)
    printed_lines = _RECEIPT_LINE.findall(text)
    if not begins and not printed_lines:
        return None
    if len(begins) > 1 or len(printed_lines) > 1:
        raise ValueError(f"{source} holds more than one processor run")

    printed = json.loads(printed_lines[0]) if printed_lines else None
    commits = _COMMIT.findall(text)
    if printed is not None:
        started_at = receipt.parse_utc(printed["started_at"])
        committed_at = receipt.parse_utc(printed["committed_at"])
        run_id = printed.get("run_id")
    else:
        started_at = _parse_log_time(begins[0])
        committed_at = _parse_log_time(commits[-1]) if commits else None
        run_id_match = _RUN_ID.search(text)
        run_id = run_id_match.group(1) if run_id_match else None

    requested = _REQUESTED.search(text)
    digest = _DIGEST.search(text)
    return LoggedRun(
        source=source,
        started_at=started_at,
        committed_at=committed_at,
        run_id=run_id,
        requested=requested.group(1) if requested else None,
        digest=digest.group(1) if digest else None,
        printed=printed,
    )


def derive(
    schedule: list[datetime],
    logged: list[LoggedRun],
    moves: list[Move],
    tags: list[dict],
    published: list[datetime],
) -> tuple[list[dict], list[str]]:
    """The receipts to back-populate, and notes for the maintainer

    `published` holds the start times of the receipts already in the bucket.
    """
    notes: list[str] = []
    receipts: list[dict] = []

    committed = [run for run in logged if run.committed_at is not None]
    for run in logged:
        if run.committed_at is None:
            notes.append(
                f"{run.source}: the run that started {_show(run.started_at)} never committed"
            )

    def already_published(started_at: datetime) -> bool:
        return any(abs(started_at - other) <= SAME_RUN for other in published)

    for run in committed:
        if already_published(run.started_at):
            continue
        receipts.append(_from_log(run, moves, tags, notes))

    covered_days = {run.started_at.date() for run in logged} | {
        started_at.date() for started_at in published
    }
    for started_at in schedule:
        if started_at.date() in covered_days:
            # A logged run or a published receipt describes that day, and a
            # day whose logged runs all failed published nothing.
            continue
        receipts.append(_from_schedule(started_at, moves, tags, notes))

    receipts.sort(key=lambda doc: doc["started_at"])
    return receipts, notes


def _from_log(
    run: LoggedRun, moves: list[Move], tags: list[dict], notes: list[str]
) -> dict:
    half = run.printed or {
        "run_id": run.run_id,
        "started_at": receipt.format_utc(run.started_at),
        "decay_horizon": None,
        "committed_at": receipt.format_utc(run.committed_at),
        "counts": None,
    }
    inferred: dict[str, str] = {}
    digest = run.digest
    requested = run.requested
    if digest is None:
        digest, evidence = _inferred_image(run.started_at, moves, notes)
        inferred["processor"] = evidence
    release, commit = receipt.image_release(digest, tags) if digest else (None, None)
    return receipt.build(
        half,
        environment="production",
        requested=requested,
        digest=digest,
        release=release,
        commit=commit,
        inferred=inferred,
    )


def _from_schedule(
    started_at: datetime, moves: list[Move], tags: list[dict], notes: list[str]
) -> dict:
    digest, evidence = _inferred_image(started_at, moves, notes)
    release, commit = receipt.image_release(digest, tags) if digest else (None, None)
    return receipt.build(
        {"started_at": receipt.format_utc(started_at)},
        environment="production",
        requested=f"{receipt.PROCESSOR_IMAGE}:latest",
        digest=digest,
        release=release,
        commit=commit,
        inferred={
            "started_at": "the weekly schedule, Tuesdays 12:00 UTC; no log of the "
            "run was given",
            "processor": evidence,
        },
    )


def _inferred_image(
    at: datetime, moves: list[Move], notes: list[str]
) -> tuple[str | None, str]:
    move = move_at(moves, at)
    if move is None:
        notes.append(f"No processor image is known to have been latest at {_show(at)}")
        return None, "no image is known to have been latest then"
    if move.digest is None:
        notes.append(
            f"The image latest named at {_show(at)} is unknown: {move.evidence}"
        )
    return (
        move.digest,
        f"the image stagecodes/otr-processor:latest named then: {move.evidence}",
    )


def _parse_log_time(value: str) -> datetime:
    # Python reads at most microseconds.
    whole, _, fraction = value.removesuffix("Z").partition(".")
    return receipt.parse_utc(f"{whole}.{(fraction or '0')[:6]}+00:00")


def _show(value: datetime) -> str:
    return f"{value.astimezone(UTC):%Y-%m-%dT%H:%M:%SZ}"


def read_logs(directories: Iterable[Path]) -> tuple[list[LoggedRun], list[str]]:
    runs, notes = [], []
    for directory in directories:
        # A mistyped directory would quietly fall back to the schedule.
        if not directory.is_dir():
            raise FileNotFoundError(f"{directory} is not a directory")
        for path in sorted(directory.glob("*.log")):
            try:
                run = parse_log(path.read_text(errors="replace"), path.name)
            except (KeyError, TypeError, ValueError) as err:
                notes.append(f"Skipped {path}: {err!r}")
                continue
            if run is not None:
                runs.append(run)
    return runs, notes


def _github(url: str) -> list[dict]:
    """Every page of a GitHub listing"""
    headers = {
        "accept": "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "otr-scripts",
    }
    if token := os.getenv("GITHUB_TOKEN"):
        headers["authorization"] = f"Bearer {token}"
    items: list[dict] = []
    next_url = url
    for _ in range(_PAGES):
        request = urllib.request.Request(next_url, headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            page = json.load(response)
            link = _NEXT_LINK.search(response.headers.get("link") or "")
        items.extend(page["workflow_runs"] if isinstance(page, dict) else page)
        if link is None:
            return items
        next_url = link.group(1)
    raise RuntimeError(f"{url} listed more than {_PAGES} pages")


def fetch_sources() -> dict:
    """Everything the derivation reads from GitHub and Docker Hub"""
    refs = _github(f"{GITHUB_API}/{OTR_REPOSITORY}/git/matching-refs/tags")
    return {
        "processor_releases": _github(
            f"{GITHUB_API}/{PROCESSOR_REPOSITORY}/releases?per_page=100"
        ),
        "otr_releases": _github(f"{GITHUB_API}/{OTR_REPOSITORY}/releases?per_page=100"),
        # otr's release tags are lightweight, so each names its commit.
        "tag_commits": {
            ref["ref"].removeprefix("refs/tags/"): ref["object"]["sha"]
            for ref in refs
            if ref["object"]["type"] == "commit"
        },
        "deploy_runs": _github(
            f"{GITHUB_API}/{OTR_REPOSITORY}/actions/workflows/deploy.yml/runs"
            "?per_page=100"
        ),
        "tags": receipt.fetch_docker_tags(),
    }


def _replica_time(name: str) -> datetime | None:
    match = _REPLICA.match(name)
    return datetime(*map(int, match.groups()), tzinfo=UTC) if match else None


def run(args: ScriptArgs) -> bool:
    """Derives the missing receipts, and uploads them with --upload"""
    step = "listing the public bucket"
    try:
        names = [blob.name for blob in gcs_utils.list_all(buckets.PUBLIC)]
        replicas = sorted(filter(None, map(_replica_time, names)))
        published = [
            started_at
            for started_at in map(receipt.parse_receipt_name, names)
            if started_at is not None
        ]
        if not replicas:
            logger.error("The public bucket holds no replica to start from")
            return False

        step = "reading processor logs"
        logged, notes = read_logs(args.logs_dirs)

        step = "reading releases, deploys, and image tags"
        sources = fetch_sources()

        step = "deriving receipts"
        moves = latest_moves(
            sources["processor_releases"],
            sources["otr_releases"],
            sources["tag_commits"],
            sources["deploy_runs"],
            sources["tags"],
        )
        schedule = scheduled_runs(replicas[0], datetime.now(UTC))
        derived, derive_notes = derive(
            schedule, logged, moves, sources["tags"], published
        )
        notes += derive_notes

        out_dir = config.dump_dir / "receipts-backfill"
        paths = []
        for doc in derived:
            paths.append(receipt.write(doc, out_dir))
            logger.info(
                f"{paths[-1].name}: release {doc['processor']['release'] or 'unknown'}"
                + (
                    f", inferred {', '.join(doc['inferred'])}"
                    if doc["inferred"]
                    else ""
                )
            )
        for note in notes:
            logger.warning(note)
        logger.info(
            f"Derived {len(paths)} receipts into {out_dir} from {len(logged)} logged "
            f"runs; {len(published)} receipts were already published"
        )

        if not args.receipts_upload:
            logger.info("Review them, then run again with --upload to publish them")
            return True

        for path in paths:
            step = f"uploading {path.name}"
            gcs_utils.upload(path, buckets.PUBLIC)
        step = "refreshing the public index"
        generate_index()
    except Exception:
        logger.exception(f"Back-populating receipts failed while {step}")
        return False

    logger.info(f"Published {len(paths)} receipts")
    return True
