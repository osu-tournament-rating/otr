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


def excluded_tables(command: str) -> set[str]:
    tokens = shlex.split(command)

    return {
        tokens[index + 1]
        for index, token in enumerate(tokens[:-1])
        if token == "--exclude-table-data"
    }


def test_dev_export_excludes_only_credential_table_data():
    assert excluded_tables(dev_command()) == set(db.dev_secret_columns)


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


def test_public_export_is_unchanged():
    command = db._export_command(buckets.PUBLIC, DEST)

    assert "--schema-only" in command
    assert "--data-only" in command
    assert "public.match_audits" not in command
