import pytest

import otr


@pytest.mark.parametrize(
    "argv, bun_args",
    [
        (["test", "-t", "refetch"], ["-t", "refetch"]),
        (
            ["test", "--timeout", "20000", "apps/web"],
            ["--timeout", "20000", "apps/web"],
        ),
        (["test", "--", "-t", "refetch"], ["-t", "refetch"]),
    ],
)
def test_otr_test_hands_every_argument_to_bun_test(
    tmp_path, monkeypatch, argv, bun_args
):
    ran = []
    monkeypatch.setattr(
        otr.stack, "database_test_env", lambda start: (tmp_path, {"A": "1"})
    )
    monkeypatch.setattr(
        otr.os, "execvpe", lambda file, args, env: ran.append((file, args, env))
    )
    # main changes into the checkout root; this puts the directory back after.
    monkeypatch.chdir(tmp_path)

    assert otr.main(argv) == 0
    assert ran == [("bun", ["bun", "test", *bun_args], {"A": "1"})]
