---
name: testing
description: Rules for tests in otr. Use whenever you write, change, delete, or review a test, or when a test fails and you must decide what to do about it. Covers handling a failing test your change did not touch, proving a test can fail, what each app must and must not test, hollow-test patterns, end-to-end tests, and the `## Tests changed` section of a pull request.
---

# Testing in otr

Tests here guard ratings, verified data, admin access, and the data the
project publishes. A test earns its place by failing when one of those breaks.
An audit in October 2026 found the tests honest but often hollow. 23 of 37
deliberately planted bugs passed every test, and about 45 tests could not fail.
About 190 more repeated other tests or pinned details nothing depends on.

## When a test fails

A failing test is a report. Work out what it reports before you touch it.

1. Read the failure and the test. Decide whether your change touches the
   behavior the test checks.
2. If it does, and the task asked for that behavior to change, update the
   test's expectations and list it under `## Tests changed`. If the failing
   assertion pins something that "What not to test" rules out, such as a
   class string, don't update the string. Replace it with a role,
   accessible-name, or ARIA check, or remove it if nothing depends on it.
3. If your change renames or moves code that a test uses, without changing
   behavior, update only those names and keep every assertion.
4. If your change touches the behavior and the task did not ask for that
   change, your change has a bug. Fix the code, not the test.
5. If your change does not touch the behavior, compare the test with `master`:
   - Fetch and merge `origin/master`, then rerun the test.
   - See whether master's CI fails it. Run
     `gh run list --workflow deploy.yml --branch master --event push --limit 3`,
     then `gh run view <id> --log-failed`. Master's CI never runs the
     Playwright suite. It runs the processor, scripts, and replay tests only
     when their app changes, and the processor's also when the schema,
     migrations, or persisted enums change.
   - Run the test in your environment on a clean `master`:
     `git worktree add --detach <path> origin/master`, then
     `bun install --frozen-lockfile` there, then the test. Remove the worktree
     afterwards.

   Then act on what you found:
   - If `master` fails it too, find or open an issue with the `issue` skill.
     That means master's CI fails it, or for a test CI doesn't run, your clean
     `master` fails it. Say so under Testing in the pull request and leave the test alone.
     If the check is required, the pull request stays red. Tell the user, link
     the issue, and offer to fix `master` in its own pull request. Never merge
     past a failing check.
   - If it fails on your clean `master` but passes in master's CI, the cause
     is your environment. Say so under Testing, and change neither the code
     nor the test.
   - If it passes on your clean `master`, your change causes it. Go back to
     step 4.

6. A test that fails, then passes on a rerun with no change, is flaky. Run it
   several times on the clean `master` worktree. If it flakes only with your
   change, or it is a spec you changed, the flake is yours to fix by waiting
   on conditions. Otherwise, open an issue and tell the user before anyone
   merges past it. Never add retries, sleeps, or longer timeouts.

Never delete, skip, or weaken a test to get a run green. Never copy the code's
new output into a test's expected values for the same reason. If the pull
request is open and you are fixing a failed CI run, ask the user before you
edit any existing test the task did not change.

## Prove a test can fail

Do this for every new test, and for every existing test whose expectations you
change:

1. Stage your own work with `git add <file>`, so undoing the break can't lose
   it.
2. Break the production code the test covers: flip a condition, drop a guard,
   or change a constant.
3. Run only that test:
   - TypeScript, from the repository root: `bun test ./<file> -t '<name>'`
   - In `apps/processor`: `cargo test <name>`
   - In `apps/scripts`: `uv run --extra e2e python -m pytest <file>::<name>`
   - In `apps/replay`: `uv run pytest <file>::<name>`
4. Confirm it fails for the reason its name gives. Then undo the break with
   `git checkout -- <file>`, which restores the version you staged.

If the test still passes, it is hollow. Fix the test, not the code. For a bug
fix, write or update the test first and watch it fail on the unfixed code.
Under Testing in the pull request, say which tests you saw fail first.

A skipped test proves nothing, and Bun passes a test that makes no
assertions. The `skip` and `expect() calls` counts in the summary show both.
Tests that read `SEARCH_TEST_DATABASE_URL` skip unless it is set. Point it at
an empty database on your own stack, never at `localhost:5432`, and migrate
that database the way the `checks` job in `.github/workflows/ci.yml` migrates
its test database. Set `DATABASE_URL` to the same value, because the sign-up
test needs the two to match.

## What each app must test

