"""Temporary Docker infrastructure: network, volume, PostgreSQL, processor."""

import gzip
import re
import secrets
import signal
import subprocess
import threading
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path

from otr_replay.models import ReplayError

POSTGRES_IMAGE = "postgres:17"
CONNECTION_STRING = "postgresql://postgres:password@postgres:5432/postgres"

_ROLE_ERROR = re.compile(r'ERROR:\s+role "[^"]+" does not exist')
_SQL_ERROR = re.compile(r"^(ERROR|FATAL|PANIC):", re.MULTILINE)
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def redact(text: str) -> str:
    return text.replace(":password@", ":****@").replace("PASSWORD=password", "PASSWORD=****")


def require_docker() -> None:
    try:
        _run(["docker", "version", "--format", "{{.Server.Version}}"], timeout=30)
    except ReplayError:
        raise ReplayError(
            "prerequisites", "the Docker daemon is not reachable", "Start Docker and retry."
        ) from None


def pull_image(image: str) -> None:
    _run(["docker", "pull", "--quiet", image], timeout=1800)


def image_digest(image: str) -> str | None:
    """The pulled image's registry digest, e.g. postgres@sha256:…, if one exists."""
    template = "{{range .RepoDigests}}{{println .}}{{end}}"
    digests = _run(["docker", "image", "inspect", "--format", template, image]).split()
    return digests[0] if digests else None


