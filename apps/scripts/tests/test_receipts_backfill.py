import itertools
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from lib.cli import ScriptArgs
from lib.scripts import receipts_backfill as backfill
from lib.scripts.receipts_backfill import (
    derive,
    latest_moves,
    parse_log,
    read_logs,
    scheduled_runs,
)


def digest(n: int) -> str:
    return f"sha256:{n:064x}"


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


# Docker Hub. Tags go inactive after a month without a push or pull, and an
# inactive image still pulls, so status never matters.
TAGS = [
    {"name": "latest", "digest": digest(4), "tag_last_pushed": "2026-10-09T02:15:00Z"},
    {
        "name": "2026.08.03",
        "digest": digest(1),
        "tag_last_pushed": "2026-08-03T23:08:19Z",
    },
    {
        "name": "2026.08.04",
        "digest": digest(2),
        "tag_last_pushed": "2026-08-04T23:45:33Z",
        "tag_status": "inactive",
    },
    {
        "name": "2026.08.16",
        "digest": digest(3),
        "tag_last_pushed": "2026-08-16T17:53:28Z",
    },
    {
        "name": "2026.10.09",
        "digest": digest(4),
        "tag_last_pushed": "2026-10-09T02:08:21Z",
    },
    {
        "name": "sha-" + "c4" * 20,
        "digest": digest(4),
        "tag_last_pushed": "2026-10-09T02:07:14Z",
    },
    {
        "name": "2026.10.12.12",
        "digest": digest(5),
        "tag_last_pushed": "2026-10-12T15:44:30Z",
    },
    {
        "name": "staging-latest",
        "digest": digest(9),
        "tag_last_pushed": "2026-09-05T04:28:11Z",
    },
]
PROCESSOR_RELEASES = [
    {"tag_name": "2026.08.16", "draft": False},
    {"tag_name": "2026.08.04", "draft": False},
    {"tag_name": "2026.08.03", "draft": False},
    {"tag_name": "v1.0.0", "draft": False},
]
OTR_RELEASES = [
    # Released before the processor moved into otr: no processor line.
    {"tag_name": "2026.08.16", "draft": False, "body": "## Changelog\n\n- None"},
    {
        "tag_name": "2026.10.09",
        "draft": False,
        "body": "Processor image: stagecodes/otr-processor:2026.10.09\n",
    },
    {
        "tag_name": "2026.10.10",
        "draft": False,
        "body": "Processor image: stagecodes/otr-processor:2026.10.09 "
        "(unchanged since that release)\n",
    },
    {
        "tag_name": "2026.10.12.12",
        "draft": False,
        "body": "Processor image: stagecodes/otr-processor:2026.10.12.12\n",
    },
]
TAG_COMMITS = {
    "2026.08.16": "a1" * 20,
    "2026.10.09": "c4" * 20,
    "2026.10.10": "c5" * 20,
    "2026.10.12.12": "c6" * 20,
}
DEPLOY_RUNS = [
    {
        "id": 4,
        "event": "workflow_dispatch",
        "conclusion": "success",
        "head_sha": "c6" * 20,
        "updated_at": "2026-10-14T20:00:00Z",
    },
    # The release was published and its image tagged, but the deploy failed
    # before it moved latest.
    {
        "id": 3,
        "event": "push",
        "conclusion": "failure",
        "head_sha": "c6" * 20,
        "updated_at": "2026-10-12T15:50:00Z",
    },
    {
        "id": 2,
        "event": "push",
        "conclusion": "success",
        "head_sha": "c5" * 20,
        "updated_at": "2026-10-10T10:00:00Z",
    },
    {
        "id": 1,
        "event": "push",
        "conclusion": "success",
        "head_sha": "c4" * 20,
        "updated_at": "2026-10-09T02:15:00Z",
    },
]


@pytest.fixture
def moves():
    return latest_moves(
        PROCESSOR_RELEASES, OTR_RELEASES, TAG_COMMITS, DEPLOY_RUNS, TAGS
    )


def by_start(receipts):
    return {doc["started_at"][:16]: doc for doc in receipts}


