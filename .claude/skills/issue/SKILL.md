---
name: issue
description: Rules for issues in otr. Use whenever you find something worth an issue, open one, comment on one, edit or retitle one, or triage or label one. Covers when a finding becomes an issue and when it stays in your report, the open-issue limit, how findings are grouped, checking for duplicates, the issue type, the Priority and Effort fields, labels, the title, the body templates, the signature, and the commands that create the issue and set its fields.
---

# Writing an issue

The maintainer works from issues alone. There is no project board and there
are no milestones; the type, Priority, and labels decide what gets done and
when. Write each issue so that someone with no context can tell what is wrong,
who it hurts, and how urgent it is.

## When to file

One maintainer works every issue. Each new issue costs them time, so most
findings belong in your final report, not in an issue. Open an issue only
when one of these holds:

- The user asks you to file it.
- The `testing` skill sends you here for a test that fails or flakes on
  `master`.
- It is `Urgent` or `High` priority, as defined under Priority and Effort.

Everything else, such as polish, dead code, stale docs, or a `Medium` or
`Low` defect, goes in your report. The user files the ones they want.

Then count the open issues agents have filed:

```bash
gh issue list --state open --limit 500 --search '"^claude" in:body' --json number --jq length
```

When more than 20 are open, open a new issue only if it is `Urgent` or the
user asked for it. Otherwise comment on an issue the same change would fix,
as step 2 below describes, or leave the finding in your report, and tell the
user how many agent issues are open.

## Before you file

1. Confirm the problem is real. Reproduce it, or read enough of the code and
   data to be sure. Note what you could not confirm.
2. Search open issues for the same problem, and for one the same change would
   fix: `gh issue list --state open --search "<keywords>"`. Try two or three
   phrasings.
   - Same problem: do not file. Name the issue in your report.
   - Same fix: do not file. Comment on that issue with your finding and its
     evidence, ending with `^claude`, and name the issue in your report.
   - Same theme, with an open `Epic` for it: file the issue as a sub-issue of
     that `Epic`, with `--parent <number>` on `gh issue create`.
3. Scope the issue to one small pull request. Findings that one small change
   fixes together, such as several leftovers of the same removed feature, go
   in one issue, listed as a checklist under `## Evidence`. Findings that
   only share an area or a theme, and need separate fixes, get separate
   issues. Pull requests that fixed several unrelated issues at once grew to
   thousands of lines, were closed unmerged, and left every issue open.

## Type

Every issue has exactly one GitHub issue type. Types replace the old type
labels, so never add a label for the type.

- `Bug`: a defect in shipped behavior.
- `Feature`: a new capability.
- `Improvement`: a change to something that already works, such as
  performance, UX, or a refactor with a visible effect.
- `Task`: chores, cleanup, dead code, docs, or tooling with no user-facing
  change.
- `Epic`: only when it has sub-issues attached. Otherwise it is a `Feature`.

## Priority and Effort

Priority is required. Pick the highest level whose definition fits.

- `Urgent`: production is down, the Tuesday rating run fails or publishes
  wrong ratings, data is lost, or there is a security hole. Drop other work.
- `High`: wrong data can reach verified data or ratings, or a core flow is
  broken (tournament submission, verification, the public API). Fix before
  the next Tuesday run.
- `Medium`: a user-visible defect with a workaround, or planned feature work.
- `Low`: polish and nice-to-haves.

Effort is optional. Set it only when the size is clear: `Low` is under a day,
`Medium` a few days, `High` a week or more.

## Labels

- Add one `app:<name>` label for each affected app: `app:web`,
  `app:data-worker`, `app:processor`, `app:scripts`, `app:docs`, or
  `app:replay`. Work in `packages/otr-core` takes both `app:web` and
  `app:data-worker`. Work outside `apps/` takes `meta:ops` when it touches
  production or CI, or `meta:dev` when it is local or agent tooling. Every
  issue has at least one `app:` label, `meta:ops`, or `meta:dev`.
