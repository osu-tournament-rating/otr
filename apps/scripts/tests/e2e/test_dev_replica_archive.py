"""Prove a dev replica mirrors production data without carrying its secrets.

Seeds a disposable Postgres with known credential values, runs the dev export,
and checks the archive for them. Never touches the configured application
database.
"""

import gzip
import subprocess
import time
import types
import uuid
from dataclasses import dataclass
from pathlib import Path

import pytest

from lib.constants import buckets
from lib.scripts import db

pytestmark = pytest.mark.e2e

POSTGRES_IMAGE = "postgres:17"
POSTGRES_PASSWORD = "postgres"
POSTGRES_USER = "otr_e2e"
POSTGRES_DB = "otr_dev_replica_e2e"
STARTUP_TIMEOUT_SECONDS = 90

# Values that must never appear in a dev archive.
SECRETS = {
    "access_token": "osu-access-token-3f9a",
    "refresh_token": "osu-refresh-token-8c21",
    "id_token": "osu-id-token-77bd",
    "password": "argon2-hash-of-a-password",
    "session_token": "session-bearer-b4de",
    "verification_value": "verification-value-1a2b",
    "api_key": "otr-api-key-9e0f",
    "client_secret": "oauth-client-secret-5d3c",
}

SCHEMA = """
CREATE TABLE players (id integer PRIMARY KEY, username text NOT NULL);

CREATE TABLE auth_users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    player_id integer NOT NULL REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE auth_accounts (
    id text PRIMARY KEY,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    access_token text,
    refresh_token text,
    id_token text,
    password text,
    created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
    id text PRIMARY KEY,
    token text NOT NULL UNIQUE,
    ip_address text,
    user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE TABLE auth_verifications (
    id text PRIMARY KEY,
    identifier text NOT NULL,
    value text NOT NULL
);

CREATE TABLE api_keys (
    id text PRIMARY KEY,
    name text,
    key text NOT NULL,
    reference_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE TABLE users (id integer PRIMARY KEY, player_id integer NOT NULL);

-- Integer key and a varchar secret, unlike the text-keyed auth tables.
CREATE TABLE o_auth_clients (
    id integer PRIMARY KEY,
    secret character varying(128) NOT NULL,
    rate_limit_override integer,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Referencing a redacted table: its foreign key is validated on restore.
CREATE TABLE o_auth_client_admin_note (
    id integer PRIMARY KEY,
    note text NOT NULL,
    o_auth_client_id integer NOT NULL REFERENCES o_auth_clients(id) ON DELETE CASCADE
);

CREATE TABLE match_audits (
    id integer PRIMARY KEY,
    reference_id integer,
    action_user_id integer
);
"""

SEED = f"""
INSERT INTO players VALUES (1, 'peppy'), (2, 'cookiezi');

INSERT INTO auth_users VALUES
    ('user-1', 'peppy@example.test', 1),
    ('user-2', 'cookiezi@example.test', 2);

-- One row with every token populated, one with all of them NULL.
INSERT INTO auth_accounts (id, account_id, provider_id, user_id,
                           access_token, refresh_token, id_token, password)
VALUES
    ('account-1', '1', 'osu', 'user-1',
     '{SECRETS["access_token"]}', '{SECRETS["refresh_token"]}',
     '{SECRETS["id_token"]}', '{SECRETS["password"]}'),
    ('account-2', '2', 'osu', 'user-2', NULL, NULL, NULL, NULL);

INSERT INTO auth_sessions VALUES
    ('session-1', '{SECRETS["session_token"]}', '203.0.113.9', 'user-1');

INSERT INTO auth_verifications VALUES
    ('verification-1', 'peppy@example.test', '{SECRETS["verification_value"]}');

INSERT INTO api_keys VALUES ('key-1', 'ci', '{SECRETS["api_key"]}', 'user-1');

INSERT INTO users VALUES (10, 1), (11, 2);

INSERT INTO o_auth_clients VALUES (100, '{SECRETS["client_secret"]}', 500, 10);

INSERT INTO o_auth_client_admin_note VALUES (1, 'issued for the bracket bot', 100);

INSERT INTO match_audits VALUES (1, 55, 1), (2, 56, 1);
"""

MIRRORED_COUNTS = {
    "players": 2,
    "auth_users": 2,
    "auth_accounts": 2,
    "auth_sessions": 1,
    "auth_verifications": 1,
    "api_keys": 1,
    "match_audits": 2,
    "users": 2,
    "o_auth_clients": 1,
    "o_auth_client_admin_note": 1,
}


