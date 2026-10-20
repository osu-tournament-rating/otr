import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from otr_replay.discovery import (
    PROCESSOR_REPOSITORIES,
    _get,
    _parse_utc,
    download_replica,
    fetch_releases,
    merge_releases,
    parse_index,
    select_release,
    select_replica,
    tag_key,
)
from otr_replay.models import ReplayError, ReplicaRef

FIXTURES = Path(__file__).parent / "fixtures"
OTR_PROCESSOR = "osu-tournament-rating/otr-processor"
OTR = "osu-tournament-rating/otr"


@pytest.fixture
def replicas():
    return parse_index((FIXTURES / "index.html").read_text())


@pytest.fixture
def releases():
    return json.loads((FIXTURES / "releases.json").read_text())


@pytest.fixture
def web_releases():
    return json.loads((FIXTURES / "otr_releases.json").read_text())


@pytest.fixture
def merged(releases, web_releases):
    return merge_releases({OTR_PROCESSOR: releases, OTR: web_releases})


@pytest.fixture
def tags():
    return json.loads((FIXTURES / "docker_tags.json").read_text())["results"]


def test_parse_index_reads_iso_names_and_skips_companions_and_legacy(replicas):
    names = [ref.name for ref in replicas]
    assert names == [
        "otr-public-replica_2026-08-04T11:45:01Z.gz",
        "otr-public-replica_2026-07-28T11:45:01Z.gz",
        "otr-public-replica_2026-06-03T23:20:30Z.gz",
        "otr-public-replica_2026-05-28T00:00:29Z.gz",
        "otr-public-replica_2026-05-16T03:13:48Z.gz",
        "otr-public-replica_2026-05-12T11:50:01Z.gz",
    ]
    # The newest entry's href percent-encodes the colons; the name is decoded.
    assert replicas[0].timestamp == datetime(2026, 8, 4, 11, 45, 1, tzinfo=UTC)
    assert replicas[0].url.endswith("/otr-public-replica_2026-08-04T11%3A45%3A01Z.gz")
    assert replicas[5].timestamp == datetime(2026, 5, 12, 11, 50, 1, tzinfo=UTC)
    assert replicas[0].url.startswith("https://storage.googleapis.com/otr-public-replica/")


def test_select_replica_picks_newest_at_or_before_instant(replicas):
    instant = datetime(2026, 7, 28, 12, 0, tzinfo=UTC)
    assert select_replica(replicas, instant).name == "otr-public-replica_2026-07-28T11:45:01Z.gz"


def test_select_replica_includes_off_cadence_dumps(replicas):
    # A dump published late (Wednesday 23:20) must be picked for a later --as-of.
    cutoff = datetime(2026, 6, 5, 12, 0, tzinfo=UTC)
    assert select_replica(replicas, cutoff).name == "otr-public-replica_2026-06-03T23:20:30Z.gz"


def test_select_replica_fails_when_none_exist_before_instant(replicas):
    with pytest.raises(ReplayError) as exc:
        select_replica(replicas, datetime(2025, 1, 1, tzinfo=UTC))
    assert exc.value.phase == "discovery"


def test_select_release_requires_github_and_docker_and_usable_at(releases, tags):
    instant = datetime(2026, 8, 4, 12, 0, tzinfo=UTC)
    release = select_release(releases, tags, instant)
    # 2026.08.04 was pushed 23:45, after the instant, so 2026.08.03 wins.
    assert release.tag == "2026.08.03"
    assert release.image == (
        "stagecodes/otr-processor@"
        "sha256:ee6afe78229a90000000000000000000000000000000000000000000000000bb"
    )
    assert release.usable_at == datetime(2026, 8, 3, 23, 8, 19, 220696, tzinfo=UTC)


def test_select_release_ignores_github_only_and_non_stable_tags(releases, tags):
    # 2025.06.08 exists on GitHub only; prereleases and v1.0.0 never qualify.
    with pytest.raises(ReplayError) as exc:
        select_release(releases, tags, datetime(2026, 1, 1, tzinfo=UTC))
    assert "2026.05.18" in exc.value.hint


