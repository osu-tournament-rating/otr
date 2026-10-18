import os
import re
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from lib.stack import envfile, procs, stack
from lib.stack.base import Credentials
from lib.stack.common import StackError

CREDS = Credentials("post gres", "p@ss:word/#", "otr")


def test_parse_reads_quotes_exports_and_comments():
    text = (
        "# comment\n"
        "A=plain\n"
        "export B='single'\n"
        'C="double # kept"\n'
        "D=value # trailing\n"
        "A=last wins\n"
    )

    assert envfile.parse(text) == {
        "A": "last wins",
        "B": "single",
        "C": "double # kept",
        "D": "value",
    }


def test_apply_replaces_managed_keys_and_unsets_none():
    text = "KEEP=1\nDATABASE_URL=postgresql://main\nexport OTEL=old\n"

    result = envfile.apply(text, {"DATABASE_URL": "postgresql://stack", "OTEL": None})

    assert envfile.parse(result) == {"KEEP": "1", "DATABASE_URL": "postgresql://stack"}
    assert "postgresql://main" not in result
    assert "OTEL" not in result


def test_apply_rewrites_its_block_in_place():
    once = envfile.apply("KEEP=1\n", {"A": "1", "B": "2"})
    twice = envfile.apply(once, {"A": "3", "B": None})

    assert twice.count(envfile.BEGIN) == 1
    assert envfile.parse(twice) == {"KEEP": "1", "A": "3"}
    assert envfile.apply(twice, {"A": "3", "B": None}) == twice


def test_ensure_copies_the_main_checkout_env(tmp_path):
    main, worktree = tmp_path / "main", tmp_path / "wt"
    main.mkdir()
    worktree.mkdir()
    (main / ".env").write_text("A=1\n")

    env = envfile.ensure(worktree, main)

    assert env.read_text() == "A=1\n"
    assert not env.is_symlink()


def test_ensure_replaces_a_symlink_without_touching_its_target(tmp_path):
    main, worktree = tmp_path / "main", tmp_path / "wt"
    main.mkdir()
    worktree.mkdir()
    (main / ".env").write_text("A=1\n")
    (worktree / ".env").symlink_to(main / ".env")

    env = envfile.ensure(worktree, main)
    envfile.write(env, {"A": "2"})

    assert not env.is_symlink()
    assert (main / ".env").read_text() == "A=1\n"
    assert envfile.parse(env.read_text()) == {"A": "2"}


def test_ensure_fails_without_any_env(tmp_path):
    with pytest.raises(FileNotFoundError):
        envfile.ensure(tmp_path, tmp_path / "main")


def test_stack_names_are_compose_safe_and_unique_per_path():
    first = stack.stack_name(Path("/w/a/Feature_Branch.X"))
    second = stack.stack_name(Path("/w/b/Feature_Branch.X"))

    assert re.fullmatch(r"otr-[a-z0-9-]+-[0-9a-f]{6}", first)
    assert first != second
    assert first == stack.stack_name(Path("/w/a/Feature_Branch.X"))


def test_slots_own_ten_ports_each():
    # 20012 and 20013 were RabbitMQ's; every other port keeps its number.
    assert stack.Ports.for_slot(1).all() == [20010, 20011, 20014, 20015, 20016, 20017]
    assert stack.Ports.for_slot(2).web == 20020


def test_allocate_reuses_a_worktree_stack(tmp_path):
    first = stack.allocate(tmp_path, Path("/w/a"), free=lambda port: True)
    again = stack.allocate(tmp_path, Path("/w/a"), free=lambda port: True)

    assert again == first
    assert first.slot == 1


def test_allocate_skips_taken_slots_and_busy_ports(tmp_path):
    stack.allocate(tmp_path, Path("/w/a"), free=lambda port: True)
    busy = set(stack.Ports.for_slot(2).all())

    second = stack.allocate(tmp_path, Path("/w/b"), free=lambda port: port not in busy)

    assert second.slot == 3


def test_allocate_fails_when_every_slot_is_busy(tmp_path):
    with pytest.raises(StackError):
        stack.allocate(tmp_path, Path("/w/a"), free=lambda port: False)


def test_managed_env_escapes_credentials_and_toggles_tracing(tmp_path):
    entry = stack.Stack(tmp_path, "otr-a-123456", Path("/w/a"), 1)

    off = stack.managed_env(entry, CREDS, monitoring=False)
    on = stack.managed_env(entry, CREDS, monitoring=True)

    assert off["DATABASE_URL"] == (
        "postgresql://post%20gres:p%40ss%3Aword%2F%23@127.0.0.1:20011/otr"
    )
    assert off["NEXT_PUBLIC_APP_BASE_URL"] == "http://127.0.0.1:20010"
    assert off["OTEL_EXPORTER_OTLP_ENDPOINT"] is None
    assert on["OTEL_EXPORTER_OTLP_ENDPOINT"] == "http://127.0.0.1:20016"
    assert off["PLAYER_OSU_AUTO_REFETCH_ENABLED"] == "false"


