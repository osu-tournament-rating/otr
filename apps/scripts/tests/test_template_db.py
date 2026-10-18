import shlex
from pathlib import Path

import pytest

from lib.scripts import template_db


@pytest.mark.parametrize("name", ["agent", "agent_1", "a" * 31])
def test_valid_instance_names_pass(name):
    assert template_db.validate_name(name) == name


@pytest.mark.parametrize(
    "name",
    [
        None,
        "",
        "Agent",
        "1agent",
        "agent-1",
        "agent; DROP DATABASE postgres",
        "a" * 32,
        "otr_template",
        "postgres",
        "template1",
    ],
)
def test_invalid_instance_names_are_rejected(name):
    with pytest.raises(ValueError):
        template_db.validate_name(name)


@pytest.mark.parametrize("port", [5432, 5433])
def test_guard_rejects_reserved_ports(monkeypatch, port):
    monkeypatch.setattr(template_db.config, "template_db_port", port)

    with pytest.raises(RuntimeError):
        template_db.guard()


def test_guard_rejects_the_application_container(monkeypatch):
    monkeypatch.setattr(template_db.config, "template_db_container", "otr-test-db")

    with pytest.raises(RuntimeError):
        template_db.guard()


def test_guard_accepts_the_dedicated_container():
    template_db.guard()


def test_seed_steps_recreate_and_flag_the_template():
    flag_off, terminate, drop, create, restore, flag_on = template_db.seed_steps(
        Path("/dumps/a b.gz")
    )

    assert "datistemplate = false" in flag_off[-1]
    assert "datistemplate = true" in flag_on[-1]
    assert f"datname = '{template_db.TEMPLATE}'" in terminate[-1]
    assert drop[-1] == "DROP DATABASE IF EXISTS otr_template"
    assert create[-1] == "CREATE DATABASE otr_template"
    assert restore[:4] == ["bash", "-o", "pipefail", "-c"]
    assert restore[-1].startswith("gunzip -c '/dumps/a b.gz' | docker exec -i")
    assert "-d otr_template -v ON_ERROR_STOP=1 --quiet" in restore[-1]

    for step in (flag_off, terminate, drop, create, flag_on):
        assert step[step.index("-d") + 1] == "postgres"
        assert step[:4] == ["docker", "exec", "-i", "otr-template-test-db"]


def test_drop_terminates_then_drops():
    terminate, drop = template_db.drop_steps("agent_1")

    assert "datname = 'agent_1'" in terminate[-1]
    assert drop[-1] == "DROP DATABASE IF EXISTS agent_1"


def test_list_excludes_templates_and_system_databases():
    sql = template_db.list_command()[-1]

    assert "pg_size_pretty" in sql
    assert "datistemplate = false" in sql
    assert "NOT IN ('postgres', 'otr_template')" in sql


def test_container_runs_on_the_configured_port():
    cmd = shlex.join(template_db.create_container_command())

    assert "--name otr-template-test-db" in cmd
    assert "-p 127.0.0.1:5434:5432" in cmd
    assert "-v otr-template-test-db-data:/var/lib/postgresql/data" in cmd
    assert cmd.endswith("postgres:17")


def test_connection_string_omits_the_password():
    assert (
        template_db.connection_string("agent_1")
        == "postgresql://postgres@localhost:5434/agent_1"
    )


@pytest.fixture
def preparation(monkeypatch, tmp_path):
    from contextlib import contextmanager
    from types import SimpleNamespace

    events = []
    task = tmp_path / "task"
    source = tmp_path / "source"
    task.mkdir()
    source.mkdir()

    @contextmanager
    def lock():
        events.append("lock")
        yield
        events.append("unlock")

    @contextmanager
    def default_migrations(web):
        assert web == task
        yield source

    monkeypatch.setattr(template_db, "template_lock", lock, raising=False)
    monkeypatch.setattr(
        template_db, "default_migrations", default_migrations, raising=False
    )
    monkeypatch.setattr(template_db, "ensure_container", lambda: True)
    monkeypatch.setattr(
        template_db, "database_exists", lambda name: name == template_db.TEMPLATE
    )
    monkeypatch.setattr(
        template_db, "run_command", lambda cmd: events.append(cmd[-1]) or ""
    )
    monkeypatch.setattr(
        template_db,
        "migrate",
        lambda web, migrations, name: events.append((migrations, name)) or True,
        raising=False,
    )
    args = SimpleNamespace(
        template_action="create", template_name="agent_1", template_web_dir=task
    )
    return args, events, source, task


def test_creation_prepares_source_then_clone_under_lock(preparation):
    args, events, source, task = preparation
    assert template_db.run(args)
    assert events == [
        "lock",
        (source, "otr_template"),
        template_db.terminate_command("otr_template")[-1],
        "CREATE DATABASE agent_1 TEMPLATE otr_template",
        (task / "apps/web/drizzle", "agent_1"),
        "unlock",
    ]


def test_source_migration_failure_blocks_clone(preparation, monkeypatch):
    args, events, _, _ = preparation
    monkeypatch.setattr(template_db, "migrate", lambda *args: False)
    assert not template_db.run(args)
    assert events == ["lock", "unlock"]


def test_existing_database_is_preserved(preparation, monkeypatch):
    args, events, _, _ = preparation
    monkeypatch.setattr(template_db, "database_exists", lambda name: True)
    assert not template_db.run(args)
    assert events == ["lock", "unlock"]


