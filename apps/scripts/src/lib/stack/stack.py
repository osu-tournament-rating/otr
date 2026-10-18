"""Per-worktree o!TR stacks for agents.

Each linked worktree gets one stack: its own PostgreSQL container holding a
copy of the local database, the worktree's web app, and on request the data
worker and monitoring. Stacks share nothing with each other or with
the main checkout's services.

State lives outside the worktrees, under ~/.local/share/otr/stacks (or
$OTR_STACKS_DIR): the shared base, and one directory per stack with its
database files, its registry entry, and its process records. Logs go to the
worktree's .tmp/otr so the agent working there can read them.
"""

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from lib.stack import base as snapshot
from lib.stack import envfile, procs
from lib.stack.base import Base, Credentials
from lib.stack.common import StackError, locked, run

COMPOSE = Path(__file__).with_name("compose.yml")
DEFAULT_IMAGE = "postgres:17"
HOST = "127.0.0.1"

# Every stack owns ten consecutive ports: slot 1 has 20010-20019.
PORT_BASE = 20000
SLOTS = range(1, 100)

SERVICES = ("monitoring",)
PROCESSES = ("web", "worker")
COMPONENTS = ("web", "worker", "monitoring")


def stacks_root() -> Path:
    if override := os.environ.get("OTR_STACKS_DIR"):
        return Path(override).expanduser()
    data = os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(data) / "otr" / "stacks"


@dataclass(frozen=True)
class Checkout:
    root: Path
    main: Path

    @property
    def linked(self) -> bool:
        return self.root != self.main