def test_select_release_picks_latest_usable(releases, tags):
    release = select_release(releases, tags, datetime(2026, 8, 5, 12, 0, tzinfo=UTC))
    assert release.tag == "2026.08.04"


def test_release_is_bounded_by_the_replica_not_the_request(replicas, releases, tags):
    # 2026.08.04 shipped roughly 12 hours after the 2026-08-04T11:45:01Z replica was
    # taken, so a request dated after that release must still replay with 2026.08.03.
    requested = datetime(2026, 8, 8, tzinfo=UTC)
    replica = select_replica(replicas, requested)
    assert replica.name == "otr-public-replica_2026-08-04T11:45:01Z.gz"
    assert select_release(releases, tags, replica.timestamp).tag == "2026.08.03"
    # Bounding by the request would have picked a release the replica never saw.
    assert select_release(releases, tags, requested).tag == "2026.08.04"


@pytest.mark.parametrize(
    ("tag", "key"),
    [
        ("2026.10.04", (2026, 10, 4, 0)),
        ("2026.10.04.1", (2026, 10, 4, 1)),
        ("2026.10.04.10", (2026, 10, 4, 10)),
        ("2025.06.08", (2025, 6, 8, 0)),
    ],
)
def test_tag_key_accepts_dates_with_and_without_a_same_day_suffix(tag, key):
    assert tag_key(tag) == key


@pytest.mark.parametrize(
    "tag",
    ["v1.0.0", "2025.06.01-rc1", "latest", "staging", "2026.10.4", "2026.10.04.", "2026.10.04.x"],
)
def test_tag_key_rejects_other_tags(tag):
    assert tag_key(tag) is None


def test_tag_key_orders_same_day_releases_numerically():
    ordered = ["2026.10.04", "2026.10.04.2", "2026.10.04.10", "2026.10.05"]
    assert sorted(reversed(ordered), key=tag_key) == ordered
    # String order puts .10 before .2.
    assert max(["2026.10.04.2", "2026.10.04.10"]) == "2026.10.04.2"


@pytest.mark.parametrize(
    ("cutoff", "expected"),
    [
        (datetime(2026, 10, 4, 12, 0, tzinfo=UTC), "2026.08.16"),
        (datetime(2026, 10, 4, 12, 30, tzinfo=UTC), "2026.10.04"),
        (datetime(2026, 10, 4, 13, 0, tzinfo=UTC), "2026.10.04.2"),
        (datetime(2026, 10, 5, tzinfo=UTC), "2026.10.04.10"),
    ],
)
def test_select_release_orders_same_day_releases_numerically(merged, tags, cutoff, expected):
    assert select_release(merged, tags, cutoff).tag == expected


def test_select_release_reads_otr_releases(merged, tags):
    release = select_release(merged, tags, datetime(2026, 10, 5, tzinfo=UTC))
    assert release.tag == "2026.10.04.10"
    assert release.repository == OTR
    assert release.html_url == (
        "https://github.com/osu-tournament-rating/otr/releases/tag/2026.10.04.10"
    )
    assert release.image == (
        "stagecodes/otr-processor@"
        "sha256:9a1c37e04b5d10000000000000000000000000000000000000000000000000a3"
    )
    # otr tags the image before it publishes the release.
    assert release.usable_at == datetime(2026, 10, 4, 18, 20, 5, tzinfo=UTC)


@pytest.mark.parametrize(
    ("cutoff", "expected"),
    [
        # 2026.09.01 changed only the website, so 2026.08.16 stays in effect.
        (datetime(2026, 9, 2, tzinfo=UTC), "2026.08.16"),
        # 2026.10.08 has no image and 2026.10.07 is a draft.
        (datetime(2026, 10, 9, tzinfo=UTC), "2026.10.04.10"),
    ],
)
def test_select_release_ignores_releases_without_a_processor_image(merged, tags, cutoff, expected):
    assert select_release(merged, tags, cutoff).tag == expected


