import os
import re
from pathlib import Path

import pytest

from lib.stack import envfile, procs, stack
from lib.stack.base import Credentials
from lib.stack.common import StackError

CREDS = Credentials("post gres", "p@ss:word/#", "otr", "admin", "admin")


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
    assert stack.Ports.for_slot(1).all() == list(range(20010, 20018))
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
    assert off["RABBITMQ_AMQP_URL"] == "amqp://admin:admin@127.0.0.1:20012/"
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