@pytest.mark.parametrize(
    ("first_replica", "first_run"),
    [
        # The first public replica, a Monday evening.
        ("2025-10-06T21:13:57", "2025-10-07T12:00"),
        # A replica taken in a run's maintenance window precedes that run.
        ("2026-06-09T11:45:01", "2026-06-09T12:00"),
        # A run that started as its replica was taken is not after it.
        ("2026-06-09T12:00:00", "2026-06-16T12:00"),
    ],
)
def test_scheduled_runs_start_after_the_first_replica(first_replica, first_run):
    runs = scheduled_runs(at(first_replica), at("2026-07-01T00:00:00"))

    assert runs[0] == at(f"{first_run}:00")
    assert len(runs) > 2
    assert all(
        later - earlier == timedelta(days=7)
        for earlier, later in itertools.pairwise(runs)
    )


def test_scheduled_runs_stop_before_now():
    runs = scheduled_runs(at("2026-10-01T00:00:00"), at("2026-10-20T12:00:00"))

    assert runs == [at("2026-10-06T12:00:00"), at("2026-10-13T12:00:00")]


def test_each_run_gets_the_image_latest_named_when_it_started(moves):
    schedule = [
        at("2026-08-04T12:00:00"),
        at("2026-08-11T12:00:00"),
        at("2026-08-18T12:00:00"),
        at("2026-10-13T12:00:00"),
    ]

    receipts, _ = derive(schedule, [], moves, TAGS, [])

    releases = {
        start: (doc["processor"]["release"], doc["processor"]["image"])
        for start, doc in by_start(receipts).items()
    }
    image = "stagecodes/otr-processor@{}".format
    assert releases == {
        # 2026.08.04 was pushed at 23:45 that day, after the run.
        "2026-08-04T12:00": ("2026.08.03", image(digest(1))),
        # Docker Hub calls 2026.08.04 inactive; it still pulls.
        "2026-08-11T12:00": ("2026.08.04", image(digest(2))),
        "2026-08-18T12:00": ("2026.08.16", image(digest(3))),
        # 2026.10.12.12 was released and tagged, but its deploy failed, and
        # 2026.10.10 kept the image 2026.10.09 built.
        "2026-10-13T12:00": ("2026.10.09", image(digest(4))),
    }
    doc = by_start(receipts)["2026-10-13T12:00"]
    assert doc["processor"]["commit"] == "c4" * 20
    assert doc["processor"]["requested"] == "stagecodes/otr-processor:latest"
    assert doc["started_at"] == "2026-10-13T12:00:00.000000Z"
    assert doc["run_id"] is doc["committed_at"] is doc["counts"] is None
    assert set(doc["inferred"]) == {"started_at", "processor"}
    assert "release 2026.10.10" in doc["inferred"]["processor"]


def test_a_redeploy_by_hand_leaves_the_image_unknown(moves):
    receipts, notes = derive([at("2026-10-20T12:00:00")], [], moves, TAGS, [])

    (doc,) = receipts
    assert doc["processor"]["image"] is None
    assert doc["processor"]["release"] is None
    assert "redeployed a release by hand" in doc["inferred"]["processor"]
    assert any("2026-10-20T12:00:00Z is unknown" in note for note in notes)


def scripts_log(*processor_lines: str, pulled: int = 4, tag: str = "latest") -> str:
    """A scripts log of a processor run, its lines as the scripts log them"""
    prefix = "2026-10-13 08:00:01,234 [INFO]: "
    lines = [
        "Running 'processor', logging to logs/processor_20261013_120001.log",
        f"Pulling ['docker', 'pull', 'stagecodes/otr-processor:{tag}']",
        f"{tag}: Pulling from stagecodes/otr-processor",
        f"Digest: {digest(pulled)}",
        f"Status: Image is up to date for stagecodes/otr-processor:{tag}",
        "Running processor",
        *processor_lines,
    ]
    return "".join(prefix + line + "\n" for line in lines)


def tracing(time: str, target: str, message: str) -> str:
    """A processor log line as tracing writes it, colors included"""
    return (
        f"\x1b[2m{time}\x1b[0m \x1b[32m INFO\x1b[0m \x1b[2m{target}\x1b[0m"
        f"\x1b[2m:\x1b[0m {message}"
    )


