"""The shared base copy of the local o!TR database, and each stack's clone of it.

The base is an online `pg_basebackup` of the PostgreSQL container published on
localhost:5432. Taking it only reads from that server, so the developer's own
database and anything connected to it keep running. Every stack then gets its
own copy of the base's data directory, made with `cp --reflink=auto`. On a
copy-on-write filesystem such as btrfs or XFS that copy takes about a second
and shares disk blocks with the base until either side changes them. Elsewhere
it falls back to a full copy, which is slower but still works.

The data files belong to the postgres user inside the container, so every file
operation runs in a throwaway container built from the source's own image.
"""

import json
import subprocess
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from lib.stack.common import StackError, locked, run

SOURCE_PORT = 5432
PREP_CONTAINER = "otr-stack-base-prep"


@dataclass(frozen=True)
class Credentials:
    pg_user: str
    pg_password: str
    pg_db: str

    @classmethod
    def from_env(cls, values: dict[str, str]) -> Credentials:
        # The base keeps the source's roles and passwords, so the same
        # credentials that reach the main database reach every clone.
        return cls(
            values.get("DOCKER_POSTGRES_USER") or "postgres",
            values.get("DOCKER_POSTGRES_PASSWORD") or "password",
            values.get("DOCKER_POSTGRES_DB") or "postgres",
        )


@dataclass(frozen=True)
class Base:
    root: Path

    @property
    def pgdata(self) -> Path:
        return self.root / "base" / "pgdata"

    @property
    def meta_path(self) -> Path:
        return self.root / "base" / "meta.json"

    @property
    def lock_path(self) -> Path:
        return self.root / "base.lock"

    def meta(self) -> dict | None:
        try:
            return json.loads(self.meta_path.read_text())
        except FileNotFoundError:
            return None


def helper(root: Path, image: str, *command: str) -> list[str]:
    """A root shell in the source's image with the stacks directory at
    /stacks. Base and clones share that single mount, because the kernel
    refuses to reflink across two separate mounts."""
    return [
        "docker",
        "run",
        "--rm",
        "--mount",
        f"type=bind,src={root},dst=/stacks",
        image,
        *command,
    ]


def source_container() -> str:
    names = run(
        ["docker", "ps", "--filter", f"publish={SOURCE_PORT}", "--format", "{{.Names}}"]
    ).split()
    if len(names) != 1:
        raise StackError(
            f"Expected one running container publishing port {SOURCE_PORT}, found "
            f"{len(names)}; start the main checkout's database with "
            "`docker compose up -d db`"
        )
    return names[0]


def container_port(container: str) -> str:
    """The container-side port behind host port 5432."""
    for line in run(["docker", "port", container]).splitlines():
        inside, _, outside = line.partition(" -> ")
        if outside.rsplit(":", 1)[-1] == str(SOURCE_PORT):
            return inside.split("/", 1)[0]
    raise StackError(f"{container} does not publish port {SOURCE_PORT}")


def psql(container: str, creds: Credentials, sql: str, db: str | None = None) -> str:
    return run(
        [
            "docker",
            "exec",
            "-e",
            "PGPASSWORD",
            container,
            "psql",
            "-h",
            "127.0.0.1",
            "-U",
            creds.pg_user,
            "-d",
            db or creds.pg_db,
            "-Aqt",
            "--no-psqlrc",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            sql,
        ],
        env={"PGPASSWORD": creds.pg_password},
    ).strip()


def check_source(container: str, creds: Credentials) -> str:
    """Confirms the source is an o!TR database and returns its image."""
    image = run(["docker", "inspect", "-f", "{{.Config.Image}}", container]).strip()
    if not image.split("/")[-1].startswith("postgres:"):
        raise StackError(f"{container} runs {image}, not PostgreSQL; nothing copied")
    found = psql(
        container,
        creds,
        "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL "
        "AND to_regclass('public.players') IS NOT NULL",
    )
    if found != "t":
        raise StackError(
            f"{creds.pg_db} on {container} is not an o!TR database; nothing copied"
        )
    return image


def wait_ready(container: str, timeout: float = 120) -> None:
    deadline = time.monotonic() + timeout
    while True:
        ready = subprocess.run(
            ["docker", "exec", container, "pg_isready", "-q", "-h", "127.0.0.1"],
            check=False,
        )
        if ready.returncode == 0:
            return
        if time.monotonic() > deadline:
            raise StackError(f"{container} was not ready after {timeout:.0f}s")
        time.sleep(0.5)