def find_checkout(path: Path) -> Checkout:
    result = subprocess.run(
        [
            "git",
            "-C",
            str(path),
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-common-dir",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise StackError(f"{path} is not inside an otr checkout")
    toplevel, common = result.stdout.splitlines()[:2]
    return Checkout(Path(toplevel), Path(common).parent)


def stack_name(worktree: Path) -> str:
    """A Compose project name that is readable and unique per worktree path."""
    label = re.sub(r"[^a-z0-9]+", "-", worktree.name.lower()).strip("-")[:24]
    digest = hashlib.sha256(str(worktree).encode()).hexdigest()[:6]
    return f"otr-{label or 'worktree'}-{digest}"


@dataclass(frozen=True)
class Ports:
    web: int
    db: int
    worker_metrics: int
    grafana: int
    otlp_http: int
    otlp_grpc: int

    @classmethod
    def for_slot(cls, slot: int) -> Ports:
        first = PORT_BASE + slot * 10
        # +2 and +3 were RabbitMQ's and stay unused, so every other port keeps
        # the number a stack's .env and running processes already have.
        return cls(
            web=first,
            db=first + 1,
            worker_metrics=first + 4,
            grafana=first + 5,
            otlp_http=first + 6,
            otlp_grpc=first + 7,
        )

    def all(self) -> list[int]:
        return list(asdict(self).values())


@dataclass(frozen=True)
class Stack:
    root: Path
    name: str
    worktree: Path
    slot: int
    image: str = DEFAULT_IMAGE
    base_created: str | None = None

    @property
    def dir(self) -> Path:
        return self.root / self.name

    @property
    def pgdata(self) -> Path:
        return self.dir / "pgdata"

    @property
    def registry(self) -> Path:
        return self.dir / "stack.json"

    @property
    def lock(self) -> Path:
        return self.root / "locks" / f"{self.name}.lock"

    @property
    def new_copy(self) -> Path:
        """Marks a database copy that still holds the local database's jobs."""
        return self.dir / "new-copy"

    @property
    def ports(self) -> Ports:
        return Ports.for_slot(self.slot)

    def record(self, process: str) -> Path:
        return self.dir / "run" / f"{process}.json"

    def log(self, process: str) -> Path:
        return self.worktree / ".tmp" / "otr" / f"{process}.log"

    def save(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        fields = {
            "name": self.name,
            "worktree": str(self.worktree),
            "slot": self.slot,
            "image": self.image,
            "base_created": self.base_created,
        }
        self.registry.write_text(json.dumps(fields, indent=2) + "\n")


def load_stacks(root: Path) -> list[Stack]:
    stacks = []
    for registry in sorted(root.glob("*/stack.json")):
        try:
            fields = json.loads(registry.read_text())
            fields["worktree"] = Path(fields["worktree"])
            stacks.append(Stack(root=root, **fields))
        except (OSError, TypeError, ValueError, KeyError):
            continue
    return stacks


def find(root: Path, worktree: Path) -> Stack | None:
    return next((s for s in load_stacks(root) if s.worktree == worktree), None)


def port_free(port: int) -> bool:
    with socket.socket() as probe:
        try:
            probe.bind((HOST, port))
        except OSError:
            return False
    return True


def allocate(root: Path, worktree: Path, free=port_free) -> Stack:
    """Returns the worktree's stack, registering one in the lowest slot whose
    ports are all free when it has none."""
    with locked(root / "locks" / "registry.lock"):
        if existing := find(root, worktree):
            return existing
        taken = {stack.slot for stack in load_stacks(root)}
        for slot in SLOTS:
            if slot in taken or not all(map(free, Ports.for_slot(slot).all())):
                continue
            stack = Stack(root, stack_name(worktree), worktree, slot)
            stack.save()
            return stack
    raise StackError("Every stack slot is taken; run `otr down` in idle worktrees")


def managed_env(
    stack: Stack, creds: Credentials, monitoring: bool
) -> dict[str, str | None]:
    """The settings `otr up` writes into the worktree's .env. They also turn
    off what a disposable stack should never do: refetch players from osu! on
    a schedule, close itself for the maintenance window, or write beatmap
    files to the production bucket."""
    ports = stack.ports
    web = f"http://{HOST}:{ports.web}"
    pg_auth = f"{quote(creds.pg_user, safe='')}:{quote(creds.pg_password, safe='')}"
    return {
        "DATABASE_URL": f"postgresql://{pg_auth}@{HOST}:{ports.db}/"
        + quote(creds.pg_db, safe=""),
        "NEXT_PUBLIC_APP_BASE_URL": web,
        "BETTER_AUTH_URL": web,
        "INTERNAL_APP_BASE_URL": web,
        "METRICS_PORT": str(ports.worker_metrics),
        "OTEL_EXPORTER_OTLP_ENDPOINT": (
            f"http://{HOST}:{ports.otlp_http}" if monitoring else None
        ),
        # osu! sign-in cannot redirect to a stack's port; this enables the
        # test sign-in endpoint instead.
        "E2E_TEST_AUTH": "true",
        "MAINTENANCE_WINDOW_ENABLED": "false",
        "PLAYER_OSU_AUTO_REFETCH_ENABLED": "false",
        "PLAYER_OSUTRACK_AUTO_REFETCH_ENABLED": "false",
        # Blank, not None: a variable that is set, even to nothing, keeps any
        # other env file from supplying the bucket. BEATMAP_FILES_DIR stays
        # unmanaged, so a stack can opt in to storing files in a directory.
        "BEATMAP_FILES_BUCKET": "",
        "BEATMAP_FILES_ACCESS_KEY_ID": "",
        "BEATMAP_FILES_SECRET_ACCESS_KEY": "",
    }


def compose(stack: Stack, creds: Credentials, *args: str) -> str:
    ports = stack.ports
    env = {
        "OTR_STACK_PG_IMAGE": stack.image,
        "OTR_STACK_PGDATA": str(stack.pgdata),
        "OTR_STACK_WORKTREE": str(stack.worktree),
        "OTR_STACK_DB_PORT": str(ports.db),
        "OTR_STACK_GRAFANA_PORT": str(ports.grafana),
        "OTR_STACK_OTLP_HTTP_PORT": str(ports.otlp_http),
        "OTR_STACK_OTLP_GRPC_PORT": str(ports.otlp_grpc),
    }
    profiles = [flag for service in SERVICES for flag in ("--profile", service)]
    cmd = ["docker", "compose", "-p", stack.name, "-f", str(COMPOSE), *profiles]
    return run([*cmd, *args], env=env)


def running_services(stack: Stack, creds: Credentials) -> set[str]:
    output = compose(
        stack, creds, "ps", "--status", "running", "--format", "{{.Service}}"
    )
    return set(output.split())


def process_env(managed: dict[str, str | None]) -> dict[str, str]:
    """The inherited environment with the managed settings applied, so a value
    exported in the agent's shell cannot point a process elsewhere."""
    env = dict(os.environ)
    for key, value in managed.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    return env


def reset_web_cache(worktree: Path) -> None:
    """Clears the web app's dev cache the first time otr starts it in a
    worktree. A cache built before the web config pinned the monorepo root
    belongs to the outer checkout, and Turbopack reuses it and then fails to
    find packages."""
    marker = worktree / ".tmp" / "otr" / "web-cache-reset"
    if marker.exists():
        return
    shutil.rmtree(worktree / "apps" / "web" / ".next" / "dev", ignore_errors=True)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()


def start_process(stack: Stack, process: str, managed: dict[str, str | None]) -> None:
    ports = stack.ports
    if process == "web":
        reset_web_cache(stack.worktree)
        argv = ["bun", "run", "next", "dev", "--turbopack"]
        argv += ["--port", str(ports.web), "--hostname", HOST]
        cwd = stack.worktree / "apps" / "web"
        health, timeout = f"http://{HOST}:{ports.web}/api/health", 300
    else:
        argv = ["bun", "run", "--watch", "src/index.ts"]
        cwd = stack.worktree / "apps" / "data-worker"
        health, timeout = f"http://{HOST}:{ports.worker_metrics}/health", 90

    print(f"otr: starting {process}")
    log = stack.log(process)
    record = procs.start(
        stack.record(process),
        argv,
        cwd,
        process_env(managed),
        procs.env_digest(managed),
        log,
    )
    try:
        procs.wait_healthy(record, health, log, timeout)
    except StackError as error:
        raise StackError(f"{process} did not become healthy. {error}") from None


def sync_processes(
    stack: Stack, managed: dict[str, str | None], wanted: set[str]
) -> None:
    """Starts each wanted process that is not running, and restarts any running
    one whose settings changed, such as when monitoring comes or goes."""
    digest = procs.env_digest(managed)
    for process in PROCESSES:
        record = procs.load(stack.record(process))
        if record and record.env != digest:
            print(f"otr: restarting {process} with the new settings")
            procs.stop(stack.record(process))
            start_process(stack, process, managed)
        elif record is None and process in wanted:
            start_process(stack, process, managed)


def install_dependencies(worktree: Path) -> None:
    """Installs the worktree's locked dependencies. It takes under a second
    when nothing changed, and keeps a worktree from running with packages
    that are older than its branch."""
    run(["bun", "install", "--frozen-lockfile"], cwd=worktree)


def migrate(worktree: Path, database_url: str) -> None:
    """Applies the worktree's pending migrations, so the copy matches the
    schema the branch expects."""
    try:
        run(
            ["bun", "x", "drizzle-kit", "migrate"],
            cwd=worktree,
            env={"DATABASE_URL": database_url},
        )
    except StackError as error:
        raise StackError(f"The worktree's migrations failed. {error}") from None


def provision(stack: Stack, creds: Credentials, fresh: bool) -> Stack:
    """Gives the stack its database copy, replacing it when `fresh`."""
    if stack.pgdata.exists() and not fresh:
        return stack

    base = Base(stack.root)
    snapshot.ensure(base, creds, force=fresh)
    if stack.pgdata.exists():
        compose(stack, creds, "rm", "--stop", "--force", "--volumes", "db")
        snapshot.remove(stack.root, stack.image, stack.pgdata)

    print(f"otr: copying the base into {stack.name}")
    # Marked before copying, so a copy that an interrupted `up` leaves behind
    # still has its jobs cleared by the next one.
    stack.dir.mkdir(parents=True, exist_ok=True)
    stack.new_copy.touch()
    meta = snapshot.clone(base, stack.pgdata)
    stack = replace(stack, image=meta["image"], base_created=meta["created"])
    stack.save()
    return stack


# The guard lets this run on copies made before the jobs table existed.
CLEAR_COPIED_JOBS = (
    "DO $$ BEGIN IF to_regclass('public.jobs') IS NOT NULL THEN "
    "DELETE FROM public.jobs; END IF; END $$"
)


def clear_copied_jobs(stack: Stack, creds: Credentials) -> None:
    """Deletes the jobs a new copy brought from the local database, which the
    stack's worker would otherwise claim and run a second time. A stack that
    only restarts keeps the jobs it queued itself."""
    if not stack.new_copy.exists():
        return
    container = compose(stack, creds, "ps", "-q", "db").strip()
    snapshot.psql(container, creds, CLEAR_COPIED_JOBS)
    stack.new_copy.unlink()


def up(start: Path, components: set[str], web: bool, fresh: bool) -> None:
    checkout = find_checkout(start)
    if not checkout.linked:
        raise StackError(
            "otr runs agent stacks in linked worktrees only; the main checkout "
            "keeps its own services from docker-compose.yml"
        )

    env_path = envfile.ensure(checkout.root, checkout.main)
    creds = Credentials.from_env(envfile.parse(env_path.read_text()))
    wanted = set(components) | ({"web"} if web else set())

    root = stacks_root()
    root.mkdir(parents=True, exist_ok=True)
    stack = allocate(root, checkout.root)
    with locked(stack.lock):
        install_dependencies(checkout.root)
        stack = provision(stack, creds, fresh)
        if stack.new_copy.exists() and procs.stop(stack.record("worker")):
            # A worker left running would claim the copied jobs before they
            # are cleared, so it starts again only after that.
            wanted.add("worker")

        monitoring = "monitoring" in wanted or "monitoring" in running_services(
            stack, creds
        )
        managed = managed_env(stack, creds, monitoring)
        envfile.write(env_path, managed)

        services = ["db", *(s for s in SERVICES if s in wanted)]
        print(f"otr: starting {', '.join(services)}")
        compose(stack, creds, "up", "-d", "--wait", "--wait-timeout", "180", *services)
        # Before migrating, so jobs the branch's own migrations queue survive.
        clear_copied_jobs(stack, creds)
        migrate(checkout.root, managed["DATABASE_URL"])
        sync_processes(stack, managed, wanted)

    print()
    describe(stack, creds, current=True)


def dispose(stack: Stack, creds: Credentials) -> None:
    for process in PROCESSES:
        procs.stop(stack.record(process))
    compose(stack, creds, "down", "--volumes", "--remove-orphans", "--timeout", "10")
    if stack.pgdata.exists():
        snapshot.remove(stack.root, stack.image, stack.pgdata)
    shutil.rmtree(stack.dir, ignore_errors=True)


def down(start: Path, components: set[str]) -> None:
    checkout = find_checkout(start)
    stack = find(stacks_root(), checkout.root)
    if stack is None:
        print("otr: this worktree has no stack")
        return

    env_path = checkout.root / ".env"
    creds = Credentials.from_env(
        envfile.parse(env_path.read_text()) if env_path.exists() else {}
    )
    with locked(stack.lock):
        if not components:
            dispose(stack, creds)
            print(
                f"otr: disposed {stack.name}. The worktree's .env still points at "
                "it, so nothing reaches the main checkout's services; `otr up` "
                "makes a new stack."
            )
            return

        for process in PROCESSES:
            if process in components and procs.stop(stack.record(process)):
                print(f"otr: stopped {process}")
        services = [s for s in SERVICES if s in components]
        if services:
            compose(stack, creds, "rm", "--stop", "--force", "--volumes", *services)
            print(f"otr: stopped {', '.join(services)}")
        if "monitoring" in components and env_path.exists():
            managed = managed_env(stack, creds, monitoring=False)
            envfile.write(env_path, managed)
            sync_processes(stack, managed, wanted=set())


def orphans() -> None:
    """Disposes every stack whose worktree no longer exists."""
    disposed = 0
    for stack in load_stacks(stacks_root()):
        if stack.worktree.exists():
            continue
        with locked(stack.lock):
            dispose(stack, Credentials.from_env({}))
        print(f"otr: disposed {stack.name} ({stack.worktree} is gone)")
        disposed += 1
    if not disposed:
        print("otr: no orphaned stacks")


def describe(stack: Stack, creds: Credentials, current: bool = False) -> None:
    ports = stack.ports
    services = running_services(stack, creds)
    alive = {p for p in PROCESSES if procs.load(stack.record(p))}

    def line(component: str, on: bool, detail: str) -> str:
        state = detail if on else f"off   (otr up {component})"
        return f"  {component:<11}{state}"

    base = ""
    if stack.base_created:
        age = datetime.now(UTC) - datetime.fromisoformat(stack.base_created)
        base = f"   copied {age.days}d {age.seconds // 3600}h ago"
    db = "db" in services
    marker = "  (this worktree)" if current else ""
    print(f"{stack.name}{marker}\n  worktree   {stack.worktree}")
    print(
        line(
            "web",
            "web" in alive,
            f"http://{HOST}:{ports.web}   log {stack.log('web')}",
        )
    )
    print(
        f"  db         {HOST}:{ports.db}{base}"
        if db
        else "  db         stopped (otr up)"
    )
    print(
        line(
            "worker",
            "worker" in alive,
            f"health http://{HOST}:{ports.worker_metrics}/health   "
            f"log {stack.log('worker')}",
        )
    )
    print(
        line(
            "monitoring",
            "monitoring" in services,
            f"Grafana http://{HOST}:{ports.grafana}",
        )
    )


def status(start: Path) -> None:
    stacks = load_stacks(stacks_root())
    if not stacks:
        print("otr: no stacks")
        return

    try:
        here = find_checkout(start).root
    except StackError:
        here = None
    creds = Credentials.from_env({})
    for stack in stacks:
        if not stack.worktree.exists():
            print(
                f"{stack.name}\n  orphaned: {stack.worktree} is gone; otr down --orphans"
            )
        else:
            describe(stack, creds, current=stack.worktree == here)
        print()
