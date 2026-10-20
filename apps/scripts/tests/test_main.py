"""Each failure an operation can hit must reach the command line as a nonzero
exit, with an error in the script's log, because that is all the Tuesday cron
and run-script.yml see of a run."""

import re
import shlex
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.api_core.exceptions import ServiceUnavailable

import main
from lib import metrics, processor, public_html
from lib.gcs import gcs_utils
from lib.scripts import db


@pytest.fixture
def cli(monkeypatch, tmp_path):
    """Runs main with the given arguments, returning its exit code and log"""
    log_dir = tmp_path / "logs"

    def run(*argv: str) -> tuple[int, str]:
        monkeypatch.setattr(sys, "argv", ["main.py", "--log-dir", str(log_dir), *argv])
        code = main.main()
        log = "".join(path.read_text() for path in sorted(log_dir.iterdir()))
        return code, log

    return run


@pytest.fixture
def dirs(monkeypatch, tmp_path):
    dumps, html = tmp_path / "dumps", tmp_path / "html"
    monkeypatch.setattr(db.config, "dump_dir", dumps)
    monkeypatch.setattr(db.config, "public_html_dir", html)
    return SimpleNamespace(dumps=dumps, html=html)


def joined(cmd) -> str:
    return cmd if isinstance(cmd, str) else shlex.join(cmd)


def fake_docker(monkeypatch, fail_on: str | None = None) -> list[str]:
    """Stands in for every docker and bash subprocess. A command containing
    `fail_on` exits 1; an export pipeline writes what pg_dump would leave."""
    commands = []

    def run(cmd, **kwargs):
        text = joined(cmd)
        commands.append(text)
        failed = fail_on is not None and fail_on in text

        if "| gzip >" in text:
            Path(shlex.split(cmd[-1])[-1]).write_bytes(
                b"partial" if failed else b"dump"
            )

        return SimpleNamespace(
            returncode=1 if failed else 0, stdout="running\n", stderr="refused"
        )

    monkeypatch.setattr(subprocess, "run", run)
    return commands


def fake_storage(monkeypatch, fail_on: str | None = None) -> list[str]:
    """Stands in for the GCS client. Uploading a name ending in `fail_on`, or
    listing when `fail_on` is "list", raises what an outage raises."""
    uploaded = []

    def upload(name: str):
        if fail_on and name.endswith(fail_on):
            raise ServiceUnavailable(f"upload of {name} refused")
        uploaded.append(name)

    def list_blobs(bucket: str):
        if fail_on == "list":
            raise ServiceUnavailable("listing refused")
        return [SimpleNamespace(name=name) for name in uploaded]

    client = SimpleNamespace(
        bucket=lambda bucket: SimpleNamespace(
            blob=lambda name: SimpleNamespace(
                upload_from_filename=lambda path: upload(name)
            )
        ),
        list_blobs=list_blobs,
    )
    monkeypatch.setattr(gcs_utils, "storage_client", client)
    return uploaded


class FakeProcess:
    def __init__(self, returncode: int):
        self.stdout = iter([])
        self.returncode = returncode

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_processor(monkeypatch, fail_on: str | None = None) -> list[str]:
    steps = []

    def popen(cmd, **kwargs):
        steps.append(cmd[1])
        return FakeProcess(1 if cmd[1] == fail_on else 0)

    monkeypatch.setattr(processor.subprocess, "Popen", popen)
    return steps


def test_a_processor_run_that_succeeds_exits_zero(monkeypatch, cli):
    steps = fake_processor(monkeypatch)

    code, log = cli("-s", "processor")

    assert code == 0
    assert "failed" not in log
    assert steps == ["pull", "run"]


@pytest.mark.parametrize(
    ("step", "error"),
    [
        ("pull", "Pulling stagecodes/otr-processor:test failed (code 1)"),
        ("run", "Processor failed (code 1)"),
    ],
)
def test_a_failed_processor_step_exits_nonzero(monkeypatch, cli, step, error):
    fake_processor(monkeypatch, fail_on=step)

    code, log = cli("-s", "processor")

    assert code == 1
    assert error in log
    assert "'processor' failed" in log


def test_a_missing_docker_fails_the_processor_run(monkeypatch, cli):
    def popen(cmd, **kwargs):
        raise FileNotFoundError(2, "No such file or directory", "docker")

    monkeypatch.setattr(processor.subprocess, "Popen", popen)

    code, log = cli("-s", "processor")

    assert code == 1
    assert "'processor' failed" in log
    assert "No such file or directory" in log


