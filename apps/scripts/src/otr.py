"""otr: a disposable o!TR stack for the worktree this script lives in.

    otr up [worker|monitoring ...] [--no-web] [--fresh]
    otr down [web|worker|monitoring ...]
    otr down --orphans
    otr status
    otr test [bun test arguments ...]

See the "Agent stacks" section of apps/scripts/AGENTS.md.
"""

import argparse
import os
import sys
from pathlib import Path

from lib.stack import stack
from lib.stack.common import StackError

# The checkout this copy of otr belongs to, wherever it is run from.
HERE = Path(__file__).resolve().parent


def parse(argv: list[str]) -> argparse.Namespace:
    # `otr test` passes every argument after it to `bun test` unread, because
    # argparse would take a leading flag, such as `-t name`, for one of its
    # own. A leading `--` is dropped, so `otr test -- -t name` works too.
    if argv[:1] == ["test"]:
        rest = argv[1:]
        if rest[:1] == ["--"]:
            rest = rest[1:]
        return argparse.Namespace(command="test", args=rest)

    parser = argparse.ArgumentParser(
        prog="otr",
        description="Run a disposable o!TR stack for this worktree.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    up = commands.add_parser(
        "up",
        help="start the stack: a copy of the local database and the web app",
        description="Start this worktree's stack, or add components to it. "
        "The database and web app start unless --no-web; name extra components "
        "to add them. Running it again is safe.",
    )
    up.add_argument(
        "components",
        nargs="*",
        choices=stack.COMPONENTS,
        help="extra components",
    )
    up.add_argument("--no-web", action="store_true", help="do not start the web app")
    up.add_argument(
        "--fresh",
        action="store_true",
        help="copy the local database again and replace this stack's copy",
    )

    down = commands.add_parser(
        "down",
        help="dispose the stack, or stop some components",
        description="With no components, dispose of this worktree's whole "
        "stack, its database copy included.",
    )
    down.add_argument("components", nargs="*", choices=stack.COMPONENTS)
    down.add_argument(
        "--orphans",
        action="store_true",
        help="dispose every stack whose worktree no longer exists",
    )

    commands.add_parser("status", help="list every stack on this machine")

    # Here only for `otr --help`. The check at the top reads `otr test` itself.
    commands.add_parser(
        "test",
        help="run bun test with the database tests on the stack's empty test "
        "database, as CI does; every argument after `test` goes to bun test",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse(argv)
    try:
        if args.command == "up":
            stack.up(HERE, set(args.components), not args.no_web, args.fresh)
        elif args.command == "down" and args.orphans:
            stack.orphans()
        elif args.command == "down":
            stack.down(HERE, set(args.components))
        elif args.command == "test":
            root, env = stack.database_test_env(HERE)
            os.chdir(root)
            os.execvpe("bun", ["bun", "test", *args.args], env)
        else:
            stack.status(HERE)
    except (StackError, OSError) as error:
        print(f"otr: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
