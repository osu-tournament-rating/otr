"""Pipeline orchestration."""

import json
import os
import signal
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import httpx

from otr_replay import __version__, output, sql
from otr_replay.console import Ui
from otr_replay.discovery import download_replica
from otr_replay.models import Plan, ReplayError, Report
from otr_replay.output import build_metadata, claim, output_paths, write_atomic
from otr_replay.receipts import ratings_warning, resolve
from otr_replay.sandbox import (
    POSTGRES_IMAGE,
    DockerSandbox,
    image_digest,
    pull_image,
    require_docker,
)

RABBITMQ_NOTE = (
    "Older processor releases warn that RabbitMQ is unreachable, and newer "
    "ones may warn that the replica has no jobs table; either is expected, "
    "as a replay queues no follow-up work."
)


def execute(requested: datetime, ui: Ui, directory: Path) -> Report:
    signal.signal(signal.SIGTERM, _interrupt)
    started = datetime.now(UTC)
    ui.header(requested)
    require_docker()

    with httpx.Client(
        timeout=httpx.Timeout(30.0, read=300.0),
        follow_redirects=True,
        headers={"user-agent": f"otr-replay/{__version__}"},
    ) as client:
        with ui.step("Resolve rating run, replica and processor release") as detail:
            plan = resolve(client, requested)
            detail(f"{plan.replica.name} + {plan.release.label}")
        for warning in plan.warnings:
            ui.warn(warning)
        csv_path, metadata_path = output_paths(requested, directory)
        claim(csv_path, metadata_path)
        try:
            return _replay(client, ui, requested, plan, csv_path, metadata_path, started)
        except BaseException:
            for path in (csv_path, metadata_path):
                if path.exists() and path.stat().st_size == 0:
                    path.unlink()
            raise


def _replay(
    client: httpx.Client,
    ui: Ui,
    requested: datetime,
    plan: Plan,
    csv_path: Path,
    metadata_path: Path,
    started: datetime,
) -> Report:
    replica_ref, release = plan.replica, plan.release
    with tempfile.TemporaryDirectory(prefix="otr-replay-") as workdir:
        with ui.transfer(f"Download {replica_ref.name}") as advance:
            replica = download_replica(client, replica_ref, Path(workdir), advance)
        ui.note(f"SHA-256 verified against published checksum: {replica.sha256}")
        with DockerSandbox() as box:
            with ui.step("Start temporary PostgreSQL"):
                pull_image(POSTGRES_IMAGE)
                postgres_image = image_digest(POSTGRES_IMAGE) or POSTGRES_IMAGE
                box.start_postgres()
            with ui.transfer("Import replica") as advance:
                box.import_dump(replica.path, advance)
            with ui.step(f"Pull processor {release.label}"):
                pull_image(release.image)
            ui.note(RABBITMQ_NOTE)
            with ui.stream(f"Run processor {release.label}") as line:
                box.run_processor(release.image, line)
            with ui.step(f"Reconcile decay to {plan.horizon:%Y-%m-%dT%H:%M:%SZ}") as detail:
                reconciliation = sql.parse_counters(
                    box.psql_script(sql.render_reconcile(plan.horizon), phase="reconcile")
                )
                detail(f"{reconciliation.adjustments_reconciled} adjustments reconciled")
            with ui.step("Export ratings") as detail:
                row_count = _export(box, csv_path)
                detail(f"{row_count} rows")
        if box.leftovers:
            ui.note(f"Warning: Docker resources could not be removed: {', '.join(box.leftovers)}")

    warnings = plan.warnings
    if warning := ratings_warning(plan.receipt, row_count):
        ui.warn(warning)
        warnings += (warning,)

    report = Report(
        requested_at=requested,
        replica=replica,
        release=release,
        reconciliation=reconciliation,
        row_count=row_count,
        started_at=started,
        finished_at=datetime.now(UTC),
        csv_path=csv_path,
        metadata_path=metadata_path,
        csv_sha256=output.sha256_file(csv_path),
        postgres_image=postgres_image,
        source_commit=output.source_commit(),
        receipt=plan.receipt,
        horizon=plan.horizon,
        warnings=warnings,
    )
    write_atomic(metadata_path, json.dumps(build_metadata(report), indent=2) + "\n")
    return report


def _export(box: DockerSandbox, csv_path: Path) -> int:
    part = csv_path.parent / f".{csv_path.name}.part"
    try:
        box.copy_out(sql.EXPORT_SQL, part)
        expected = int(box.psql(sql.ROW_COUNT_SQL))
        with part.open("rb") as file:
            rows = sum(1 for _ in file) - 1
        if rows != expected or rows == 0:
            raise ReplayError("export", f"row count mismatch: database {expected}, CSV {rows}")
        os.replace(part, csv_path)
    finally:
        part.unlink(missing_ok=True)
    return rows


def _interrupt(signum: int, frame: object) -> None:
    raise KeyboardInterrupt