def test_merge_releases_keeps_the_otr_processor_entry_for_a_shared_tag(merged):
    shared = [entry for entry in merged if entry["tag_name"] == "2026.08.16"]
    assert len(shared) == 1
    assert shared[0]["repository"] == OTR_PROCESSOR
    assert shared[0]["published_at"] == "2026-08-16T17:49:59Z"
    assert [entry["tag_name"] for entry in merged].count("2026.05.18") == 1
    assert {entry["repository"] for entry in merged} == {OTR_PROCESSOR, OTR}


def test_shared_tag_is_usable_from_the_otr_processor_publication(
    releases, web_releases, merged, tags
):
    # The image was pushed 17:53:28 and otr-processor published 17:49:59; the
    # otr release of the same name followed at 17:53:50.
    cutoff = datetime(2026, 8, 16, 17, 53, 40, tzinfo=UTC)
    release = select_release(merged, tags, cutoff)
    assert release.tag == "2026.08.16"
    assert release.repository == OTR_PROCESSOR
    assert release.html_url.startswith("https://github.com/osu-tournament-rating/otr-processor/")
    assert release.usable_at == datetime(2026, 8, 16, 17, 53, 28, 256844, tzinfo=UTC)
    # Had the otr entry won, the release would not be usable yet.
    web_first = merge_releases({OTR: web_releases, OTR_PROCESSOR: releases})
    assert select_release(web_first, tags, cutoff).tag == "2026.08.04"


@pytest.mark.parametrize(
    ("cutoff", "expected"),
    [
        (datetime(2026, 8, 4, 12, 0, tzinfo=UTC), "2026.08.03"),
        (datetime(2026, 8, 4, 11, 45, 1, tzinfo=UTC), "2026.08.03"),
        (datetime(2026, 8, 5, 12, 0, tzinfo=UTC), "2026.08.04"),
        (datetime(2026, 8, 8, tzinfo=UTC), "2026.08.04"),
        (datetime(2026, 5, 19, tzinfo=UTC), "2026.05.18"),
    ],
)
def test_otr_releases_leave_earlier_selections_unchanged(releases, merged, tags, cutoff, expected):
    processor_only = merge_releases({OTR_PROCESSOR: releases})
    assert select_release(merged, tags, cutoff) == select_release(processor_only, tags, cutoff)
    assert select_release(merged, tags, cutoff).tag == expected


def test_otr_releases_leave_the_earliest_usable_release_unchanged(merged, tags):
    with pytest.raises(ReplayError) as exc:
        select_release(merged, tags, datetime(2026, 1, 1, tzinfo=UTC))
    assert "2026.05.18" in exc.value.hint


def test_fetch_releases_pages_through_both_repositories(releases, web_releases):
    assert PROCESSOR_REPOSITORIES == (OTR_PROCESSOR, OTR)
    page_two = "https://api.github.com/repositories/1/releases?per_page=100&page=2"
    requested: list[str] = []

    def handler(request):
        requested.append(str(request.url))
        assert request.headers["accept"] == "application/vnd.github+json"
        if str(request.url) == page_two:
            return httpx.Response(200, json=releases[3:])
        if request.url.path == f"/repos/{OTR_PROCESSOR}/releases":
            return httpx.Response(
                200, json=releases[:3], headers={"link": f'<{page_two}>; rel="next"'}
            )
        if request.url.path == f"/repos/{OTR}/releases":
            return httpx.Response(200, json=web_releases)
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        fetched = fetch_releases(client)
    assert requested == [
        f"https://api.github.com/repos/{OTR_PROCESSOR}/releases?per_page=100",
        page_two,
        f"https://api.github.com/repos/{OTR}/releases?per_page=100",
    ]
    by_tag = {entry["tag_name"]: entry["repository"] for entry in fetched}
    assert len(fetched) == len(by_tag)
    assert by_tag["2025.06.08"] == OTR_PROCESSOR  # from the second page
    assert by_tag["2026.08.16"] == OTR_PROCESSOR
    assert by_tag["2026.10.04.10"] == OTR


