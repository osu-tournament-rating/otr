import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

import httpx
import pytest

from otr_replay.models import ReplayError
from otr_replay.receipts import (
    parse_receipt_index,
    ratings_warning,
    resolve,
    select_receipt,
)

FIXTURES = Path(__file__).parent / "fixtures"
BUCKET = "https://storage.googleapis.com/otr-public-replica/"


def digest(n: int) -> str:
    return f"sha256:{n:064x}"


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


REPLICAS = [
    "otr-public-replica_2026-05-19T11:50:01Z.gz",
    # The 2026-05-26 run's maintenance window.
    "otr-public-replica_2026-05-26T11:45:01Z.gz",
    # Off schedule, on a Thursday.
    "otr-public-replica_2026-05-28T00:00:29Z.gz",
    # A late archive the day after the 2026-06-02 run, whose own archive failed.
    "otr-public-replica_2026-06-03T23:20:30Z.gz",
    "otr-public-replica_2026-06-09T11:45:01Z.gz",
]


def receipt(started, committed, horizon, n, **changes):
    document = {
        "receipt_version": 1,
        "environment": "production",
        "run_id": f"00000000-0000-4000-8000-{n:012d}",
        "started_at": started,
        "decay_horizon": horizon,
        "committed_at": committed,
        "processor": {
            "release": "2026.05.18",
            "commit": None,
            "image": f"stagecodes/otr-processor@{digest(n)}",
            "requested": "stagecodes/otr-processor:latest",
        },
        "counts": {
            "matches": 100,
            "players": 50,
            "tournaments": 3,
            "ratings": 40 + n,
            "stats_jobs": 1,
        },
        "inferred": {},
    }
    return {**document, **changes}


RECEIPTS = {
    "otr-rating-receipt_2026-05-26T12:00:02Z.json": receipt(
        "2026-05-26T12:00:02.000000Z",
        "2026-05-26T12:02:40.000000Z",
        "2026-05-26T12:00:30.000000Z",
        1,
    ),
    "otr-rating-receipt_2026-06-02T12:00:04Z.json": receipt(
        "2026-06-02T12:00:04.000000Z",
        "2026-06-02T12:03:00.000000Z",
        "2026-06-02T12:01:30.000000Z",
        2,
    ),
    "otr-rating-receipt_2026-06-09T12:00:03Z.json": receipt(
        "2026-06-09T12:00:03.000000Z",
        "2026-06-09T12:03:10.000000Z",
        "2026-06-09T12:01:00.000000Z",
        3,
    ),
}


def index(names):
    # The site percent-encodes the colons of some links, as the real index may.
    links = "\n".join(f"<li><a href={BUCKET}{quote(name)}>{name}</a></li>" for name in names)
    return f"<html><body><ul>{links}</ul></body></html>"


class Site:
    """The public replicas site, GitHub and Docker Hub, recording each request."""

    def __init__(self, receipts=None):
        self.receipts = RECEIPTS if receipts is None else receipts
        self.requested: list[str] = []
        self.releases = json.loads((FIXTURES / "releases.json").read_text())
        self.otr_releases = json.loads((FIXTURES / "otr_releases.json").read_text())
        self.tags = json.loads((FIXTURES / "docker_tags.json").read_text())

    def __call__(self, request):
        url = str(request.url)
        self.requested.append(url)
        if url == "https://data.otr.stagec.net/":
            return httpx.Response(200, text=index([*REPLICAS, *self.receipts, "terms.txt"]))
        if url.startswith(BUCKET):
            name = request.url.path.rsplit("/", 1)[-1]
            if name in self.receipts:
                return httpx.Response(200, json=self.receipts[name])
            return httpx.Response(404)
        if request.url.path == "/repos/osu-tournament-rating/otr-processor/releases":
            return httpx.Response(200, json=self.releases)
        if request.url.path == "/repos/osu-tournament-rating/otr/releases":
            return httpx.Response(200, json=self.otr_releases)
        if request.url.host == "hub.docker.com":
            return httpx.Response(200, json=self.tags)
        return httpx.Response(404)

    def plan(self, requested):
        with httpx.Client(transport=httpx.MockTransport(self)) as client:
            return resolve(client, requested)

    @property
    def guessed(self) -> bool:
        """Whether a release was looked up by publication time."""
        hosts = {httpx.URL(url).host for url in self.requested}
        return bool(hosts & {"api.github.com", "hub.docker.com"})


def test_replays_the_run_that_published_the_ratings_of_the_instant():
    site = Site()

    plan = site.plan(at("2026-06-10T00:00:00"))

    assert plan.receipt.ref.name == "otr-rating-receipt_2026-06-09T12:00:03Z.json"
    assert plan.replica.name == "otr-public-replica_2026-06-09T11:45:01Z.gz"
    # The receipt names the image the run ran, so no release is guessed.
    assert plan.release.image == f"stagecodes/otr-processor@{digest(3)}"
    assert plan.release.tag == "2026.05.18"
    assert not site.guessed
    assert plan.horizon == at("2026-06-09T12:01:00")
    assert plan.warnings == ()


def test_an_off_schedule_replica_never_stands_in_for_a_run():
    # The 2026-06-03 replica holds a day of changes the 2026-06-02 run never
    # read, and the Wednesday decay it never applied, so the replay uses the
    # newest replica from before the run and that run's decay horizon.
    plan = Site().plan(at("2026-06-05T12:00:00"))

    assert plan.receipt.ref.name == "otr-rating-receipt_2026-06-02T12:00:04Z.json"
    assert plan.replica.name == "otr-public-replica_2026-05-28T00:00:29Z.gz"
    assert plan.horizon == at("2026-06-02T12:01:30")
    (warning,) = plan.warnings
    assert "The newest replica before rating run 2026-06-02T12:00:04Z" in warning
    assert "5 days before it started" in warning