def test_managed_env_blanks_the_beatmap_files_bucket(tmp_path, monkeypatch):
    monkeypatch.setenv("BEATMAP_FILES_BUCKET", "otr-beatmaps")
    entry = stack.Stack(tmp_path, "otr-a-123456", Path("/w/a"), 1)
    main = (
        "BEATMAP_FILES_BUCKET=otr-beatmaps\n"
        "BEATMAP_FILES_ACCESS_KEY_ID=GOOG1EXAMPLE\n"
        "BEATMAP_FILES_SECRET_ACCESS_KEY=secret\n"
        "BEATMAP_FILES_DIR=/tmp/beatmaps\n"
    )

    managed = stack.managed_env(entry, CREDS, monitoring=False)
    values = envfile.parse(envfile.apply(main, managed))

    assert values["BEATMAP_FILES_BUCKET"] == ""
    assert values["BEATMAP_FILES_ACCESS_KEY_ID"] == ""
    assert values["BEATMAP_FILES_SECRET_ACCESS_KEY"] == ""
    assert values["BEATMAP_FILES_DIR"] == "/tmp/beatmaps"
    assert "BEATMAP_FILES_DIR" not in managed
    assert stack.process_env(managed)["BEATMAP_FILES_BUCKET"] == ""


def test_process_env_overrides_the_shell(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://main")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://main")

    env = stack.process_env(
        {"DATABASE_URL": "postgresql://stack", "OTEL_EXPORTER_OTLP_ENDPOINT": None}
    )

    assert env["DATABASE_URL"] == "postgresql://stack"
    assert "OTEL_EXPORTER_OTLP_ENDPOINT" not in env


def test_registry_round_trips(tmp_path):
    entry = stack.Stack(tmp_path, "otr-a-123456", Path("/w/a"), 4, "postgres:17", "t")
    entry.save()

    assert stack.load_stacks(tmp_path) == [entry]


def test_process_records_reject_reused_pids(tmp_path):
    record = tmp_path / "web.json"
    pid = os.getpid()
    started = procs.start_time(pid)
    assert isinstance(started, int)

    record.write_text(f'{{"pid": {pid}, "started": {started}, "env": "x"}}')
    assert procs.load(record) == procs.Record(pid, started, "x")

    record.write_text(f'{{"pid": {pid}, "started": {started + 1}, "env": "x"}}')
    assert procs.load(record) is None


@pytest.fixture
def otr(tmp_path, monkeypatch):
    """Runs `otr up` with every docker, bun, and process call replaced by a
    recorder. Each run returns the steps it took, in order."""
    main, worktree, root = tmp_path / "main", tmp_path / "wt", tmp_path / "stacks"
    main.mkdir()
    worktree.mkdir()
    (main / ".env").write_text("A=1\n")
    monkeypatch.setenv("OTR_STACKS_DIR", str(root))
    stack.allocate(root, worktree, free=lambda port: True)
    steps = []
    running = set()

    def clone(base, target):
        steps.append("copy")
        target.mkdir()
        return {"image": "postgres:17", "created": "2026-10-18T00:00:00+00:00"}

    def compose(entry, creds, *args):
        if args[0] == "up":
            steps.append("start db")
        return "db-container\n" if args[:2] == ("ps", "-q") else ""

    def stop(record):
        if record.stem not in running:
            return False
        running.discard(record.stem)
        steps.append(("stop", record.stem))
        return True

    monkeypatch.setattr(
        stack, "find_checkout", lambda start: stack.Checkout(worktree, main)
    )
    monkeypatch.setattr(stack, "install_dependencies", lambda path: None)
    monkeypatch.setattr(stack.snapshot, "ensure", lambda base, creds, force: {})
    monkeypatch.setattr(stack.snapshot, "clone", clone)
    monkeypatch.setattr(
        stack.snapshot, "remove", lambda root, image, target: shutil.rmtree(target)
    )
    monkeypatch.setattr(stack, "compose", compose)
    monkeypatch.setattr(
        stack.snapshot,
        "psql",
        lambda container, creds, sql: steps.append(("sql", container, sql)) or "",
    )
    monkeypatch.setattr(stack.procs, "stop", stop)
    monkeypatch.setattr(stack, "migrate", lambda path, url: steps.append("migrate"))
    monkeypatch.setattr(
        stack,
        "sync_processes",
        lambda entry, managed, wanted: steps.append(("processes", sorted(wanted))),
    )
    monkeypatch.setattr(stack, "describe", lambda *args, **kwargs: None)

    def up(fresh=False):
        steps.clear()
        stack.up(worktree, set(), web=False, fresh=fresh)
        return list(steps)

    return SimpleNamespace(up=up, running=running)


CLEAR_JOBS = ("sql", "db-container", stack.CLEAR_COPIED_JOBS)


def test_a_new_copy_clears_its_jobs_before_migrations_and_processes(otr):
    assert otr.up() == [
        "copy",
        "start db",
        CLEAR_JOBS,
        "migrate",
        ("processes", []),
    ]


def test_restarting_a_stack_keeps_its_jobs_until_a_fresh_copy(otr):
    otr.up()
    otr.running.add("worker")

    restarted = otr.up()

    assert CLEAR_JOBS not in restarted
    assert ("stop", "worker") not in restarted
    assert CLEAR_JOBS in otr.up(fresh=True)


def test_a_copy_whose_up_failed_clears_its_jobs_on_the_next_up(otr, monkeypatch):
    working = stack.compose

    def port_taken(entry, creds, *args):
        if args[0] == "up":
            raise StackError("port is already allocated")
        return working(entry, creds, *args)

    monkeypatch.setattr(stack, "compose", port_taken)
    with pytest.raises(StackError):
        otr.up()
    monkeypatch.setattr(stack, "compose", working)

    retried = otr.up()

    assert "copy" not in retried
    assert CLEAR_JOBS in retried


def test_a_fresh_copy_restarts_a_running_worker_only_after_clearing_jobs(otr):
    otr.up()
    otr.running.add("worker")

    assert otr.up(fresh=True) == [
        "copy",
        ("stop", "worker"),
        "start db",
        CLEAR_JOBS,
        "migrate",
        ("processes", ["worker"]),
    ]