def prepare(root: Path, image: str, creds: Credentials, staged: str) -> None:
    """Starts the fresh backup once so it finishes recovery, drops every other
    database, and shuts it down cleanly. Clones then start in under a second
    and hold only the application database."""
    subprocess.run(
        ["docker", "rm", "-f", PREP_CONTAINER], capture_output=True, check=False
    )
    run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            PREP_CONTAINER,
            "--mount",
            f"type=bind,src={root / staged / 'pgdata'},dst=/var/lib/postgresql/data",
            image,
            "postgres",
            "-c",
            "fsync=off",
        ]
    )
    try:
        wait_ready(PREP_CONTAINER)
        others = psql(
            PREP_CONTAINER,
            creds,
            "SELECT datname FROM pg_database WHERE NOT datistemplate "
            f"AND datname <> '{creds.pg_db}'",
        ).split()
        for name in others:
            psql(PREP_CONTAINER, creds, f'DROP DATABASE "{name}" WITH (FORCE)')
        oids = psql(PREP_CONTAINER, creds, "SELECT oid FROM pg_database").split()
        psql(PREP_CONTAINER, creds, "CHECKPOINT")
    finally:
        # The image stops on SIGINT, PostgreSQL's fast and clean shutdown.
        subprocess.run(
            ["docker", "stop", PREP_CONTAINER], capture_output=True, check=False
        )
        subprocess.run(
            ["docker", "rm", "-f", PREP_CONTAINER], capture_output=True, check=False
        )

    # A crashed CREATE or DROP DATABASE on the source can leave a directory
    # that no database owns. The backup copies it, so remove it here.
    directory = f"/stacks/{staged}/pgdata/base"
    present = run(helper(root, image, "ls", directory)).split()
    orphans = [f"{directory}/{oid}" for oid in present if oid not in oids]
    if orphans:
        run(helper(root, image, "rm", "-rf", *orphans))


def refresh(base: Base, creds: Credentials) -> dict:
    """Builds a new base beside the current one, then swaps it in. Stacks
    already cloned keep their own copies and are unaffected."""
    container = source_container()
    image = check_source(container, creds)
    port = container_port(container)
    root = base.root
    staged = "base.new"
    print(f"otr: copying {creds.pg_db} from {container} into the shared base")

    started = time.monotonic()
    run(helper(root, image, "rm", "-rf", f"/stacks/{staged}"))
    (root / staged).mkdir()
    # Joining the source's network namespace connects over its loopback,
    # which the official image trusts for replication.
    run(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            f"container:{container}",
            "-e",
            "PGPASSWORD",
            "--mount",
            f"type=bind,src={root},dst=/stacks",
            image,
            "pg_basebackup",
            "-h",
            "127.0.0.1",
            "-p",
            port,
            "-U",
            creds.pg_user,
            "-D",
            f"/stacks/{staged}/pgdata",
            "-X",
            "stream",
            "-c",
            "fast",
        ],
        env={"PGPASSWORD": creds.pg_password},
    )
    prepare(root, image, creds, staged)

    meta = {
        "source": container,
        "image": image,
        "database": creds.pg_db,
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    (root / staged / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")

    retired = f"base.old-{int(time.time())}"
    if (root / "base").exists():
        (root / "base").rename(root / retired)
    (root / staged).rename(root / "base")
    run(helper(root, image, "rm", "-rf", f"/stacks/{retired}"))
    print(f"otr: base ready in {time.monotonic() - started:.0f}s")
    return meta


def ensure(base: Base, creds: Credentials, force: bool) -> dict:
    with locked(base.lock_path):
        meta = base.meta()
        if meta is None or force:
            meta = refresh(base, creds)
        return meta


def clone(base: Base, target: Path) -> dict:
    """Copies the base data directory to `target` (a directory under the
    stacks root). The shared lock stops a refresh from swapping the base
    mid-copy."""
    with locked(base.lock_path, shared=True):
        meta = base.meta()
        if meta is None:
            raise StackError("The shared base disappeared; run `otr up --fresh`")
        relative = target.relative_to(base.root)
        run(
            helper(
                base.root,
                meta["image"],
                "cp",
                "-a",
                "--reflink=auto",
                "/stacks/base/pgdata",
                f"/stacks/{relative}",
            )
        )
        return meta


def remove(root: Path, image: str, target: Path) -> None:
    relative = target.relative_to(root)
    run(helper(root, image, "rm", "-rf", f"/stacks/{relative}"))
