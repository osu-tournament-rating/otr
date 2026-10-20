import json
import tomllib
from datetime import UTC, datetime
from pathlib import Path

import pytest

from otr_replay import __version__
from otr_replay.models import (
    Receipt,
    ReceiptRef,
    Reconciliation,
    Release,
    ReplayError,
    Replica,
    ReplicaRef,
    Report,
)
from otr_replay.output import build_metadata, claim, output_paths, write_atomic


def test_output_paths_name_the_requested_timestamp(tmp_path):
    csv, metadata = output_paths(
        requested=datetime(2026, 7, 28, 12, 0, tzinfo=UTC),
        directory=tmp_path,
    )
    assert csv.name == "otr-replay_20260728T120000Z.csv"
    assert metadata.name == "otr-replay_20260728T120000Z.metadata.json"


def test_claim_refuses_existing_files(tmp_path):
    target = tmp_path / "out.csv"
    target.touch()
    with pytest.raises(ReplayError) as exc:
        claim(target)
    assert exc.value.phase == "output"


def _report(tmp_path, **release_source):
    ref = ReplicaRef(
        name="otr-public-replica_2026-07-28T11:45:01Z.gz",
        url="https://storage.googleapis.com/otr-public-replica/otr-public-replica_2026-07-28T11%3A45%3A01Z.gz",
        timestamp=datetime(2026, 7, 28, 11, 45, 1, tzinfo=UTC),
    )
    return Report(
        requested_at=datetime(2026, 8, 1, tzinfo=UTC),
        replica=Replica(ref=ref, path=Path("/tmp/x.gz"), sha256="ab" * 32),
        release=Release(
            tag="2026.05.18",
            published_at=datetime(2026, 5, 18, 19, 56, 7, tzinfo=UTC),
            pushed_at=datetime(2026, 5, 18, 19, 59, 11, tzinfo=UTC),
            digest="sha256:" + "cd" * 32,
            **release_source,
        ),
        reconciliation=Reconciliation(ratings_restored=10, adjustments_reconciled=20),
        row_count=1234,
        started_at=datetime(2026, 8, 6, 1, 0, tzinfo=UTC),
        finished_at=datetime(2026, 8, 6, 1, 30, tzinfo=UTC),
        csv_path=tmp_path / "out.csv",
        metadata_path=tmp_path / "out.metadata.json",
        csv_sha256="ef" * 32,
        postgres_image="postgres@sha256:" + "12" * 32,
        source_commit="ab" * 20,
    )


def test_metadata_has_no_credentials(tmp_path):
    report = _report(tmp_path)
    rendered = json.dumps(build_metadata(report))
    assert "password" not in rendered
    assert "adjustments_reconciled" in rendered
    assert build_metadata(report)["output"]["csv_sha256"] == "ef" * 32


def test_metadata_adds_the_release_source_after_the_existing_processor_keys(tmp_path):
    report = _report(
        tmp_path,
        repository="osu-tournament-rating/otr-processor",
        html_url="https://github.com/osu-tournament-rating/otr-processor/releases/tag/2026.05.18",
    )
    # Earlier metadata files have the first four keys, unchanged in name and format.
    assert build_metadata(report)["processor"] == {
        "release": "2026.05.18",
        "github_published_at": "2026-05-18T19:56:07Z",
        "image_pushed_at": "2026-05-18T19:59:11Z",
        "image": "stagecodes/otr-processor@sha256:" + "cd" * 32,
        "github_repository": "osu-tournament-rating/otr-processor",
        "github_release_url": (
            "https://github.com/osu-tournament-rating/otr-processor/releases/tag/2026.05.18"
        ),
    }
    assert list(build_metadata(report)["processor"])[:4] == [
        "release",
        "github_published_at",
        "image_pushed_at",
        "image",
    ]


def test_version_matches_the_project_version(tmp_path):
    pyproject = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    assert __version__ == pyproject["project"]["version"]
    assert build_metadata(_report(tmp_path))["application_version"] == __version__


def test_write_atomic_replaces_claimed_file(tmp_path):
    target = tmp_path / "file.json"
    claim(target)
    write_atomic(target, "{}")
    assert target.read_text() == "{}"
    assert list(tmp_path.iterdir()) == [target]


def test_metadata_records_the_rating_run_its_receipt_names(tmp_path):
    name = "otr-rating-receipt_2026-07-28T12:00:03Z.json"
    receipt = Receipt(
        ref=ReceiptRef(
            name=name,
            url=f"https://storage.googleapis.com/otr-public-replica/{name}",
            started_at=datetime(2026, 7, 28, 12, 0, 3, tzinfo=UTC),
        ),
        run_id="00000000-0000-4000-8000-000000000003",
        started_at=datetime(2026, 7, 28, 12, 0, 3, 250000, tzinfo=UTC),
        decay_horizon=datetime(2026, 7, 28, 12, 1, 30, tzinfo=UTC),
        committed_at=datetime(2026, 7, 28, 12, 3, 10, tzinfo=UTC),
        release="2026.05.18",
        image="stagecodes/otr-processor@sha256:" + "cd" * 32,
        ratings=1234,
        inferred={},
    )
    report = _report(tmp_path)
    report = Report(
        **{
            **{field: getattr(report, field) for field in report.__slots__},
            # A receipt names the image, not its publication times.
            "release": Release(
                tag="2026.05.18",
                published_at=None,
                pushed_at=None,
                digest="sha256:" + "cd" * 32,
            ),
            "receipt": receipt,
            "horizon": receipt.decay_horizon,
            "warnings": ("a warning",),
        }
    )

    metadata = build_metadata(report)

    assert metadata["rating_run"] == {
        "receipt": name,
        "receipt_url": f"https://storage.googleapis.com/otr-public-replica/{name}",
        "run_id": "00000000-0000-4000-8000-000000000003",
        "started_at": "2026-07-28T12:00:03Z",
        "decay_horizon": "2026-07-28T12:01:30Z",
        "published_at": "2026-07-28T12:03:10Z",
        "ratings": 1234,
        "inferred": {},
    }
    assert metadata["processor"]["release"] == "2026.05.18"
    assert metadata["processor"]["github_published_at"] is None
    assert metadata["processor"]["image"] == "stagecodes/otr-processor@sha256:" + "cd" * 32
    # Decay is reconciled to the run's horizon, not to the replica's timestamp.
    assert metadata["reconciliation"]["horizon"] == "2026-07-28T12:01:30Z"
    assert metadata["warnings"] == ["a warning"]