def test_an_archive_that_succeeds_uploads_and_exits_zero(monkeypatch, cli, dirs):
    fake_docker(monkeypatch)
    uploaded = fake_storage(monkeypatch)

    code, log = cli("-s", "archive", "--archive-bucket", "production")

    assert code == 0
    assert "failed" not in log
    assert len(uploaded) == 1
    assert uploaded[0].startswith("otr-production-replica_")
    assert list(dirs.dumps.iterdir()) == []


def test_a_failed_export_exits_nonzero_and_leaves_no_partial_dump(
    monkeypatch, cli, dirs
):
    fake_docker(monkeypatch, fail_on="pg_dump")
    uploaded = fake_storage(monkeypatch)

    code, log = cli("-s", "archive", "--archive-bucket", "production")

    assert code == 1
    assert "Exporting otr-production-replica_" in log
    assert "failed (exit code 1)" in log
    assert "'archive' failed" in log
    assert uploaded == []
    assert list(dirs.dumps.iterdir()) == []


def test_a_failed_upload_exits_nonzero_and_keeps_the_dump(monkeypatch, cli, dirs):
    fake_docker(monkeypatch)
    fake_storage(monkeypatch, fail_on=".gz")

    code, log = cli("-s", "archive", "--archive-bucket", "production")

    assert code == 1
    assert "Archive failed while uploading otr-production-replica_" in log
    assert "upload of otr-production-replica_" in log
    assert "'archive' failed" in log
    (kept,) = dirs.dumps.iterdir()
    assert kept.read_bytes() == b"dump"


@pytest.mark.parametrize(
    ("fail_on", "step"),
    [
        (".sha256", r"uploading otr-public-replica_\S+\.gz\.sha256"),
        ("list", "refreshing the public index"),
    ],
)
def test_a_failed_public_publish_step_exits_nonzero(
    monkeypatch, cli, dirs, fail_on, step
):
    fake_docker(monkeypatch)
    fake_storage(monkeypatch, fail_on=fail_on)

    code, log = cli("-s", "archive", "--archive-bucket", "public")

    assert code == 1
    assert re.search(f"Archive failed while {step}", log)
    assert "'archive' failed" in log


def test_a_public_archive_publishes_its_hash_and_index(monkeypatch, cli, dirs):
    fake_docker(monkeypatch)
    uploaded = fake_storage(monkeypatch)

    code, log = cli("-s", "archive", "--archive-bucket", "public")

    assert code == 0
    assert "failed" not in log
    dump, digest = uploaded
    assert digest == f"{dump}.sha256"
    assert dump in (dirs.html / "index.html").read_text()


def test_a_failed_index_refresh_exits_nonzero(monkeypatch, cli, dirs):
    fake_storage(monkeypatch, fail_on="list")

    code, log = cli("-s", "refresh-index")

    assert code == 1
    assert "'refresh-index' failed" in log
    assert "listing refused" in log
    assert not dirs.html.exists()


def test_a_script_that_returns_no_result_counts_as_failed(monkeypatch, cli):
    monkeypatch.setattr(public_html, "generate_index", lambda: None)

    code, log = cli("-s", "refresh-index")

    assert code == 1
    assert "'refresh-index' failed" in log


def test_a_failure_stops_the_scripts_after_it(monkeypatch, cli, dirs):
    fake_storage(monkeypatch, fail_on="list")
    steps = fake_processor(monkeypatch)

    code, _ = cli("-s", "refresh-index", "processor")

    assert code == 1
    assert steps == []


def test_a_recovery_whose_database_will_not_start_exits_nonzero(
    monkeypatch, cli, tmp_path
):
    dump = tmp_path / "otr-dev-replica_2026-08-24T12:00:00Z.gz"
    dump.write_bytes(b"dump")
    commands = fake_docker(monkeypatch, fail_on="docker compose up -d db")

    code, log = cli("-s", "recovery", "--recovery-src", str(dump), "--db-only")

    assert code == 1
    assert f"Starting otr-test-db failed, so {dump.name} was not restored" in log
    assert "'recovery' failed" in log
    assert not any("DROP DATABASE" in command for command in commands)


