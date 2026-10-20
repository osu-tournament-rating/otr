import json
import logging
import re

import pytest

from lib import processor, receipt
from lib.config import config

DIGEST = "sha256:" + "ab" * 32
COMMIT = "cd" * 20
PULL = (
    "latest: Pulling from stagecodes/otr-processor\n"
    f"Digest: {DIGEST}\n"
    "Status: Image is up to date for stagecodes/otr-processor:test\n"
)
RUN_HALF = {
    "run_id": "7d4c2f9e-0000-4000-8000-000000000001",
    "started_at": "2026-10-20T12:00:04.000000Z",
    "decay_horizon": "2026-10-20T12:01:30.000000Z",
    "committed_at": "2026-10-20T12:03:10.000250Z",
    "counts": {
        "matches": 11,
        "players": 22,
        "tournaments": 3,
        "ratings": 40,
        "stats_jobs": 2,
    },
}
RECEIPT_LINE = "OTR_RECEIPT=" + json.dumps(RUN_HALF)
TAGS = [
    {"name": "latest", "digest": DIGEST},
    {"name": "2026.10.18.25", "digest": DIGEST},
    {"name": f"sha-{COMMIT}", "digest": DIGEST},
    {"name": "2026.10.18.24", "digest": "sha256:" + "ef" * 32},
]


class FakeProcess:
    def __init__(self, output: str, returncode: int):
        self.stdout = iter(output.splitlines(keepends=True))
        self.returncode = returncode

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def published(monkeypatch, tmp_path):
    """Runs in production with a fake Docker Hub and bucket; returns uploads"""
    uploads: list[dict] = []
    monkeypatch.setattr(config, "environment", "production")
    monkeypatch.setattr(config, "dump_dir", tmp_path)
    monkeypatch.setattr(receipt, "fetch_docker_tags", lambda: TAGS)
    monkeypatch.setattr(
        receipt.gcs_utils,
        "upload",
        lambda path, bucket: uploads.append(
            {"name": path.name, "bucket": bucket, "body": json.loads(path.read_text())}
        ),
    )
    monkeypatch.setattr(receipt, "generate_index", lambda: True)
    return uploads


def fake_runs(monkeypatch, run_output: str, run_code: int = 0, pull_output=PULL):
    def popen(cmd, **kwargs):
        if cmd[1] == "pull":
            return FakeProcess(pull_output, 0)
        return FakeProcess(run_output, run_code)

    monkeypatch.setattr(processor.subprocess, "Popen", popen)


def test_run_publishes_the_receipt_with_the_image_it_pulled(monkeypatch, published):
    fake_runs(monkeypatch, f"INFO COMMIT TRANSACTION\n{RECEIPT_LINE}\nINFO done\n")

    assert processor.run() is True

    assert published == [
        {
            "name": "otr-rating-receipt_2026-10-20T12:00:04Z.json",
            "bucket": "public",
            "body": {
                "receipt_version": 1,
                "environment": "production",
                **RUN_HALF,
                "processor": {
                    "release": "2026.10.18.25",
                    "commit": COMMIT,
                    "image": f"stagecodes/otr-processor@{DIGEST}",
                    "requested": "stagecodes/otr-processor:test",
                },
                "inferred": {},
            },
        }
    ]


def test_receipt_names_the_image_only_when_docker_hub_fails(
    monkeypatch, published, caplog
):
    def offline():
        raise OSError("hub.docker.com is unreachable")

    monkeypatch.setattr(receipt, "fetch_docker_tags", offline)
    fake_runs(monkeypatch, f"{RECEIPT_LINE}\n")

    with caplog.at_level(logging.ERROR):
        assert processor.run() is True

    (upload,) = published
    assert upload["body"]["processor"] == {
        "release": None,
        "commit": None,
        "image": f"stagecodes/otr-processor@{DIGEST}",
        "requested": "stagecodes/otr-processor:test",
    }
    assert any("Docker Hub" in record.getMessage() for record in caplog.records)


def failing_upload(path, bucket):
    raise OSError("the bucket refused the upload")