| Area                           | Must test                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processor ratings and decay    | Values against numbers worked out by hand or taken from `apps/docs`, never from the code's own output or the constant under test. Write the arithmetic, or the docs page the value comes from, in a comment beside it. Boundaries, such as exactly 184 days. Saved ratings read back from the database. |
| Automation checks              | Each rule at its boundary, on both sides. Verified and Rejected statuses an admin set survive a re-run.                                                                                                                                                                                                 |
| Authorization and write guards | Signed-out, non-admin, and stale-build callers are refused. Admin writes go through `adminMutationProcedure`.                                                                                                                                                                                           |
| SQL that filters data          | Verification status, ruleset, and scoping filters, run against the test database rather than a fake query builder. A fake ignores the WHERE clause.                                                                                                                                                     |
| Published data                 | No auth, session, or API-key table reaches a public export. Recovery restores the newest archive.                                                                                                                                                                                                       |
| Contracts                      | Enum numbers, queue names and arguments, and message shapes. Pin them to literal values, or check them against the other side's definition, as the processor's contract tests check the enums in `@otr/core`.                                                                                           |

## What not to test

These apply to the tests you write and to tests the task asks you to change.
When an existing test outside your task matches one, open an issue and leave
it.

- Exact Tailwind classes or markup in one component. Test roles, accessible
  names, and ARIA wiring, such as `aria-describedby` naming the hint's id.
  Test the design rules in `AGENTS.md`, such as the `text-xs` minimum and
  contrast, once across the kit, not in each component's test. A restyle that
  keeps the design rules should fail no test.
- Library behavior: zod accepting an optional field, Drizzle building a query,
  Radix opening a menu, or rosu-pp computing star ratings.
- Constants restated in the test, except contract values, and expected values
  computed by the code under test.
- Code that production never calls, and helpers that exist only for tests.
- More cases than branches. Cover each branch and boundary once. Use a table
  when there are many. When a request asks for more tests than the code has
  branches, write the ones these rules justify and tell the user why there are
  fewer.

## Hollow patterns

Each of these passes while the code it names is broken:

- **Assertions behind a guard.** In `if (await row.isVisible()) expect(...)`,
  `isVisible()` returns at once, so a missing row skips the check. Use
  `await expect(row).toBeVisible()`.
- **Assertions in a loop or callback that may not run.** In
  `for (const update of updates) expect(...)`, an empty list asserts nothing.
  Assert the count first.
- **Matchers that cannot fail.** For example `toBeGreaterThanOrEqual(0)` on a
  count, `toBeDefined()` on a field that starts as `null`, or
  `title.length > 0`.
- **Checking a copy.** The test writes its own SQL, schema, or formula and
  checks that, instead of calling the production code.
- **Names that promise more.** A test called "queues match and beatmap
  fetches" that checks only matches, or a file named for a service it never
  imports.
- **Fakes that skip what matters.** A fake database that ignores WHERE clauses
  or reads SQL with regular expressions.
- **Skips that hide missing data.** A test that calls `test.skip()` when a row
  isn't found. Seed the data instead. A test gated on an environment variable
  or marker runs only where something sets it, so name in the test the CI job
  or documented step that runs it.
- **Sleeps.** `waitForTimeout` and fixed delays. Wait for the condition.

## End-to-end tests

The Playwright suite runs in no CI job, on pull requests or on `master`. Run
the specs you change yourself, from `apps/web` with your stack up:
`bun run test:e2e <spec>`. It serves the site on port 3001 and a fake osu!
server on 3002. If another worktree already serves on those ports, the run
tests that worktree's site instead, so stop it first.

- Check the outcome the test's name promises, such as results narrowed, a row
  saved, or a 403 returned. A URL change or a page that renders is not enough.
- Use web-first assertions only. Never use `isVisible()` as a condition or
  `waitForTimeout`.
- Use data the test creates or controls. Production rows change every night.
- Check pixel sizes only when the size is the rule, such as a layout that must
  not overflow a phone screen.

## `## Tests changed` in the pull request

List every existing test you change or delete, whether or not CI notices.
Each bullet names a test, or a group changed for one reason, and says why the
task required the change. A group bullet covers only the edit it names, so an
assertion changed in one of those files needs its own bullet.

- `- Tournament list order: ties now sort by start date, as the issue asked.`
- `- 12 kit tests: imports follow the components to their new folder.`

Write `- None` when no existing test changed. CI fails a pull request whose
section has no other bullet when the pull request does any of these:

- Changes or removes a line in a test file. Blank lines, comments, and import
  lines that still import the same module don't count.
- Adds a skip marker to a test file, such as `describe.skipIf`, even around a
  new test.
- Deletes a test file, or moves it out of the paths its runner reads.
- Changes a line inside a `#[cfg(test)]` module in `apps/processor/src`.

Test files are the ones under `__tests__/`, `apps/web/e2e/`, `apps/*/tests/`,
and `apps/processor/test_data/`. So are `*.test.*`, `*.spec.*`, `*.e2e.*`,
`test-utils` and `test_utils` helpers, and the processor's `tests.rs`
modules. The `reviewer` agent checks that each change was required.
