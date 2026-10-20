"""Interactive progress display."""

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime

from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    DownloadColumn,
    Progress,
    TextColumn,
    TimeRemainingColumn,
    TransferSpeedColumn,
)
from rich.table import Table

from otr_replay.models import ReplayError, Report
from otr_replay.sandbox import redact


class Ui:
    def __init__(self) -> None:
        self.console = Console()

    def header(self, requested: datetime) -> None:
        self.console.print(f"[dim]Requested:[/dim] {requested:%Y-%m-%dT%H:%M:%SZ}")

    @contextmanager
    def step(self, label: str) -> Iterator[Callable[[str], None]]:
        start = time.monotonic()
        status = self.console.status(f"{label}…")
        status.start()

        def detail(text: str) -> None:
            width = max(self.console.width - len(label) - 8, 20)
            status.update(f"{label}: {redact(text)[:width]}")

        try:
            yield detail
        except BaseException:
            status.stop()
            self.console.print(f"[red]✘[/] {label}")
            raise
        status.stop()
        self.console.print(f"[green]✔[/] {label} [dim]({time.monotonic() - start:.1f}s)[/dim]")

    @contextmanager
    def transfer(self, label: str) -> Iterator[Callable[[int, int], None]]:
        progress = Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            TimeRemainingColumn(),
            console=self.console,
        )
        with progress:
            task = progress.add_task(label, total=None)

            def advance(completed: int, total: int) -> None:
                progress.update(task, completed=completed, total=total or None)

            try:
                yield advance
            except BaseException:
                progress.stop()
                self.console.print(f"[red]✘[/] {label}")
                raise
        self.console.print(f"[green]✔[/] {label}")

    @contextmanager
    def stream(self, label: str) -> Iterator[Callable[[str], None]]:
        """Like step(), but every reported line stays visible on the console."""
        start = time.monotonic()
        self.console.print(f"{label}…")

        def line(text: str) -> None:
            self.console.print(redact(text), style="dim", markup=False, highlight=False)

        try:
            yield line
        except BaseException:
            self.console.print(f"[red]✘[/] {label}")
            raise
        self.console.print(f"[green]✔[/] {label} [dim]({time.monotonic() - start:.1f}s)[/dim]")

    def note(self, text: str) -> None:
        self.console.print(f"[dim]{text}[/dim]")

    def warn(self, text: str) -> None:
        self.console.print(f"[yellow]Warning:[/yellow] {text}", markup=True, highlight=False)

    def summary(self, report: Report) -> None:
        grid = Table.grid(padding=(0, 2))
        rows = [
            ("Ratings CSV", str(report.csv_path)),
            ("Metadata", str(report.metadata_path)),
            ("Rows exported", f"{report.row_count:,}"),
            ("Decay reconciled", f"{report.reconciliation.adjustments_reconciled:,}"),
            ("Rating run", report.receipt.ref.name if report.receipt else "no receipt"),
            ("Replica", report.replica.ref.name),
            ("Replica checksum", "verified"),
            ("Processor", f"{report.release.label} ({report.release.digest[:19]}…)"),
            ("Warnings", str(len(report.warnings))),
            ("Elapsed", str(report.finished_at - report.started_at).split(".")[0]),
        ]
        for name, value in rows:
            grid.add_row(f"[bold]{name}[/bold]", value)
        self.console.print(Panel(grid, title="Replay complete", border_style="green"))

    def failure(self, error: ReplayError) -> None:
        body = redact(error.message) + (
            f"\n\n[dim]{redact(error.hint)}[/dim]" if error.hint else ""
        )
        self.console.print(Panel(body, title=f"{error.phase} failed", border_style="red"))

    def interrupted(self) -> None:
        self.console.print("[yellow]Interrupted. Temporary resources were removed.[/yellow]")