class DockerSandbox:
    """Run-labeled Docker resources, always removed on exit."""

    def __init__(self) -> None:
        self.run_id = secrets.token_hex(4)
        self.label = f"otr-replay.run={self.run_id}"
        self.network = f"otr-replay-{self.run_id}-net"
        self.volume = f"otr-replay-{self.run_id}-data"
        self.db = f"otr-replay-{self.run_id}-db"
        self.processor = f"otr-replay-{self.run_id}-processor"
        self.leftovers: list[str] = []

    def __enter__(self) -> DockerSandbox:
        return self

    def __exit__(self, *exc: object) -> None:
        self.leftovers = self.teardown()

    def start_postgres(self) -> None:
        _run(["docker", "network", "create", "--internal", "--label", self.label, self.network])
        _run(["docker", "volume", "create", "--label", self.label, self.volume])
        _run(
            [
                "docker", "run", "--detach",
                "--name", self.db,
                "--label", self.label,
                "--network", self.network,
                "--network-alias", "postgres",
                "--env", "POSTGRES_USER=postgres",
                "--env", "POSTGRES_PASSWORD=password",
                "--env", "POSTGRES_DB=postgres",
                "--env", "PGDATA=/pgdata",
                "--env", "TZ=UTC",
                "--env", "PGTZ=UTC",
                "--volume", f"{self.volume}:/pgdata",
                POSTGRES_IMAGE,
                "-c", "fsync=off",
                "-c", "synchronous_commit=off",
                "-c", "full_page_writes=off",
            ]
        )  # fmt: skip
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            # -h forces a TCP probe. The entrypoint's initialization-phase server only
            # listens on the unix socket, so a socket probe can pass just before that
            # server shuts down and the real one starts, failing the import.
            ready = subprocess.run(
                ["docker", "exec", self.db, "pg_isready", "-h", "127.0.0.1",
                 "-U", "postgres", "-d", "postgres"],
                capture_output=True,
            )  # fmt: skip
            if ready.returncode == 0:
                return
            state = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Running}}", self.db],
                capture_output=True,
                text=True,
            ).stdout.strip()
            if state != "true":
                logs = subprocess.run(
                    ["docker", "logs", "--tail", "15", self.db], capture_output=True, text=True
                )
                raise ReplayError(
                    "sandbox",
                    "the PostgreSQL container stopped unexpectedly",
                    redact((logs.stdout + logs.stderr).strip()),
                )
            time.sleep(1)
        raise ReplayError("sandbox", "PostgreSQL did not become ready within 120 seconds")

    def import_dump(self, path: Path, on_chunk: Callable[[int, int], None]) -> None:
        process = subprocess.Popen(
            self._psql_argv(on_error_stop=False),
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        tail: deque[str] = deque(maxlen=50)
        unexpected: list[str] = []
        drain = threading.Thread(
            target=self._classify_stderr, args=(process.stderr, tail, unexpected), daemon=True
        )
        drain.start()
        total = path.stat().st_size
        assert process.stdin is not None
        try:
            with path.open("rb") as raw, gzip.GzipFile(fileobj=raw) as stream:
                while chunk := stream.read(1 << 20):
                    process.stdin.write(chunk)
                    on_chunk(raw.tell(), total)
            process.stdin.close()
        except (OSError, EOFError) as err:
            process.kill()
            process.wait()
            drain.join(timeout=10)
            detail = "\n".join(tail) or str(err)
            raise ReplayError("import", "the replica import ended early", redact(detail)) from None
        process.wait()
        drain.join(timeout=10)
        if process.returncode != 0:
            raise ReplayError(
                "import",
                f"psql exited with status {process.returncode}",
                redact("\n".join(tail)),
            )
        if unexpected:
            raise ReplayError(
                "import", "the replica import reported SQL errors", redact(unexpected[0])
            )
        if int(self.psql("SELECT count(*) FROM public.players")) == 0:
            raise ReplayError("import", "the imported replica contains no players")
        self.psql("ANALYZE")

    def psql(self, sql: str, phase: str = "sandbox") -> str:
        return self._psql(self._psql_argv() + ["-c", sql], phase=phase)

    def psql_script(self, sql: str, phase: str = "sandbox") -> str:
        return self._psql(self._psql_argv() + ["-f", "-"], stdin=sql, phase=phase)

    def copy_out(self, sql: str, dest: Path) -> None:
        with dest.open("wb") as file:
            process = subprocess.Popen(
                self._psql_argv() + ["-c", sql], stdout=file, stderr=subprocess.PIPE
            )
            _, stderr = process.communicate()
        if process.returncode != 0:
            raise ReplayError("export", "the ratings export failed", redact(stderr.decode()))

    def run_processor(self, image: str, on_line: Callable[[str], None]) -> None:
        process = subprocess.Popen(
            [
                "docker", "run", "--rm",
                "--name", self.processor,
                "--label", self.label,
                "--network", self.network,
                "--env", f"CONNECTION_STRING={CONNECTION_STRING}",
                # Releases before the jobs table require a RabbitMQ URL and
                # only warn when nothing answers there, so a dead address lets
                # them run. Newer releases ignore it.
                "--env", "RABBITMQ_URL=amqp://guest:guest@127.0.0.1:1",
                "--env", "RUST_LOG=info",
                image,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )  # fmt: skip
        tail: deque[str] = deque(maxlen=40)
        assert process.stdout is not None
        try:
            for line in process.stdout:
                line = _ANSI.sub("", line).rstrip()
                if line:
                    tail.append(line)
                    on_line(line)
            process.wait()
        except BaseException:
            process.kill()
            process.wait()
            raise
        if process.returncode != 0:
            raise ReplayError(
                "processor",
                f"the processor exited with status {process.returncode}",
                redact("\n".join(tail)),
            )

    def teardown(self) -> list[str]:
        previous = [signal.signal(sig, signal.SIG_IGN) for sig in (signal.SIGINT, signal.SIGTERM)]
        try:
            match = ["--filter", f"label={self.label}"]
            listers = (
                (["ps", "-aq", *match], ["rm", "-f"]),
                (["network", "ls", "-q", *match], ["network", "rm"]),
                (["volume", "ls", "-q", *match], ["volume", "rm"]),
            )
            for lister, remover in listers:
                found = _docker_quiet(["docker", *lister])
                if found:
                    _docker_quiet(["docker", *remover, *found])
            leftovers: list[str] = []
            for lister, _ in listers:
                leftovers += _docker_quiet(["docker", *lister])
            return leftovers
        finally:
            for sig, handler in zip((signal.SIGINT, signal.SIGTERM), previous, strict=True):
                signal.signal(sig, handler)

    def _psql_argv(self, on_error_stop: bool = True) -> list[str]:
        stop = "1" if on_error_stop else "0"
        return [
            "docker", "exec", "-i", self.db,
            "psql", "-X", "-q", "-t", "-A",
            "-v", f"ON_ERROR_STOP={stop}",
            "-U", "postgres", "-d", "postgres",
        ]  # fmt: skip

    def _psql(self, argv: list[str], stdin: str | None = None, phase: str = "sandbox") -> str:
        result = subprocess.run(argv, input=stdin, capture_output=True, text=True)
        if result.returncode != 0:
            detail = _first_error(result.stderr) or result.stderr.strip()[-500:]
            raise ReplayError(phase, "a database command failed", redact(detail))
        return result.stdout.strip()

    @staticmethod
    def _classify_stderr(pipe: object, tail: deque[str], unexpected: list[str]) -> None:
        for raw in pipe:  # type: ignore[attr-defined]
            line = raw.decode(errors="replace").rstrip()
            tail.append(line)
            if _SQL_ERROR.match(line) and not _ROLE_ERROR.search(line) and len(unexpected) < 10:
                unexpected.append(line)


def _docker_quiet(argv: list[str]) -> list[str]:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=60).stdout.split()
    except subprocess.TimeoutExpired, OSError:
        return []


def _first_error(stderr: str) -> str:
    for line in stderr.splitlines():
        if re.search(r"\b(ERROR|FATAL|PANIC):", line):
            return line
    return ""


def _run(argv: list[str], timeout: float | None = 300) -> str:
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        raise ReplayError(
            "prerequisites", "the docker command is not installed", "Install Docker and retry."
        ) from None
    except subprocess.TimeoutExpired:
        raise ReplayError("sandbox", f"{redact(' '.join(argv))} timed out") from None
    if result.returncode != 0:
        raise ReplayError(
            "sandbox",
            f"{redact(' '.join(argv))} failed",
            redact(result.stderr.strip()[-500:]),
        )
    return result.stdout.strip()