def test_a_template_drop_whose_lookup_fails_exits_nonzero(monkeypatch, cli):
    commands = fake_docker(monkeypatch, fail_on="SELECT 1 FROM pg_database")

    code, log = cli(
        "-s", "template-db", "--template-action", "drop", "--template-name", "agent_1"
    )

    assert code == 1
    assert "Checking whether agent_1 exists failed" in log
    assert "'template-db' failed" in log
    assert not any("DROP DATABASE" in command for command in commands)


@pytest.fixture
def metrics_dir(monkeypatch, tmp_path):
    path = tmp_path / "textfile"
    path.mkdir()
    monkeypatch.setattr(metrics.config, "metrics_dir", path)
    return path


def recorded(metrics_dir: Path) -> dict[str, str]:
    return {path.name: path.read_text() for path in metrics_dir.iterdir()}


def test_a_run_records_its_result_for_the_alerts(monkeypatch, cli, metrics_dir):
    fake_processor(monkeypatch)

    cli("-s", "processor")

    (text,) = recorded(metrics_dir).values()
    assert 'otr_script_last_run_success{script="processor"} 1\n' in text
    assert re.search(
        r'otr_script_last_run_timestamp_seconds\{script="processor"\} \d+\n', text
    )


def test_a_run_records_how_long_it_took(monkeypatch, cli, metrics_dir):
    fake_processor(monkeypatch)
    clock = iter([1_000.0, 1_642.4])
    monkeypatch.setattr(main.time, "monotonic", lambda: next(clock))

    cli("-s", "processor")

    (text,) = recorded(metrics_dir).values()
    assert 'otr_script_last_run_duration_seconds{script="processor"} 642\n' in text


def test_each_archive_bucket_records_its_own_result(
    monkeypatch, cli, dirs, metrics_dir
):
    fake_docker(monkeypatch)
    fake_storage(monkeypatch)
    cli("-s", "archive", "--archive-bucket", "production")
    fake_docker(monkeypatch, fail_on="pg_dump")
    cli("-s", "archive", "--archive-bucket", "public")

    files = recorded(metrics_dir)

    assert sorted(files) == [
        "otr_script_archive_production.prom",
        "otr_script_archive_public.prom",
    ]
    production = files["otr_script_archive_production.prom"]
    public = files["otr_script_archive_public.prom"]
    assert (
        'otr_script_last_run_success{script="archive",bucket="production"} 1\n'
        in production
    )
    assert 'otr_script_last_run_success{script="archive",bucket="public"} 0\n' in public


def test_a_dev_archive_records_its_result(monkeypatch, cli, dirs, metrics_dir):
    # dev-archive.yml makes one every week, and the dev tier stops working
    # when they stop, so its runs alert like the cron's.
    fake_docker(monkeypatch)
    fake_storage(monkeypatch)
    monkeypatch.setattr(
        db,
        "_table_columns",
        lambda table: [
            db.Column("id", "text"),
            *(db.Column(name, "text") for name in db.dev_secret_columns[table]),
        ],
    )

    code, _ = cli("-s", "archive", "--archive-bucket", "dev")

    assert code == 0
    files = recorded(metrics_dir)
    assert list(files) == ["otr_script_archive_dev.prom"]
    assert (
        'otr_script_last_run_success{script="archive",bucket="dev"} 1\n'
        in files["otr_script_archive_dev.prom"]
    )


def test_a_run_that_raises_records_a_failure(monkeypatch, cli, metrics_dir):
    def popen(cmd, **kwargs):
        raise FileNotFoundError(2, "No such file or directory", "docker")

    monkeypatch.setattr(processor.subprocess, "Popen", popen)

    cli("-s", "processor")

    (text,) = recorded(metrics_dir).values()
    assert 'otr_script_last_run_success{script="processor"} 0\n' in text


def test_a_hand_run_script_records_nothing(monkeypatch, cli, dirs, metrics_dir):
    fake_docker(monkeypatch)
    fake_storage(monkeypatch)

    cli("-s", "template-db", "--template-action", "list")
    cli("-s", "archive", "--archive-bucket", "test")

    assert recorded(metrics_dir) == {}


def test_a_failed_recording_keeps_the_runs_exit_code(monkeypatch, cli, metrics_dir):
    fake_processor(monkeypatch)
    metrics_dir.rmdir()

    code, log = cli("-s", "processor")

    assert code == 0
    assert "Recording the 'processor' run in" in log
