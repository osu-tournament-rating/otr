"""Output files: naming, atomic writes, metadata."""

import hashlib
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from otr_replay import __version__
from otr_replay.models import ReplayError, Report


def output_paths(requested: datetime, directory: Path) -> tuple[Path, Path]:
    """Name outputs after the requested timestamp; the metadata carries the rest."""
    stem = f"otr-replay_{requested:%Y%m%dT%H%M%SZ}"
    return directory / f"{stem}.csv", directory / f"{stem}.metadata.json"


def claim(*paths: Path) -> None:
    """Reserve output paths up front, refusing to overwrite existing files."""
    claimed: list[Path] = []
    for path in paths:
        try:
            path.touch(exist_ok=False)
        except FileExistsError:
            for done in claimed:
                done.unlink(missing_ok=True)
            raise ReplayError(
                "output",
                f"{path} already exists",
                "Move or rename the existing file and rerun.",
            ) from None
        claimed.append(path)


def write_atomic(path: Path, data: str) -> None:
    handle, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(handle, "w") as file:
            file.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def source_commit() -> str | None:
    """The git commit this copy of otr-replay runs from, if it is a checkout."""
    package_dir = Path(__file__).resolve().parent
    try:
        head = subprocess.run(
            ["git", "-C", str(package_dir), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )  # fmt: skip
        if head.returncode != 0:
            return None
        # The checkout is all of otr, so only changes under apps/replay
        # make this copy dirty.
        status = subprocess.run(
            ["git", "-C", str(package_dir.parents[1]), "status", "--porcelain", "--", "."],
            capture_output=True, text=True, timeout=10,
        )  # fmt: skip
    except OSError:
        return None
    dirty = "-dirty" if status.returncode == 0 and status.stdout.strip() else ""
    return head.stdout.strip() + dirty


def build_metadata(report: Report) -> dict:
    return {
        "application": "otr-replay",
        "application_version": __version__,
        "application_commit": report.source_commit,
        "requested_at": _utc(report.requested_at),
        "replica": {
            "filename": report.replica.ref.name,
            "url": report.replica.ref.url,
            "timestamp": _utc(report.replica.ref.timestamp),
            "sha256": report.replica.sha256,
        },
        "rating_run": _rating_run(report),
        "processor": {
            "release": report.release.tag,
            "github_published_at": _utc(report.release.published_at),
            "image_pushed_at": _utc(report.release.pushed_at),
            "image": report.release.image,
            "github_repository": report.release.repository,
            "github_release_url": report.release.html_url,
        },
        "sandbox": {"postgres_image": report.postgres_image},
        "reconciliation": {
            "horizon": _utc(report.horizon or report.replica.ref.timestamp),
            "ratings_restored": report.reconciliation.ratings_restored,
            "adjustments_reconciled": report.reconciliation.adjustments_reconciled,
        },
        "output": {
            "csv": report.csv_path.name,
            "csv_sha256": report.csv_sha256,
            "rows": report.row_count,
        },
        "execution": {
            "started_at": _utc(report.started_at),
            "ended_at": _utc(report.finished_at),
        },
        "warnings": list(report.warnings),
    }


def _rating_run(report: Report) -> dict | None:
    """The rating run replayed, from its receipt; None if no receipt covered it."""
    receipt = report.receipt
    if receipt is None:
        return None
    return {
        "receipt": receipt.ref.name,
        "receipt_url": receipt.ref.url,
        "run_id": receipt.run_id,
        "started_at": _utc(receipt.started_at),
        "decay_horizon": _utc(receipt.decay_horizon),
        "published_at": _utc(receipt.committed_at),
        "ratings": receipt.ratings,
        "inferred": dict(receipt.inferred),
    }


def _utc(value: datetime | None) -> str | None:
    return None if value is None else f"{value:%Y-%m-%dT%H:%M:%SZ}"