def test_an_instant_before_a_run_commits_replays_the_previous_run():
    # The 2026-06-09 run started at 12:00:03 and published at 12:03:10.
    plan = Site().plan(at("2026-06-09T12:01:00"))

    assert plan.receipt.ref.name == "otr-rating-receipt_2026-06-02T12:00:04Z.json"


def test_the_receipt_image_wins_over_newer_published_releases():
    # 2026.08.03 and 2026.08.04 were published before this run, but the run
    # recorded the 2026.05.18 image, as after a failed deploy or a rollback.
    late = receipt(
        "2026-08-11T12:00:03.000000Z",
        "2026-08-11T12:03:00.000000Z",
        "2026-08-11T12:01:00.000000Z",
        7,
    )
    site = Site({"otr-rating-receipt_2026-08-11T12:00:03Z.json": late})

    plan = site.plan(at("2026-08-12T00:00:00"))

    assert plan.release.image == f"stagecodes/otr-processor@{digest(7)}"
    assert not site.guessed


def test_an_instant_no_receipt_covers_chooses_by_publication_time():
    site = Site()

    plan = site.plan(at("2026-05-20T00:00:00"))

    assert plan.receipt is None
    assert plan.replica.name == "otr-public-replica_2026-05-19T11:50:01Z.gz"
    assert plan.release.tag == "2026.05.18"
    assert plan.horizon == at("2026-05-19T11:50:01")
    assert site.guessed
    (warning,) = plan.warnings
    assert warning.startswith("No rating run receipt covers 2026-05-20T00:00:00Z")


def test_a_receipt_more_than_a_week_old_warns_that_a_run_may_lack_one():
    plan = Site().plan(at("2026-06-20T00:00:00"))

    assert plan.receipt.ref.name == "otr-rating-receipt_2026-06-09T12:00:03Z.json"
    (warning,) = plan.warnings
    assert "10 days earlier" in warning
    assert "without a receipt" in warning


def test_a_back_populated_receipt_warns_of_what_was_inferred():
    backfilled = receipt(
        "2026-06-09T12:00:00.000000Z",
        None,
        None,
        3,
        run_id=None,
        counts=None,
        inferred={
            "started_at": "the weekly schedule, Tuesdays 12:00 UTC",
            "processor": "the image latest named then",
        },
    )
    site = Site({"otr-rating-receipt_2026-06-09T12:00:00Z.json": backfilled})

    plan = site.plan(at("2026-06-10T00:00:00"))

    assert plan.receipt.inferred.keys() == {"started_at", "processor"}
    # Without a recorded decay horizon or commit, the start stands in for both.
    assert plan.horizon == at("2026-06-09T12:00:00")
    assert plan.receipt.ratings is None
    (warning,) = plan.warnings
    assert "back-populated" in warning
    assert "started_at, processor" in warning


def test_a_receipt_without_an_image_chooses_the_release_by_publication_time():
    unknown = receipt(
        "2026-06-09T12:00:03.000000Z",
        "2026-06-09T12:03:10.000000Z",
        None,
        3,
        processor={"release": None, "commit": None, "image": None, "requested": None},
    )
    site = Site({"otr-rating-receipt_2026-06-09T12:00:03Z.json": unknown})

    plan = site.plan(at("2026-06-10T00:00:00"))

    assert plan.release.tag == "2026.05.18"
    assert site.guessed
    (warning,) = plan.warnings
    assert "names no processor image" in warning


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"receipt_version": 2}, "version 2 receipt"),
        (
            {"processor": {"image": "stagecodes/otr-processor:latest"}},
            "is not a valid receipt",
        ),
        ({"started_at": None}, "is not a valid receipt"),
    ],
)
def test_a_receipt_this_replay_cannot_read_stops_it(changes, message):
    broken = {**RECEIPTS["otr-rating-receipt_2026-06-09T12:00:03Z.json"], **changes}
    site = Site({"otr-rating-receipt_2026-06-09T12:00:03Z.json": broken})

    with pytest.raises(ReplayError) as exc:
        site.plan(at("2026-06-10T00:00:00"))

    assert exc.value.phase == "discovery"
    assert message in exc.value.message


def test_select_receipt_reads_only_receipts_it_needs():
    site = Site()
    refs = parse_receipt_index(index(RECEIPTS))
    assert [ref.name for ref in refs] == sorted(RECEIPTS, reverse=True)

    with httpx.Client(transport=httpx.MockTransport(site)) as client:
        chosen = select_receipt(client, refs, at("2026-06-05T00:00:00"))

    assert chosen.ref.name == "otr-rating-receipt_2026-06-02T12:00:04Z.json"
    # The later run started after the instant, so only one receipt is read.
    assert [url for url in site.requested if url.startswith(BUCKET)] == [
        BUCKET + quote("otr-rating-receipt_2026-06-02T12:00:04Z.json")
    ]


def test_ratings_warning_compares_the_replay_with_the_run():
    # The 2026-06-09 run published 43 ratings.
    run = Site().plan(at("2026-06-10T00:00:00")).receipt

    assert ratings_warning(run, 43) is None
    assert ratings_warning(run, 42).startswith(
        "The replay produced 42 ratings, but rating run 2026-06-09T12:00:03Z published 43"
    )