RUN_ID = "26507dd3-f558-43bf-be9c-8d3fd4839cec"
BEGIN = tracing(
    "2026-10-13T12:00:05.484862Z",
    "otr_processor",
    f'Begin processing... \x1b[3mrun_id\x1b[0m\x1b[2m=\x1b[0m"{RUN_ID}"',
)
QUEUED = tracing(
    "2026-10-13T12:01:13.071769Z",
    "otr_processor::database::jobs",
    'Queued tournament stats jobs queued=8 correlation_id="'
    + "0" * 8
    + "-0000-4000-8000-"
    + "0" * 12
    + '"',
)
COMMIT = tracing("2026-10-13T12:01:13.208616Z", "otr_processor", "COMMIT TRANSACTION")
PRINTED = {
    "run_id": RUN_ID,
    "started_at": "2026-10-13T12:00:05.484691Z",
    "decay_horizon": "2026-10-13T12:00:19.153668Z",
    "committed_at": "2026-10-13T12:01:13.208632Z",
    "counts": {
        "matches": 126070,
        "players": 96490,
        "tournaments": 2540,
        "ratings": 36098,
        "stats_jobs": 8,
    },
}


def test_a_logged_receipt_line_replaces_the_schedule_for_its_day(moves):
    log = scripts_log(
        BEGIN,
        COMMIT,
        "OTR_RECEIPT=" + json.dumps(PRINTED),
        tracing("2026-10-13T12:01:13.208651Z", "otr_processor", "Processing complete"),
        "Published otr-rating-receipt_2026-10-13T12:00:05Z.json",
        pulled=5,
    )
    logged = parse_log(log, "processor_20261013_120001.log")

    receipts, _ = derive([at("2026-10-13T12:00:00")], [logged], moves, TAGS, [])

    (doc,) = receipts
    assert {key: doc[key] for key in PRINTED} == PRINTED
    # The pulled image beats the deploy history, which says 2026.10.09.
    assert doc["processor"] == {
        "release": "2026.10.12.12",
        "commit": None,
        "image": f"stagecodes/otr-processor@{digest(5)}",
        "requested": "stagecodes/otr-processor:latest",
    }
    assert doc["inferred"] == {}


def test_an_older_log_gives_the_times_run_id_and_image_it_recorded(moves):
    log = scripts_log(BEGIN, QUEUED, COMMIT, tag="production", pulled=1)

    receipts, _ = derive(
        [at("2026-10-13T12:00:00")], [parse_log(log, "x.log")], moves, TAGS, []
    )

    (doc,) = receipts
    assert doc["run_id"] == RUN_ID
    assert doc["started_at"] == "2026-10-13T12:00:05.484862Z"
    assert doc["committed_at"] == "2026-10-13T12:01:13.208616Z"
    assert doc["decay_horizon"] is None
    assert doc["counts"] is None
    assert doc["processor"]["release"] == "2026.08.03"
    assert doc["processor"]["requested"] == "stagecodes/otr-processor:production"
    assert doc["inferred"] == {}


def test_a_logged_run_without_a_pulled_image_infers_the_image(moves):
    log = scripts_log(BEGIN, COMMIT).replace(f"Digest: {digest(4)}", "")

    receipts, _ = derive([], [parse_log(log, "x.log")], moves, TAGS, [])

    (doc,) = receipts
    assert doc["processor"]["release"] == "2026.10.09"
    assert set(doc["inferred"]) == {"processor"}


def test_a_day_whose_logged_run_never_committed_gets_no_receipt(moves):
    failed = parse_log(scripts_log(BEGIN), "processor_20261013_120001.log")

    receipts, notes = derive([at("2026-10-13T12:00:00")], [failed], moves, TAGS, [])

    assert receipts == []
    assert any("never committed" in note for note in notes)


def test_published_receipts_are_never_derived_again(moves):
    logged = parse_log(scripts_log(BEGIN, COMMIT), "x.log")
    schedule = [at("2026-10-06T12:00:00"), at("2026-10-13T12:00:00")]
    # The run's own receipt, named for its start a moment before the log's.
    published = [at("2026-10-13T12:00:05"), at("2026-10-06T12:00:03")]

    receipts, _ = derive(schedule, [logged], moves, TAGS, published)

    assert receipts == []