@pytest.mark.parametrize("failing", ["agent_1", "otr_template"])
def test_a_failed_lookup_blocks_creation(preparation, monkeypatch, failing):
    args, events, _, _ = preparation
    monkeypatch.setattr(
        template_db,
        "database_exists",
        lambda name: None if name == failing else name == template_db.TEMPLATE,
    )
    assert not template_db.run(args)
    assert events == ["lock", "unlock"]


def test_clone_migration_failure_is_reported_without_dropping(preparation, monkeypatch):
    args, events, _, _ = preparation
    monkeypatch.setattr(
        template_db, "migrate", lambda web, migrations, name: name == "otr_template"
    )
    assert not template_db.run(args)
    assert "CREATE DATABASE agent_1 TEMPLATE otr_template" in events
    assert not any("DROP DATABASE" in str(event) for event in events)


def test_repeated_creation_runs_migrator_each_time(preparation):
    args, events, source, _ = preparation
    assert template_db.run(args)
    args.template_name = "agent_2"
    assert template_db.run(args)
    assert events.count((source, "otr_template")) == 2
    assert "CREATE DATABASE agent_2 TEMPLATE otr_template" in events


def test_default_migrations_use_remote_head_not_task_files(tmp_path):
    import subprocess

    def git(*args):
        return subprocess.run(["git", *map(str, args)], check=True, capture_output=True)

    origin = tmp_path / "origin"
    origin.mkdir()
    git("init", "-b", "main", origin)
    migrations = origin / "apps/web/drizzle"
    migrations.mkdir(parents=True)
    (migrations / "migration.sql").write_text("default branch")
    git("-C", origin, "add", ".")
    git(
        "-C",
        origin,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial",
    )
    task = tmp_path / "task"
    git("clone", origin, task)
    git("-C", task, "checkout", "-b", "task")
    (task / "apps/web/drizzle/migration.sql").write_text("unmerged task")
    (migrations / "migration.sql").write_text("new default revision")
    git(
        "-C",
        origin,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-am",
        "new default",
    )
    with template_db.default_migrations(task) as source:
        assert (source / "migration.sql").read_text() == "new default revision"
        assert (task / "apps/web/drizzle/migration.sql").read_text() == "unmerged task"
    assert not source.exists()


def test_default_branch_fetch_failure_blocks_creation(preparation, monkeypatch):
    from contextlib import contextmanager

    @contextmanager
    def fail(web):
        raise RuntimeError("Default-branch migration preparation failed at git fetch")
        yield

    args, events, _, _ = preparation
    monkeypatch.setattr(template_db, "default_migrations", fail)
    assert not template_db.run(args)
    assert not any("CREATE DATABASE" in str(event) for event in events)


def test_migrator_uses_explicit_local_url_without_loading_env(
    tmp_path, monkeypatch, caplog
):
    from types import SimpleNamespace

    runner = tmp_path / "node_modules/drizzle-kit/bin.cjs"
    runner.parent.mkdir(parents=True)
    runner.touch()
    journal = tmp_path / "apps/web/drizzle/meta/_journal.json"
    journal.parent.mkdir(parents=True)
    journal.write_text("{}")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://private-live-credentials@remote/db"
    )
    monkeypatch.setattr(template_db.config, "template_db_password", "test@secret")

    def run(command, **kwargs):
        assert command[:3] == ["bun", "--no-env-file", str(runner)]
        assert (
            kwargs["env"]["DATABASE_URL"]
            == "postgresql://postgres:test%40secret@127.0.0.1:5434/agent_1"
        )
        config = Path(command[-1]).read_text()
        assert str(journal.parent.parent) in config
        assert "loadRootEnv" not in config
        assert "test@secret" not in config
        assert Path(kwargs["cwd"]) != tmp_path
        return SimpleNamespace(
            returncode=1, stderr=b"test@secret private-live-credentials"
        )

    monkeypatch.setattr(template_db.subprocess, "run", run)
    assert not template_db.migrate(tmp_path, journal.parent.parent, "agent_1")
    assert "test@secret" not in caplog.text
    assert "private-live-credentials" not in caplog.text


def test_lock_serializes_processes_and_releases_after_failure(tmp_path, monkeypatch):
    import multiprocessing

    monkeypatch.setattr(template_db, "LOCK_DIR", tmp_path / "locks")
    monkeypatch.setattr(template_db.tempfile, "gettempdir", lambda: str(tmp_path))
    ctx = multiprocessing.get_context("fork")
    started, acquired = ctx.Event(), ctx.Event()

    def contender():
        other = tmp_path / "other-temp"
        other.mkdir()
        monkeypatch.setattr(template_db.tempfile, "gettempdir", lambda: str(other))
        started.set()
        with template_db.template_lock():
            acquired.set()

    with pytest.raises(RuntimeError), template_db.template_lock():
        child = ctx.Process(target=contender)
        child.start()
        assert started.wait(5)
        assert not acquired.wait(0.2)
        raise RuntimeError("source migration failed")
    try:
        assert acquired.wait(5)
        child.join(5)
        assert child.exitcode == 0
    finally:
        if child.is_alive():
            child.terminate()
            child.join()


def test_cli_requires_task_checkout_only_for_create(monkeypatch):
    from lib import cli

    monkeypatch.setattr(
        "sys.argv",
        [
            "main",
            "--script",
            "template-db",
            "--template-action",
            "create",
            "--template-name",
            "agent_1",
        ],
    )
    with pytest.raises(SystemExit):
        cli.init()
    monkeypatch.setattr(
        "sys.argv", ["main", "--script", "template-db", "--template-action", "list"]
    )
    assert cli.init().template_web_dir is None
