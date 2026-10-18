import logging

from lib import processor

IMAGE = "stagecodes/otr-processor:test"


class FakeProcess:
    def __init__(self, output: str, returncode: int):
        self.stdout = iter(output.splitlines(keepends=True))
        self.returncode = returncode

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def record_runs(monkeypatch, outputs: dict[str, str] | None = None, fail_on=None):
    commands = []

    def popen(cmd, **kwargs):
        commands.append(cmd)
        step = cmd[1]
        return FakeProcess((outputs or {}).get(step, ""), 1 if step == fail_on else 0)

    monkeypatch.setattr(processor.subprocess, "Popen", popen)
    return commands


def test_run_passes_the_new_variable_names_to_the_container(monkeypatch):
    commands = record_runs(monkeypatch)

    assert processor.run() is True

    pull, run = commands
    assert pull == ["docker", "pull", IMAGE]
    assert run == [
        "docker",
        "run",
        "--network",
        "host",
        "-e",
        "DATABASE_URL=postgresql://tester:test@localhost:5432/otr_test",
        "-e",
        "RUST_LOG=info",
        IMAGE,
    ]
    assert not any(
        arg.startswith(("CONNECTION_STRING=", "RABBITMQ_URL=")) for arg in run
    )


def test_run_logs_every_line_of_output(monkeypatch, caplog):
    record_runs(monkeypatch, {"pull": "pulled\n", "run": "rating\nrated\n"})

    with caplog.at_level(logging.INFO, logger=processor.__name__):
        processor.run()

    assert {"pulled", "rating", "rated"} <= {r.getMessage() for r in caplog.records}


def test_run_stops_when_the_pull_fails(monkeypatch):
    commands = record_runs(monkeypatch, fail_on="pull")

    assert processor.run() is False
    assert commands[-1][1] == "pull"
