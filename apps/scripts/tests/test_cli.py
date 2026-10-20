import sys
from pathlib import Path

import pytest

from lib import cli


def test_script_flag_needs_a_script(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["main.py", "-s"])

    with pytest.raises(SystemExit) as excinfo:
        cli.init()

    assert excinfo.value.code == 2


def test_script_flag_takes_several_scripts(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["main.py", "-s", "archive", "processor", "--archive-bucket", "dev"],
    )

    assert cli.init().scripts == ["archive", "processor"]


def test_backfill_receipts_reads_every_logs_dir_and_the_upload_flag(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "main.py",
            "-s",
            "backfill-receipts",
            "--logs-dir",
            "/logs/old",
            "--logs-dir",
            "/logs/new",
            "--upload",
        ],
    )

    args = cli.init()

    assert args.logs_dirs == (Path("/logs/old"), Path("/logs/new"))
    assert args.receipts_upload is True
