import re
import shlex
from pathlib import Path

import pytest

from lib.constants import buckets
from lib.scripts import db

DEST = Path("/tmp/otr-test-dumps/otr-dev-replica.gz")

ACCOUNT_COLUMNS = [
    db.Column("id", "text"),
    db.Column("account_id", "text"),
    db.Column("user_id", "text"),
    db.Column("access_token", "text"),
    db.Column("refresh_token", "text"),
    db.Column("id_token", "text"),
    db.Column("password", "text"),
    db.Column("created_at", "timestamp without time zone"),
]


def columns_for(table: str) -> list[db.Column]:
    if table == "public.auth_accounts":
        return ACCOUNT_COLUMNS

    return [
        db.Column("id", "text"),
        *(db.Column(name, "text") for name in db.dev_secret_columns[table]),
    ]


def dev_command() -> str:
    return db._dev_export_command(
        {table: columns_for(table) for table in db.dev_secret_columns}, DEST
    )


def option_values(command: str, option: str) -> set[str]:
    tokens = shlex.split(command)

    return {
        tokens[index + 1] for index, token in enumerate(tokens[:-1]) if token == option
    }


def excluded_tables(command: str) -> set[str]:
    return option_values(command, "--exclude-table-data")


def test_dev_export_excludes_only_credential_and_job_table_data():
    assert excluded_tables(dev_command()) == set(db.dev_secret_columns) | {
        "public.jobs"
    }


def test_dev_export_keeps_the_schema_of_tables_it_empties():
    # Restores need an empty jobs table: its migration is already recorded,
    # so nothing would create it again.
    table_exclusion = re.compile(r"^(-T|--exclude-table(-and-children)?)(=|$)")

    excluded = [
        token for token in shlex.split(dev_command()) if table_exclusion.match(token)
    ]

    assert not excluded


def test_redacted_rows_load_before_foreign_keys_are_added():
    command = dev_command()

    pre_data = command.index("--section=pre-data")
    data = command.index("--section=data")
    post_data = command.index("--section=post-data")
    redacted = max(
        command.index(f"'redacted:{secret}:'")
        for secrets in db.dev_secret_columns.values()
        for secret in secrets
    )

    assert pre_data < data < redacted < post_data


def test_only_the_pre_data_section_drops_objects():
    command = dev_command()

    assert command.count("--if-exists") == 1
    assert command.index("--if-exists") < command.index("--section=data")


def test_every_secret_column_is_redacted():
    command = dev_command()

    for table, secrets in db.dev_secret_columns.items():
        for secret in secrets:
            assert f"'redacted:{secret}:'" in command, f"{table}.{secret} not redacted"


def test_non_secret_columns_pass_through_unmodified():
    command = db._redacted_copy_command("public.auth_accounts", ACCOUNT_COLUMNS)

    for name in ("account_id", "user_id", "created_at"):
        assert f'"{name}"' in command
        assert f"'redacted:{name}:'" not in command


def test_copy_block_lists_every_column_in_order():
    command = db._redacted_copy_command("public.auth_accounts", ACCOUNT_COLUMNS)
    expected = ", ".join(f'"{column.name}"' for column in ACCOUNT_COLUMNS)

    assert f"COPY public.auth_accounts ({expected}) FROM stdin;" in command
    assert "\\." in command


def test_redaction_preserves_null_values():
    expression = db._redacted_select(db.Column("access_token", "text"))

    assert 'CASE WHEN "access_token" IS NULL THEN NULL' in expression
    assert '|| "id" END' in expression


def test_redacting_a_non_text_column_is_refused():
    with pytest.raises(RuntimeError, match="expected a text column"):
        db._redacted_select(db.Column("expires_at", "timestamp without time zone"))


def test_missing_secret_column_is_refused():
    with pytest.raises(RuntimeError, match="missing redacted columns"):
        db._redacted_copy_command("public.auth_sessions", [db.Column("id", "text")])


def test_table_without_id_is_refused():
    with pytest.raises(RuntimeError, match="no id column"):
        db._redacted_copy_command("public.auth_sessions", [db.Column("token", "text")])


def test_production_export_is_still_a_full_dump():
    command = db._export_command(buckets.PROD, DEST)

    assert "--exclude-table-data" not in command
    assert "redacted" not in command


def pg_dump_commands(command: str) -> list[list[str]]:
    tokens = shlex.split(command)
    starts = [index for index, token in enumerate(tokens) if token == "pg_dump"]

    # Each pg_dump call ends with its database, `-d <name>`.
    return [tokens[start : tokens.index("-d", start) + 2] for start in starts]


def test_production_export_creates_the_grafana_role_before_its_grants():
    # Recovery stops at the first error, so on a fresh host a GRANT to a role
    # that doesn't exist yet would abort the restore.
    command = db._export_command(buckets.PROD, DEST)

    create = command.find(f"CREATE ROLE {db.GRAFANA_ROLE}")
    dump = command.find("pg_dump")
    assert create != -1
    assert create < dump
    assert "--no-privileges" not in command


@pytest.mark.parametrize("replica", [buckets.DEV, buckets.PUBLIC])
def test_replica_exports_carry_no_grants(replica, monkeypatch):
    monkeypatch.setattr(db, "_table_columns", columns_for)
    dumps = pg_dump_commands(db._export_command(replica, DEST))

    assert dumps
    for dump in dumps:
        assert "--no-privileges" in dump
    assert "CREATE ROLE" not in db._export_command(replica, DEST)


def test_public_export_is_unchanged():
    command = db._export_command(buckets.PUBLIC, DEST)

    assert "--schema-only" in command
    assert "--data-only" in command
    assert "public.match_audits" not in command


# Sign-in state, credentials, and accounts, whose rows must never be public.
# The pattern also catches auth and API key tables added after this list.
CREDENTIAL_TABLE_NAME = re.compile(r"^(o_)?auth_|api_?key", re.IGNORECASE)
CREDENTIAL_TABLES = {
    "public.api_keys",
    "public.auth_accounts",
    "public.auth_sessions",
    "public.auth_users",
    "public.auth_verifications",
    "public.o_auth_client_admin_note",
    "public.o_auth_clients",
    "public.users",
}


def test_public_export_never_publishes_credential_tables():
    published = option_values(db._export_command(buckets.PUBLIC, DEST), "--table")
    denied = CREDENTIAL_TABLES | set(db.dev_secret_columns)

    assert published
    for table in published:
        # Rejects pg_dump patterns such as public.*, which no name check catches.
        _, name = db._split_table(table)

        assert table not in denied
        assert not CREDENTIAL_TABLE_NAME.search(name), table


def test_public_export_never_publishes_job_rows():
    # Job payloads, errors, and requesters are production state, not data.
    published = option_values(db._export_command(buckets.PUBLIC, DEST), "--table")

    assert published
    assert "public.jobs" not in published