def test_a_log_holding_two_runs_is_skipped(tmp_path):
    (tmp_path / "otr-scripts_20261013_120001.log").write_text(
        scripts_log(BEGIN, COMMIT) + scripts_log(BEGIN, COMMIT)
    )
    (tmp_path / "archive_20261013_114501.log").write_text("Uploaded the archive\n")
    (tmp_path / "processor_20261006_120001.log").write_text(scripts_log(BEGIN, COMMIT))

    runs, notes = read_logs([tmp_path])

    assert [run.source for run in runs] == ["processor_20261006_120001.log"]
    assert len(notes) == 1
    assert "more than one processor run" in notes[0]


@pytest.fixture
def bucket(monkeypatch, tmp_path):
    names = [
        "otr-public-replica_2026-09-29T11:45:01Z.gz",
        "otr-public-replica_2026-09-29T11:45:01Z.gz.sha256",
        "otr-rating-receipt_2026-10-13T12:00:04Z.json",
        "terms-of-use.txt",
    ]
    uploads, indexed = [], []
    monkeypatch.setattr(backfill.config, "dump_dir", tmp_path)
    monkeypatch.setattr(
        backfill.gcs_utils,
        "list_all",
        lambda bucket: [SimpleNamespace(name=name) for name in names],
    )
    monkeypatch.setattr(
        backfill.gcs_utils,
        "upload",
        lambda path, bucket: uploads.append((path.name, bucket)),
    )
    monkeypatch.setattr(backfill, "generate_index", lambda: indexed.append(True))
    monkeypatch.setattr(
        backfill,
        "fetch_sources",
        lambda: {
            "processor_releases": PROCESSOR_RELEASES,
            "otr_releases": OTR_RELEASES,
            "tag_commits": TAG_COMMITS,
            "deploy_runs": DEPLOY_RUNS,
            "tags": TAGS,
        },
    )

    class Now(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 19, tzinfo=UTC)

    monkeypatch.setattr(backfill, "datetime", Now)
    return SimpleNamespace(uploads=uploads, indexed=indexed, dir=tmp_path)


def args(upload: bool) -> ScriptArgs:
    return ScriptArgs(
        ["backfill-receipts"], None, None, None, None, False, False, False,
        None, None, None, receipts_upload=upload,
    )  # fmt: skip


def test_backfill_writes_receipts_for_review_without_upload(bucket):
    assert backfill.run(args(upload=False)) is True

    written = sorted(path.name for path in (bucket.dir / "receipts-backfill").iterdir())
    # Runs since the replica, except the 13th, which has its own receipt.
    assert written == [
        "otr-rating-receipt_2026-09-29T12:00:00Z.json",
        "otr-rating-receipt_2026-10-06T12:00:00Z.json",
    ]
    assert bucket.uploads == []
    assert bucket.indexed == []


def test_backfill_publishes_the_receipts_with_upload(bucket):
    assert backfill.run(args(upload=True)) is True

    assert bucket.uploads == [
        ("otr-rating-receipt_2026-09-29T12:00:00Z.json", "public"),
        ("otr-rating-receipt_2026-10-06T12:00:00Z.json", "public"),
    ]
    assert bucket.indexed == [True]


@pytest.fixture
def metrics_dir(monkeypatch, tmp_path):
    path = tmp_path / "textfile"
    path.mkdir()
    monkeypatch.setattr(backfill.config, "metrics_dir", path)
    return path


def test_backfill_upload_clears_the_missing_receipt_alert(bucket, metrics_dir):
    assert backfill.run(args(upload=True)) is True

    recorded = (metrics_dir / "otr_rating_receipt.prom").read_text()
    assert "\notr_rating_receipt_published 1\n" in recorded


def test_backfill_leaves_the_alert_until_it_has_uploaded(
    monkeypatch, bucket, metrics_dir
):
    def failing_upload(path, bucket):
        raise OSError("the bucket refused the upload")

    assert backfill.run(args(upload=False)) is True
    monkeypatch.setattr(backfill.gcs_utils, "upload", failing_upload)
    assert backfill.run(args(upload=True)) is False

    assert list(metrics_dir.iterdir()) == []