@pytest.mark.parametrize(
    ("run_output", "upload"),
    [
        # The upload fails.
        (f"{RECEIPT_LINE}\n", failing_upload),
        # The receipt line is not JSON.
        ("OTR_RECEIPT={not json\n", None),
        # An image older than receipts prints none.
        ("INFO COMMIT TRANSACTION\n", None),
        # Two receipts cannot both describe the run.
        (f"{RECEIPT_LINE}\n{RECEIPT_LINE}\n", None),
    ],
    ids=["upload fails", "malformed line", "no receipt", "two receipts"],
)
def test_a_receipt_failure_never_fails_the_committed_run(
    monkeypatch, published, caplog, run_output, upload
):
    if upload is not None:
        monkeypatch.setattr(receipt.gcs_utils, "upload", upload)
    fake_runs(monkeypatch, run_output)

    with caplog.at_level(logging.ERROR):
        assert processor.run() is True

    assert published == []
    assert [r for r in caplog.records if r.levelno >= logging.ERROR], "nothing logged"


def test_failed_run_publishes_no_receipt(monkeypatch, published):
    fake_runs(monkeypatch, f"{RECEIPT_LINE}\n", run_code=1)

    assert processor.run() is False

    assert published == []


def test_receipt_stays_local_outside_production(monkeypatch, published, tmp_path):
    monkeypatch.setattr(config, "environment", "dev")
    fake_runs(monkeypatch, f"{RECEIPT_LINE}\n")

    assert processor.run() is True

    assert published == []
    written = json.loads(
        (
            tmp_path / "receipts" / "otr-rating-receipt_2026-10-20T12:00:04Z.json"
        ).read_text()
    )
    assert written["environment"] == "dev"
    assert written["run_id"] == RUN_HALF["run_id"]


@pytest.fixture
def metrics_dir(monkeypatch, tmp_path):
    path = tmp_path / "textfile"
    path.mkdir()
    monkeypatch.setattr(config, "metrics_dir", path)
    return path


def receipt_published(metrics_dir) -> str | None:
    """What the run recorded for the missing receipt alert, if anything"""
    path = metrics_dir / "otr_rating_receipt.prom"
    if not path.exists():
        return None
    match = re.search(
        r"^otr_rating_receipt_published (\d+)$", path.read_text(), re.MULTILINE
    )
    return match.group(1) if match else path.read_text()


def test_a_published_receipt_records_it_for_the_alert(
    monkeypatch, published, metrics_dir
):
    fake_runs(monkeypatch, f"{RECEIPT_LINE}\n")

    assert processor.run() is True

    assert receipt_published(metrics_dir) == "1"


@pytest.mark.parametrize(
    ("run_output", "upload", "pull_output"),
    [
        (f"{RECEIPT_LINE}\n", failing_upload, PULL),
        ("OTR_RECEIPT={not json\n", None, PULL),
        ("INFO COMMIT TRANSACTION\n", None, PULL),
        (f"{RECEIPT_LINE}\n{RECEIPT_LINE}\n", None, PULL),
        # The receipt is published, but a replay would have to guess its image.
        (f"{RECEIPT_LINE}\n", None, "Status: Downloaded newer image\n"),
    ],
    ids=["upload fails", "malformed line", "no receipt", "two receipts", "no image"],
)
def test_a_committed_run_without_a_complete_receipt_raises_the_alert(
    monkeypatch, published, metrics_dir, run_output, upload, pull_output
):
    if upload is not None:
        monkeypatch.setattr(receipt.gcs_utils, "upload", upload)
    fake_runs(monkeypatch, run_output, pull_output=pull_output)

    assert processor.run() is True

    assert receipt_published(metrics_dir) == "0"


@pytest.mark.parametrize(
    ("environment", "run_code"),
    [("dev", 0), ("production", 1)],
    ids=["outside production", "failed run"],
)
def test_a_run_that_owes_no_receipt_records_nothing(
    monkeypatch, published, metrics_dir, environment, run_code
):
    monkeypatch.setattr(config, "environment", environment)
    fake_runs(monkeypatch, f"{RECEIPT_LINE}\n", run_code=run_code)

    processor.run()

    assert receipt_published(metrics_dir) is None
