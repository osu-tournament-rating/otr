"""Rating run receipts, and the replay plan they decide.

Each weekly rating run publishes a receipt beside the public replicas,
recording when it ran and which processor image it ran (apps/scripts,
lib/receipt.py). The ratings the site showed at an instant are the ones the
last run before it published, so a replay of that instant replays that run:
its processor, the newest replica from before it started, and its decay
horizon. Only an instant no receipt covers falls back to choosing the replica
and release by publication time.
"""

import re
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import httpx

from otr_replay.discovery import (
    _get,
    _parse_utc,
    fetch_index,
    fetch_releases,
    fetch_tags,
    index_links,
    select_release,
    select_replica,
)
from otr_replay.models import Plan, Receipt, ReceiptRef, Release, ReplayError

# The receipt layout this otr-replay reads.
RECEIPT_VERSION = 1
# Runs are weekly; past this, a newer run should have published a receipt.
RUN_INTERVAL = timedelta(days=7, hours=2)
# A replica taken this soon before its run holds the data the run read. The
# weekly maintenance window opens 15 minutes before the run, takes the
# replica, and holds admin writes until 15 minutes after the run starts.
REPLICA_GAP = timedelta(minutes=30)

_RECEIPT_NAME = re.compile(
    r"^otr-rating-receipt_(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z\.json$"
)
_IMAGE = re.compile(r"^stagecodes/otr-processor@(sha256:[0-9a-f]{64})$")


def parse_receipt_index(html: str) -> list[ReceiptRef]:
    refs = []
    for name, href in index_links(html):
        match = _RECEIPT_NAME.match(name)
        if match is None:
            continue
        try:
            started_at = datetime(*map(int, match.groups()), tzinfo=UTC)
        except ValueError:
            continue
        refs.append(ReceiptRef(name=name, url=href, started_at=started_at))
    return sorted(refs, key=lambda ref: ref.started_at, reverse=True)


def fetch_receipt(client: httpx.Client, ref: ReceiptRef) -> Receipt:
    try:
        document = _get(client, ref.url).json()
    except ValueError:
        raise _invalid(ref, "it is not JSON") from None
    if not isinstance(document, dict):
        raise _invalid(ref, "it is not a JSON object")
    version = document.get("receipt_version")
    if version != RECEIPT_VERSION:
        raise ReplayError(
            "discovery",
            f"{ref.name} is a version {version} receipt, which this otr-replay cannot read",
            "Pull the latest otr and rerun.",
        )

    processor = document.get("processor") or {}
    counts = document.get("counts") or {}
    image = processor.get("image")
    try:
        if image is not None and not _IMAGE.match(image):
            raise ValueError(f"names the image {image!r}")
        ratings = counts.get("ratings")
        if ratings is not None and not isinstance(ratings, int):
            raise ValueError(f"counts {ratings!r} ratings")
        return Receipt(
            ref=ref,
            run_id=document.get("run_id"),
            started_at=_parse_utc(document["started_at"]),
            decay_horizon=_optional_utc(document.get("decay_horizon")),
            committed_at=_optional_utc(document.get("committed_at")),
            release=processor.get("release"),
            image=image,
            ratings=ratings,
            inferred=dict(document.get("inferred") or {}),
        )
    except (KeyError, TypeError, ValueError) as err:
        raise _invalid(ref, str(err)) from None


def select_receipt(
    client: httpx.Client, refs: Sequence[ReceiptRef], cutoff: datetime
) -> Receipt | None:
    """The receipt of the last run that published ratings at or before `cutoff`."""
    for ref in sorted(refs, key=lambda ref: ref.started_at, reverse=True):
        if ref.started_at > cutoff:
            continue
        receipt = fetch_receipt(client, ref)
        # A run that started before the cutoff may have published after it.
        if receipt.published_at <= cutoff:
            return receipt
    return None


def resolve(client: httpx.Client, requested: datetime) -> Plan:
    """What a replay of `requested` runs, and why it may differ from the site."""
    replicas, html = fetch_index(client)
    receipt = select_receipt(client, parse_receipt_index(html), requested)

    if receipt is None:
        replica = select_replica(replicas, requested)
        # The replica, not the requested instant, bounds the release: ratings in a
        # replica were produced by whichever release was live when it was taken.
        release = select_release(fetch_releases(client), fetch_tags(client), replica.timestamp)
        warning = (
            f"No rating run receipt covers {_show(requested)}, so the replica and "
            "processor release were chosen by when they were published. They can "
            "differ from what the rating run that published those ratings used."
        )
        return Plan(replica, release, None, replica.timestamp, (warning,))

    run = f"rating run {_show(receipt.started_at)}"
    warnings = []
    if requested - receipt.published_at > RUN_INTERVAL:
        warnings.append(
            f"The newest rating run receipt before {_show(requested)} is from {run}, "
            f"{_span(requested - receipt.published_at)} earlier. A later run may have "
            "published ratings without a receipt."
        )
    if receipt.inferred:
        warnings.append(
            f"The receipt of {run} was back-populated. These fields were inferred "
            f"rather than recorded: {', '.join(receipt.inferred)}. Its inferred field "
            "gives the evidence for each."
        )

    # The run read the live database, so the newest replica from before it
    # started is the closest public copy of its data.
    replica = select_replica(replicas, receipt.started_at)
    gap = receipt.started_at - replica.timestamp
    if gap > REPLICA_GAP:
        warnings.append(
            f"The newest replica before {run} was taken {_span(gap)} before it "
            "started, so changes made in between are missing and the ratings may "
            "differ from the ones the run published."
        )

    if receipt.image is None:
        warnings.append(
            f"The receipt of {run} names no processor image, so the release was "
            "chosen by when it was published."
        )
        release = select_release(fetch_releases(client), fetch_tags(client), receipt.started_at)
    else:
        release = Release(
            tag=receipt.release,
            published_at=None,
            pushed_at=None,
            digest=_IMAGE.match(receipt.image).group(1),
        )
    return Plan(replica, release, receipt, receipt.horizon, tuple(warnings))


def ratings_warning(receipt: Receipt | None, row_count: int) -> str | None:
    """A warning when the replay's ratings outnumber or fall short of the run's."""
    if receipt is None or receipt.ratings is None or receipt.ratings == row_count:
        return None
    return (
        f"The replay produced {row_count:,} ratings, but rating run "
        f"{_show(receipt.started_at)} published {receipt.ratings:,}, so the replica "
        "does not hold exactly the data that run read."
    )


def _optional_utc(value: str | None) -> datetime | None:
    return None if value is None else _parse_utc(value)


def _invalid(ref: ReceiptRef, detail: str) -> ReplayError:
    return ReplayError(
        "discovery",
        f"{ref.name} is not a valid receipt: {detail}",
        "Report this to the o!TR team.",
    )


def _show(value: datetime) -> str:
    return f"{value.astimezone(UTC):%Y-%m-%dT%H:%M:%SZ}"


def _span(delta: timedelta) -> str:
    if delta >= timedelta(days=2):
        return f"{delta.days} days"
    if delta >= timedelta(hours=2):
        return f"{delta // timedelta(hours=1)} hours"
    return f"{delta // timedelta(minutes=1)} minutes"