- Add every `meta:` label that fits:
  - `meta:breaking-change`: breaks the public API, a database contract, or
    another consumer.
  - `meta:data-integrity`: can make stored data, verification, or ratings
    wrong. Always add it when ratings or verified data could be affected.
  - `meta:ops`: production hosts, deployments, CI, backups, observability.
  - `meta:public-api`: changes or affects the public REST API.
  - `meta:performance`: slow pages, queries, jobs, or heavy downloads.
  - `meta:accessibility`: keyboard, screen reader, or touch access.
  - `meta:ui-ux`: the user interface or user experience.
  - `meta:dev`: local development, worktrees, tests, agent tooling. Not
    production; that is `meta:ops`.
- `request`: a new feature asked for by a user or the community, not work the
  maintainer planned. It goes on a `Feature` or `Improvement` that relays an
  outside ask, such as one from Discord or a user report, or whose author is
  not an org member. Never add it to your own findings. When triaging, add it to
  outside requests that lack it.
- `needs-info`: waiting on the reporter. An issue with no reply after 30 days
  is closed as "not planned".
- `good first issue`: small, well defined, and needs little context.

Duplicates and won't-fix issues are closed with GitHub's close reasons
("duplicate", "not planned"), not labels.

## Title

A plain sentence that names the problem or the goal. No Conventional Commit
prefix, no trailing period, no file paths or code names. A bug title states
the wrong behavior. A feature or improvement title says what should be
possible.

| Bad                              | Good                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `fix(web): reports pagination`   | `The admin reports page stops at 100 reports`            |
| `Bug in setVerificationStatus`   | `Rejecting a tournament leaves its scores verified`      |
| `feat: default ruleset setting.` | `Players can set a default ruleset`                      |
| `Leaderboard is slow`            | `The leaderboard takes over 5 seconds to load on mobile` |
| `Docs cleanup`                   | `The docs still describe the old rating run schedule`    |

## Body

Use the template that matches the type, from `.github/ISSUE_TEMPLATE/`:
`bug.md` for a `Bug`, `request.md` for a `Feature` or `Improvement` (set
`--type Improvement` when it changes something that already works), and
`task.md` for a `Task`. Keep its `## Summary`, `## Impact`, `## Evidence`, and
`## Recommendations` headings, follow the guidance in its comments, and delete
the comments.

- Keep Summary, Impact, and Evidence under 150 words together.
- Under `## Recommendations`, propose one or more solutions as a numbered
  list. Give each one's cost or risk, put the one you would pick first, and
  say why. Prefer the smallest fix that solves the problem. When a fix adds
  machinery to maintain, such as a new table, job, or step in the rating run,
  name that upkeep; the maintainer turns down fixes whose upkeep outweighs
  the problem.
- Keep it high level. Describe behavior and outcomes: what a user, admin, or
  operator sees. Leave out file paths, function names, and code.
- Never link to files, lines, or commits. Link only to pages on the site or
  the docs.
- Say what you have not confirmed. Accuracy beats completeness.
- End the body with `^claude` on its own final line.

## Commands

Write the body to a file in your scratchpad, then create the issue with its
type and labels:

```bash
gh issue create --type Bug \
  --title "The admin reports page stops at 100 reports" \
  --label app:web --label meta:ui-ux \
  --body-file <scratchpad>/issue.md
```

`gh` cannot set issue fields. Take the number from the URL it prints, then set
Priority, and Effort when it is clear:

```bash
.claude/skills/issue/scripts/set-fields.sh 1234 --priority Medium --effort Low
```

The script prints the issue's type and fields. Check that they match what you
chose. It also takes `--type` to change the type.

## Editing and triage

The same rules apply when you edit, retitle, or triage an issue. Use
`gh issue edit <number>` with `--title`, `--body-file`, `--type`,
`--add-label`, and `--remove-label`, then `set-fields.sh` for Priority and
Effort. When an issue is missing a type, Priority, or an `app:`, `meta:ops`,
or `meta:dev` label, add it.

## Report

In your final report to the user, list every issue you opened or commented
on, with its number and title. Then list each finding you did not file, in
one line each, with the priority you would give it.
