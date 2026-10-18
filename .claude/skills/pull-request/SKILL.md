---
name: pull-request
description: Rules for opening a pull request in otr. Use whenever you open a pull request, or edit an existing pull request's title or description. Covers the independent review to run first, the title, the description template, labels, and the signature.
---

# Opening a pull request

The reviewer judges what the software now does. They do not walk through the
code. Write for that reader.

## Independent review

Before you open a pull request, have the `reviewer` agent check your finished
work once. It starts with a fresh context, so it doesn't share the reasoning
that led you to your mistakes.

1. Finish the work and get the tests passing first, without weakening any.
   A test that also fails on `master` is the exception: leave it, as the
   `testing` skill describes.
2. Start the `reviewer` agent. Give it the requirement exactly as the user
   wrote it, plus the full text of any issue it references, and the base
   branch. Don't summarize the requirement, and don't tell it what you think
   is risky or already fine. If you can't start agents, run it headless
   instead: `claude -p --agent reviewer "<the same prompt>"`.
3. Fix each finding you agree with, then re-run the affected tests. When you
   disagree with a finding, keep it and record why. Run only one round of
   review; don't send the fixes back for another.
4. List every finding under `## Review`, most severe first, in plain language:
   `- High: rejecting a match left its scores verified (fixed)`, or
   `(declined: reason)` for one you did not fix. Write `- None found` when the
   reviewer reported nothing. Never list a review you did not run. When you
   edit the description of a pull request opened before this step existed,
   write `- Not run: opened before reviews were required`.

A hook blocks `gh pr create` and `gh pr edit` when the description has no
`## Review` section, so a pull request can't skip this step.

## Title

The title follows the commit format in the root `AGENTS.md` and becomes the
release entry. Mark a breaking change to the public API or a shared contract
with `!`, as in `feat(web)!: ...`. Do not use a `BREAKING CHANGE:` footer.

## Description

- Follow `.github/pull_request_template.md`. Keep the text under 150 words in
  total, not counting the template's comments or the `## Tests changed` and
  `## Review` lists.
- Describe behavior and outcomes in plain language: what a user, admin, or
  operator now sees or can do, and why. Leave out file paths, function names,
  diffs, and step-by-step implementation detail; the diff already shows those.
- Never link to files, lines, or commits. Link only to pages on the site or
  the docs.
- Under Testing, say in a sentence or two what you confirmed works, and which
  new tests you saw fail first. Do not paste commands or logs. Under Deploy
  risk, name any migration, data rewrite, or contract change, or write "None".
- Under Tests changed, list every existing test you changed or deleted, and
  why the task required it. Write `- None` if no existing test changed. CI
  fails the pull request when it changes an existing test and the section has
  no other bullet. That includes later pushes: when a fix after review or CI
  must edit a test because the task changed that behavior, add its bullet. A
  red run is never that reason. Ask the user before a CI fix edits a test the
  task did not change. The `testing` skill has examples.
- `## Changelog` becomes the release notes. Use only past-tense bullets for
  user-facing changes, linking the pages they touch. Write `- None` when
  nothing user-facing changed. Keep the `<!-- changelog:end -->` marker.
  `.github/scripts/release-notes.ts` enforces the title and changelog format.
- End the description with `^claude` on its own final line, after
  `<!-- changelog:end -->`.
- Do not capture or attach screenshots, or any other screenshot evidence.
  Reviewers judge visual changes on a `preview` deployment.
- Accuracy beats completeness. Never claim something was checked unless it
  was.

## Labels

CI adds an `app:<name>` label for each app whose files the pull request
changes. Do not add them by hand. Add `preview` when the change needs a
running site to judge, such as new behavior, data flows, or a visual change.
Add `meta:breaking-change` when the pull request breaks the public API, a
database contract, or another consumer.
