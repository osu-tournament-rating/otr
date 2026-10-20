"""Data passed between pipeline stages."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


class ReplayError(Exception):
    """A failure in a named pipeline phase, with an optional remediation hint."""

    def __init__(self, phase: str, message: str, hint: str = "") -> None:
        super().__init__(message)
        self.phase = phase
        self.message = message
        self.hint = hint


@dataclass(frozen=True, slots=True)
class ReplicaRef:
    name: str
    url: str
    timestamp: datetime


@dataclass(frozen=True, slots=True)
class Replica:
    ref: ReplicaRef
    path: Path
    sha256: str


@dataclass(frozen=True, slots=True)
class ReceiptRef:
    """A rating run receipt listed on the public replicas site."""

    name: str
    url: str
    # When the run started, from the receipt's name.
    started_at: datetime


@dataclass(frozen=True, slots=True)
class Receipt:
    """What one rating run did, as its receipt records it."""

    ref: ReceiptRef
    run_id: str | None
    started_at: datetime
    # The time the run's final decay pass ran to, when the run recorded it.
    decay_horizon: datetime | None
    # When the run's ratings were published; None in a back-populated receipt.
    committed_at: datetime | None
    release: str | None
    # The image the run ran, as stagecodes/otr-processor@sha256:…, if known.
    image: str | None
    # How many player ratings the run published, when recorded.
    ratings: int | None
    # Each field that was inferred rather than observed, with its evidence.
    inferred: Mapping[str, str] = field(default_factory=dict)

    @property
    def published_at(self) -> datetime:
        """When the run's ratings replaced the previous run's on the site."""
        return self.committed_at or self.started_at

    @property
    def horizon(self) -> datetime:
        """Decay adjustments after this did not exist when the run published."""
        return self.decay_horizon or self.started_at


@dataclass(frozen=True, slots=True)
class Release:
    # None when a receipt names the image of no known release.
    tag: str | None
    # None when the release comes from a receipt rather than from GitHub and
    # Docker Hub publication times.
    published_at: datetime | None
    pushed_at: datetime | None
    digest: str
    # The GitHub repository and release page the release was discovered from.
    repository: str | None = None
    html_url: str | None = None

    @property
    def usable_at(self) -> datetime:
        return max(self.published_at, self.pushed_at)

    @property
    def image(self) -> str:
        return f"stagecodes/otr-processor@{self.digest}"

    @property
    def label(self) -> str:
        return self.tag or self.digest[:19]


@dataclass(frozen=True, slots=True)
class Plan:
    """The inputs a replay of one requested instant uses."""

    replica: ReplicaRef
    release: Release
    # The receipt of the rating run being replayed, when one covers the instant.
    receipt: Receipt | None
    # Decay after this is removed from the replayed ratings.
    horizon: datetime
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Reconciliation:
    ratings_restored: int
    adjustments_reconciled: int


@dataclass(frozen=True, slots=True)
class Report:
    requested_at: datetime
    replica: Replica
    release: Release
    reconciliation: Reconciliation
    row_count: int
    started_at: datetime
    finished_at: datetime
    csv_path: Path
    metadata_path: Path
    csv_sha256: str
    postgres_image: str
    source_commit: str | None
    receipt: Receipt | None = None
    # The reconciliation horizon; the replica's timestamp when None.
    horizon: datetime | None = None
    warnings: tuple[str, ...] = ()