def test_dev_replica_mirrors_data_without_secrets(tmp_path: Path, monkeypatch):
    source = start_postgres()
    try:
        psql(source, SCHEMA)
        psql(source, SEED)

        point_config_at(monkeypatch, source, tmp_path)
        archive = db._export(buckets.DEV)
        assert archive, "dev export failed"

        dump = gzip.decompress(archive.read_bytes()).decode()

        assert_no_secrets(dump)
        assert_redaction_markers(dump)
        assert_mirrored_tables(dump)
    finally:
        source.stop()

    target = start_postgres()
    try:
        restore(target, dump)
        assert_row_counts(target)
        assert_null_shape_preserved(target)
        assert_constraints_hold(target)
    finally:
        target.stop()


def assert_no_secrets(dump: str):
    leaked = [name for name, value in SECRETS.items() if value in dump]
    assert not leaked, f"Dev archive leaked secret values: {', '.join(leaked)}"


def assert_redaction_markers(dump: str):
    for marker in (
        "redacted:access_token:account-1",
        "redacted:refresh_token:account-1",
        "redacted:id_token:account-1",
        "redacted:password:account-1",
        "redacted:token:session-1",
        "redacted:value:verification-1",
        "redacted:key:key-1",
        "redacted:secret:100",
    ):
        assert marker in dump, f"Expected redacted value {marker} in the archive"


def assert_mirrored_tables(dump: str):
    # Data the old dev blacklist dropped entirely.
    assert "peppy@example.test" in dump
    assert "issued for the bracket bot" in dump


def assert_row_counts(container: PostgresContainer):
    for table, expected in MIRRORED_COUNTS.items():
        actual = int(query(container, f"SELECT count(*) FROM {table}"))
        assert (
            actual == expected
        ), f"{table} has {actual} rows after restore, expected {expected}"


def assert_null_shape_preserved(container: PostgresContainer):
    populated = query(
        container,
        "SELECT count(*) FROM auth_accounts WHERE access_token IS NOT NULL",
    )
    empty = query(
        container, "SELECT count(*) FROM auth_accounts WHERE access_token IS NULL"
    )

    assert int(populated) == 1, "Redaction should keep a populated token populated"
    assert int(empty) == 1, "Redaction should keep a NULL token NULL"


def assert_constraints_hold(container: PostgresContainer):
    distinct = query(container, "SELECT count(DISTINCT token) FROM auth_sessions")
    total = query(container, "SELECT count(*) FROM auth_sessions")

    assert distinct == total, "Redacted session tokens must stay unique"


def point_config_at(monkeypatch, container: PostgresContainer, dump_dir: Path):
    monkeypatch.setattr(
        db,
        "config",
        types.SimpleNamespace(
            db_container=container.name,
            db_user=container.user,
            db_name=container.db,
            dump_dir=dump_dir,
            environment="staging",
        ),
    )


@dataclass(frozen=True)
class PostgresContainer:
    name: str
    user: str
    db: str

    def stop(self):
        subprocess.run(["docker", "stop", self.name], capture_output=True, check=False)


def start_postgres() -> PostgresContainer:
    container = PostgresContainer(
        name=f"otr-dev-replica-e2e-{uuid.uuid4().hex[:12]}",
        user=POSTGRES_USER,
        db=POSTGRES_DB,
    )

    subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            container.name,
            "--network",
            "none",
            "--env",
            f"POSTGRES_USER={container.user}",
            "--env",
            f"POSTGRES_PASSWORD={POSTGRES_PASSWORD}",
            "--env",
            f"POSTGRES_DB={container.db}",
            POSTGRES_IMAGE,
        ],
        capture_output=True,
        check=True,
    )

    try:
        wait_for_postgres(container)
    except Exception:
        container.stop()
        raise

    return container


def wait_for_postgres(container: PostgresContainer):
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS

    while time.monotonic() < deadline:
        proc = subprocess.run(
            [
                "docker",
                "exec",
                container.name,
                "pg_isready",
                "-U",
                container.user,
                "-d",
                container.db,
            ],
            capture_output=True,
            check=False,
        )
        if proc.returncode == 0:
            return
        time.sleep(1)

    raise TimeoutError(f"{container.name} did not become ready")


def psql(container: PostgresContainer, sql: str):
    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            container.name,
            "psql",
            "-U",
            container.user,
            "-d",
            container.db,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
        ],
        input=sql,
        text=True,
        capture_output=True,
        check=True,
    )


def query(container: PostgresContainer, sql: str) -> str:
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            container.name,
            "psql",
            "-U",
            container.user,
            "-d",
            container.db,
            "-Aqt",
            "--no-psqlrc",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def restore(container: PostgresContainer, dump: str):
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            container.name,
            "psql",
            "-U",
            container.user,
            "-d",
            container.db,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
        ],
        input=dump,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, f"Restore failed:\n{result.stderr[-4000:]}"