def _download(tmp_path, handler):
    ref = ReplicaRef(
        name="otr-public-replica_2025-10-06T21:13:57Z.gz",
        url="https://example.test/otr-public-replica_2025-10-06T21%3A13%3A57Z.gz",
        timestamp=datetime(2025, 10, 6, 21, 13, 57, tzinfo=UTC),
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        replica = download_replica(client, ref, tmp_path, lambda done, total: None)
    assert replica.sha256 == hashlib.sha256(b"dump-bytes").hexdigest()
    return replica


def test_download_replica_verifies_published_checksum(tmp_path):
    digest = hashlib.sha256(b"dump-bytes").hexdigest()

    def handler(request):
        if request.url.path.endswith(".sha256"):
            return httpx.Response(
                200, text=f"{digest} *otr-public-replica_2025-10-06T21:13:57Z.gz\n"
            )
        return httpx.Response(200, content=b"dump-bytes")

    _download(tmp_path, handler)


def test_download_replica_writes_a_windows_safe_local_filename(tmp_path):
    digest = hashlib.sha256(b"dump-bytes").hexdigest()

    def handler(request):
        if request.url.path.endswith(".sha256"):
            return httpx.Response(
                200, text=f"{digest} *otr-public-replica_2025-10-06T21:13:57Z.gz\n"
            )
        return httpx.Response(200, content=b"dump-bytes")

    replica = _download(tmp_path, handler)
    # Colons are illegal in Windows file names; only the remote name keeps them.
    assert ":" not in replica.path.name
    assert replica.path.parent == tmp_path
    assert replica.path.is_file()
    assert replica.ref.name == "otr-public-replica_2025-10-06T21:13:57Z.gz"


def test_download_replica_fails_when_checksum_is_missing(tmp_path):
    def handler(request):
        if request.url.path.endswith(".sha256"):
            return httpx.Response(404)
        return httpx.Response(200, content=b"dump-bytes")

    with pytest.raises(ReplayError) as exc:
        _download(tmp_path, handler)
    assert "could not be fetched" in exc.value.message


def test_download_replica_fails_on_checksum_mismatch(tmp_path):
    def handler(request):
        if request.url.path.endswith(".sha256"):
            return httpx.Response(
                200, text=f"{'0' * 64}  otr-public-replica_2025-10-06T21:13:57Z.gz\n"
            )
        return httpx.Response(200, content=b"dump-bytes")

    with pytest.raises(ReplayError) as exc:
        _download(tmp_path, handler)
    assert "mismatch" in exc.value.message


def test_parse_utc_treats_missing_offset_as_utc():
    assert _parse_utc("2026-08-04T23:41:47") == datetime(2026, 8, 4, 23, 41, 47, tzinfo=UTC)
    assert _parse_utc("2026-08-04T23:41:47+02:00") == datetime(2026, 8, 4, 21, 41, 47, tzinfo=UTC)


def test_get_retries_transient_failures_with_backoff(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr("otr_replay.discovery.time.sleep", sleeps.append)
    statuses = iter([503, 429, 200])

    with httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(next(statuses)))
    ) as client:
        assert _get(client, "https://example.test/").status_code == 200
    assert sleeps == [0, 1, 2]


def test_get_reports_exhausted_rate_limits(monkeypatch):
    monkeypatch.setattr("otr_replay.discovery.time.sleep", lambda _: None)

    def handler(request):
        return httpx.Response(403, headers={"x-ratelimit-remaining": "0"})

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
        pytest.raises(ReplayError) as exc,
    ):
        _get(client, "https://api.github.com/repos/o/r/releases")
    assert "rate limit is exhausted" in exc.value.message


def test_select_release_counts_inactive_docker_tags(releases, tags):
    # Docker Hub marks a tag inactive after a month without a push or pull, and
    # the image still pulls, so 2026.08.04 stays the release in effect.
    stale = [
        {**tag, "tag_status": "inactive"} if tag["name"] == "2026.08.04" else tag for tag in tags
    ]

    release = select_release(releases, stale, datetime(2026, 8, 5, 12, 0, tzinfo=UTC))

    assert release.tag == "2026.08.04"
