"""Finds and fetches the public replica and the processor release."""

import hashlib
import re
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

import httpx

from otr_replay.models import Release, ReplayError, Replica, ReplicaRef

DATA_SITE = "https://data.otr.stagec.net/"
RELEASES_URL = "https://api.github.com/repos/{repository}/releases"
TAGS_URL = "https://hub.docker.com/v2/repositories/stagecodes/otr-processor/tags"
# Repositories whose releases may be processor releases, in precedence order: when
# both have a release with the same tag, the earlier repository's entry wins.
PROCESSOR_REPOSITORIES = (
    # The processor's former repository. Its releases, through 2026.08.16, are history.
    "osu-tournament-rating/otr-processor",
    # The processor has lived in apps/processor since 2026-10-08. Some older website
    # releases share a tag with an otr-processor release, such as 2026.08.16; the
    # Docker tag of that name is the processor's, so otr-processor comes first.
    "osu-tournament-rating/otr",
)

_REPLICA_NAME = re.compile(
    r"^otr-public-replica_(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z\.gz$"
)
# YYYY.MM.DD for the first release of a day, YYYY.MM.DD.N for later ones that day.
_STABLE_TAG = re.compile(r"(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?")


class _Anchors(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self.hrefs.extend(value for name, value in attrs if name == "href" and value)


def parse_replica_timestamp(name: str) -> datetime | None:
    match = _REPLICA_NAME.match(name)
    if match is None:
        return None
    try:
        return datetime(*map(int, match.groups()), tzinfo=UTC)
    except ValueError:
        return None


def parse_index(html: str) -> list[ReplicaRef]:
    parser = _Anchors()
    parser.feed(html)
    refs = []
    for href in parser.hrefs:
        # Colons in ISO 8601 names may arrive percent-encoded in hrefs.
        name = unquote(href.rsplit("/", 1)[-1])
        timestamp = parse_replica_timestamp(name)
        if timestamp is not None:
            refs.append(ReplicaRef(name=name, url=href, timestamp=timestamp))
    return sorted(refs, key=lambda ref: ref.timestamp, reverse=True)


def select_replica(refs: Sequence[ReplicaRef], cutoff: datetime) -> ReplicaRef:
    eligible = [ref for ref in refs if ref.timestamp <= cutoff]
    if not eligible:
        oldest = min((ref.timestamp for ref in refs), default=None)
        raise ReplayError(
            "discovery",
            f"no public replica exists at or before {cutoff:%Y-%m-%dT%H:%M:%SZ}",
            (
                f"The oldest published replica is dated {oldest:%Y-%m-%dT%H:%M:%SZ}; "
                "choose a later --as-of."
                if oldest
                else "The public replica index is empty."
            ),
        )
    return eligible[0]


def discover_replicas(client: httpx.Client) -> list[ReplicaRef]:
    refs = parse_index(_get(client, DATA_SITE).text)
    if not refs:
        raise ReplayError("discovery", f"no replicas found at {DATA_SITE}")
    return refs


def fetch_releases(client: httpx.Client) -> list[dict]:
    return merge_releases(
        {repo: _fetch_github_releases(client, repo) for repo in PROCESSOR_REPOSITORIES}
    )


def merge_releases(sources: Mapping[str, Iterable[dict]]) -> list[dict]:
    """Merge GitHub releases keyed by repository, given in precedence order.

    Each entry gains a "repository" key. When several repositories have a release
    with the same tag, only the first repository's entry is kept.
    """
    merged: dict[str, dict] = {}
    for repository, releases in sources.items():
        for entry in releases:
            merged.setdefault(entry["tag_name"], {**entry, "repository": repository})
    return list(merged.values())


def _fetch_github_releases(client: httpx.Client, repository: str) -> list[dict]:
    headers = {"accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28"}
    releases: list[dict] = []
    url: str | None = f"{RELEASES_URL.format(repository=repository)}?per_page=100"
    for _ in range(10):
        if url is None:
            break
        response = _get(client, url, headers=headers)
        releases.extend(response.json())
        url = response.links.get("next", {}).get("url")
    return releases


def fetch_tags(client: httpx.Client) -> list[dict]:
    tags: list[dict] = []
    url: str | None = f"{TAGS_URL}?page_size=100"
    for _ in range(10):
        if url is None:
            break
        payload = _get(client, url).json()
        tags.extend(payload["results"])
        url = payload.get("next")
    return tags


def tag_key(tag: str) -> tuple[int, int, int, int] | None:
    """Order YYYY.MM.DD[.N] tags numerically, a bare date as N = 0; None for other tags.

    Comparing the strings would put 2026.10.04.10 before 2026.10.04.2.
    """
    match = _STABLE_TAG.fullmatch(tag)
    if match is None:
        return None
    year, month, day, n = match.groups()
    return int(year), int(month), int(day), int(n or 0)


def select_release(releases: list[dict], tags: list[dict], cutoff: datetime) -> Release:
    # A release counts only if it is both a GitHub release and a Docker Hub tag
    # with a digest. otr releases the whole monorepo and pushes
    # stagecodes/otr-processor:<tag> only for releases in which the processor
    # changed, so the releases that have an image are exactly the processor's
    # releases. A release without one left the previous processor release in effect.
    # Docker Hub calls a tag inactive after a month without a push or pull, but
    # its image still pulls, so the status is ignored.
    pushed: dict[str, tuple[datetime, str]] = {
        tag["name"]: (_parse_utc(tag["tag_last_pushed"]), tag["digest"])
        for tag in tags
        if tag.get("digest")
    }
    candidates = []
    for entry in releases:
        tag = entry["tag_name"]
        if entry["draft"] or entry["prerelease"] or tag_key(tag) is None or tag not in pushed:
            continue
        pushed_at, digest = pushed[tag]
        candidates.append(
            Release(
                tag=tag,
                published_at=_parse_utc(entry["published_at"]),
                pushed_at=pushed_at,
                digest=digest,
                repository=entry.get("repository"),
                html_url=entry.get("html_url"),
            )
        )
    usable = [release for release in candidates if release.usable_at <= cutoff]
    if not usable:
        earliest = min(candidates, key=lambda release: release.usable_at, default=None)
        raise ReplayError(
            "discovery",
            f"no processor release is usable at {cutoff:%Y-%m-%dT%H:%M:%SZ}",
            (
                f"The earliest usable release is {earliest.tag} "
                f"(usable {earliest.usable_at:%Y-%m-%dT%H:%M:%SZ}); choose a later --as-of."
                if earliest
                else "No stable processor release exists on both GitHub and Docker Hub."
            ),
        )
    return max(usable, key=lambda release: tag_key(release.tag))


def download_replica(
    client: httpx.Client,
    ref: ReplicaRef,
    dest_dir: Path,
    on_chunk: Callable[[int, int], None],
) -> Replica:
    expected = _fetch_checksum(client, ref)
    # Colons in ISO 8601 names are illegal on Windows; ref.name stays the remote
    # name for checksum matching and metadata.
    path = dest_dir / ref.name.replace(":", "-")
    digest = hashlib.sha256()
    downloaded = 0
    try:
        with client.stream("GET", ref.url) as response:
            _raise_for_status(response, ref.url)
            total = int(response.headers.get("content-length", 0))
            with path.open("wb") as file:
                for chunk in response.iter_bytes(1 << 16):
                    file.write(chunk)
                    digest.update(chunk)
                    downloaded += len(chunk)
                    on_chunk(downloaded, total)
    except httpx.HTTPError as err:
        raise ReplayError("download", f"downloading {ref.name} failed: {err}") from err
    if digest.hexdigest() != expected:
        raise ReplayError(
            "download",
            f"SHA-256 mismatch for {ref.name}",
            f"Expected {expected}, calculated {digest.hexdigest()}. Retry the run.",
        )
    return Replica(ref=ref, path=path, sha256=digest.hexdigest())


def _fetch_checksum(client: httpx.Client, ref: ReplicaRef) -> str:
    try:
        response = _get(client, f"{ref.url}.sha256")
    except ReplayError as err:
        raise ReplayError(
            "download",
            f"the SHA-256 checksum for {ref.name} could not be fetched: {err.message}",
            "Every replica has a published checksum, and a download is never used unverified.",
        ) from err
    line = response.text.strip()
    match = re.match(r"^([0-9a-f]{64})\s+\*?(\S+)$", line)
    if match is None or match.group(2) != ref.name:
        raise ReplayError("download", f"unrecognized checksum file for {ref.name}")
    return match.group(1)


def _get(client: httpx.Client, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
    failure = f"request to {url} failed"
    for delay in (0, 1, 2, 4, 8):
        time.sleep(delay)
        try:
            response = client.get(url, headers=headers)
        except httpx.HTTPError as err:
            failure = f"request to {url} failed: {err}"
            continue
        if (
            response.status_code in (403, 429)
            and response.headers.get("x-ratelimit-remaining") == "0"
        ):
            raise ReplayError(
                "discovery",
                f"the {response.request.url.host} rate limit is exhausted",
                "Wait for the limit to reset and retry.",
            )
        if response.status_code in (429, 500, 502, 503, 504):
            failure = f"{url} returned HTTP {response.status_code}"
            continue
        if response.status_code != 200:
            raise ReplayError("discovery", f"{url} returned HTTP {response.status_code}")
        return response
    raise ReplayError("discovery", failure)


def _raise_for_status(response: httpx.Response, url: str) -> None:
    if response.status_code != 200:
        raise ReplayError("download", f"{url} returned HTTP {response.status_code}")


def _parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    # A timestamp without an offset is UTC by definition, never host-local time.
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
