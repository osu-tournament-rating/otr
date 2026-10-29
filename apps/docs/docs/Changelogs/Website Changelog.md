This page records changes to the [otr](https://github.com/osu-tournament-rating/otr) project. Changelog format is based on [keep a changelog](https://keepachangelog.com/en/1.1.0/).

Each merged change deploys as its own [otr release](https://github.com/osu-tournament-rating/otr/releases). This page collects those releases every two weeks.

> [!note]
> This changelog began tracking releases on 2026.08.16. Changes made before that date are not recorded on this page.

## [2026.10.29.3](https://github.com/osu-tournament-rating/otr/compare/2026.10.09...2026.10.29.3)

### Breaking API Changes

- Removed internal fetch times and statuses from player objects in the [public API](https://otr.stagec.net/spec).
    - `GET /players/{id}`, `GET /matches/{id}`, and `GET /tournaments/{id}` no longer return `osuLastFetch`, `osuTrackLastFetch`, `osuTrackDataFetchStatus`, or `dataFetchStatus` on players.
- Changed `GET /matches/{id}` to return no `winRecord` or `rosters` unless the match is verified, and no `playerMatchStats` for unverified matches.
- Changed `GET /audit/timeline` and `GET /audit/descendants` to no longer return `searchVector` or `matchRankVector` changes.

### Added

- Redesigned every page, including the [leaderboard](https://otr.stagec.net/leaderboard), [tournaments](https://otr.stagec.net/tournaments), [beatmaps](https://otr.stagec.net/beatmaps), and [stats](https://otr.stagec.net/stats).
- Added player search and sorting to the leaderboard, filtering by several rulesets to tournaments and beatmaps, and header search for signed-out visitors.
- Added default ruleset choices to [settings](https://otr.stagec.net/settings) for the profile, the leaderboard, the tournament list, and the beatmap list.
    - Profiles and header search default to the ruleset a player played most in verified tournaments.
    - API `defaultRuleset` fields return that ruleset, or the chosen profile ruleset.
    - "See all beatmaps" in the header search shows beatmaps of every ruleset.
- Added unverified and rejected tournaments to a player's tournament history when the player scored at least 2,000 on a pooled beatmap. They show their status but no record or rating change.
- Hid players restricted on osu! from the leaderboard, and marked inactive players, with an "Include inactive players" filter. Profiles mark restricted and inactive players too.
    - `GET /leaderboard` takes `includeInactive`, which defaults to true, and returns `lastMatchTime` and `inactive`.
    - `GET /players/{id}` and `GET /players/{id}/stats` return `restricted`, and stats also return `inactive`.
- Added each pooled beatmap's star rating, CS, AR, OD, HP, BPM, and length under its most-played mod on tournament pages.
    - `GET /tournaments/{id}` returns pooled beatmaps' mod attributes.
- Added weighted [[Match Cost|match cost]] to tournament stats, with a tooltip.
- Added live fetch and processing progress to tournament pages. After a [submission](https://otr.stagec.net/tournaments/submit), the form stays open and a toast links to the new tournament.
- Added a Relevance sort to tournament search, which lists the best matches first.
- Added merge details to match pages, showing when a match was merged into another and which matches were merged into it. Merged matches can no longer be submitted, added to a tournament, or fetched again.
- Added the reviewer and pending rating to status tooltips, and the admin who verified or rejected a game or score to its tooltip on match and tournament pages.
    - Tournaments and matches return `pendingRating`, and games, scores, and each tournament in beatmap stats return `verifiedByUsername`.
- Added loading skeletons and retryable error screens to every page.
- Added badges for Fade In, Target Practice, and key co-op mods, mod name tooltips, and missing icons for osu!mania 1K–3K and 7K–9K scores.
- Changed the top mods on the [beatmap list](https://otr.stagec.net/beatmaps) to show osu! mod badges, including osu!'s No Mod badge, and whole percents.
- Changed mod badges to osu-web's lazer icons, and score cards to show only the mods their game does not.
- Added a notice that offers a reload when the site is updated while a page is open, and stopped older pages from saving changes.
- Kept [tournament submission](https://otr.stagec.net/tournaments/submit) and [registrant filter](https://otr.stagec.net/tools/filter) input across a reload.
- Added an error toast when logging in with osu! fails.
- Changed signing in to refresh the user's osu! ranks and pp.
- Changed [settings](https://otr.stagec.net/settings) to show a new API key only once, when it is made. Existing keys still work but can no longer be copied.
- Changed account deletion in settings to ask for a fresh log-in instead of failing.
- Changed refused saves in tournament admin dialogs and settings to say why, such as an expired session or the maintenance window.
- Credited every mapper of a guest difficulty on beatmap pages and player profiles.
- Changed the [[Automated Checks|automated checks]] to flag lazer Cinema as an invalid mod.
- Added an admin [jobs page](https://otr.stagec.net/admin/jobs) to see, retry, and cancel background jobs, and [daily totals](https://otr.stagec.net/admin/jobs/daily) of jobs and osu! requests.
- Added a [design reference](https://otr.stagec.net/admin/design) page for admins.
- Changed admin user lookup to suggest users while typing, find them by former username or osu! ID, and rank them like site search. Mass enqueue accepts player osu! IDs.
- Changed mass enqueue, report actions, admin notes, and bans to pause during the weekly maintenance window.
- Documented the `x-api-key` header in the [API reference](https://otr.stagec.net/spec) and on settings.
- Shortened tooltips across the site and removed ones that repeated what was already on screen.
- Changed note fields and the report form's details field to grow with their text.
- Changed toasts to use the site's icons and surface colors.
- Removed Invalid Mods from the admin mod list, which now offers single mods only.
- Changed the tournament edit dialog's rejection reasons to the dropdown the match, game, and score dialogs use, and the game and score dialogs' ruleset picker to the tournament's.
- Sped up the [beatmaps page](https://otr.stagec.net/beatmaps) and `GET /beatmaps`.
- Darkened the blue behind white text on buttons and badges, and tinted match score totals with their team's color.

### Fixed

- Fixed new players being unable to log in for the first time.
- Fixed ties and draws counting as wins on profiles, the leaderboard, and tournaments.
- Fixed wrong country ranks, including #0 for players without osu! profile data, and players with equal ratings in the same country swapping ranks between weekly updates.
- Fixed [[Initial Ratings|starting ratings]] to use the player's rank from when they started each ruleset, including for new players whose osu!track history was discarded.
- Fixed player names, countries, and osu! ranks that had stopped updating, including about 5,000 players whose fetches were lost.
- Fixed users' last login never changing after sign-up.
- Fixed lazer matches losing lazer-only mods and settings such as DT at 1.2x.
    - `GET /matches/{id}`, `GET /tournaments/{id}`, and `GET /beatmaps/{id}/stats` return lazer mods.
- Fixed automated checks overwriting admin verification decisions made while they ran.
- Fixed scores under an admin-verified game being left unchecked, which kept the game out of ratings.
- Fixed matches added to a verified tournament skipping automated checks.
- Fixed "Verify all children" verifying matches with no osu! data, which stopped the weekly rating run.
- Fixed tournament ruleset corrections leaving osu!mania games in the old ruleset.
- Fixed tournaments never getting automated checks when one of their matches or beatmaps could not be fetched, and submitted matches staying unfetched when queueing failed.
- Fixed missing or stale tournament stats after an empty game or deleted match.
- Fixed the leaderboard listing players outside the other filters when several tiers were chosen.
    - `GET /leaderboard` had the same fix.
- Fixed match details reporting a winner for unverified matches.
- Fixed player profiles showing osu! tournaments and beatmaps under another ruleset's stats, and teammate and opponent avatars sometimes opening the wrong player.
- Fixed player profiles and `GET /players/{id}/tournaments` with a time range leaving out tournaments.
- Fixed tournament search putting rejected or loose matches before verified, exact ones.
    - Applies to `GET /tournaments` with `sort=3` and the header search.
- Fixed the [audit log](https://otr.stagec.net/tools/audit-logs) hiding game, score, and beatmap changes until an entity type was picked, and showing a match deletion that moved its tournament's dates as a tournament update.
- Fixed tournament audit history listing the search index as a changed field.
- Fixed match pages crediting a tournament's rejection or verification to the admin who last reviewed each match, and resets of a tournament's verified data being recorded as system changes.
- Fixed deleting a tournament, match, game, or score, or merging matches or games, erasing their admin notes.
- Fixed admin edit dialogs writing back dates and statuses loaded with the page.
- Fixed wrong values in the [public API](https://otr.stagec.net/spec).
    - `ratingGained` and `isProvisional` from ranged `GET /players/{id}/stats`.
    - `closeness.excludedUnverifiedGameCount` from `GET /beatmaps/{id}/stats`.
- Fixed API keys sent in the `x-api-key` header causing a server error.
- Fixed the public API accepting any key sent as `bearer` or `BEARER`. An empty Bearer value returns "API key is missing."
- Fixed public API list filters rejecting a request with only one value.
    - `GET /leaderboard`: `tiers`.
    - `GET /tournaments`: `rulesets`, `verificationStatus`, and `lobbySize`.
    - `GET /beatmaps`: `rulesets`.
- Fixed public API player endpoints returning a 500 for a username without `keyType=username`.
- Fixed username lookups with `_` or `%` returning another player.
- Fixed steady API clients hitting the 60 requests a minute limit early.
- Fixed keyboard, touch, and screen reader use of leaderboard filters, the account menu, mobile navigation, admin controls, verification badges, and field help.
- Fixed screen readers reading every status on a player profile as only "Verified".
- Fixed bad filter links showing an error page, the tournaments "Through" date leaving out tournaments ending that day, and search losing typed text on tournaments and beatmaps.
- Fixed player profiles, the stats page, reports, audit history, and search showing "not found" or empty results on failure, and "Try again" on beatmap pages not reloading.
- Fixed pages crashing when the browser blocks site storage.
- Fixed [stats](https://otr.stagec.net/stats) rating markers vanishing when one ruleset failed, and the audit log saying no activity exists when filters match nothing.
- Fixed browser tab titles, the footer year, hydration errors, and the API reference linking to a missing changelog page.
- Fixed match sorting on tournament pages, and Back right after sorting a match's stats table keeping the new order.
- Fixed the ruleset sitting higher than the other details in a tournament's header.
- Fixed icon button tooltips staying open and covering the Admin menu above them.
- Restored open and close animations on popovers, menus, tooltips, and dialogs, and the admin note preview on hover in the tournaments list.
- Fixed known security vulnerabilities in the site's dependencies.
- Fixed body and code text on the docs showing in a serif font.

### Other

- Moved the otr-docs, otr-scripts, and otr-replay codebases into otr-web under [`apps/docs`](https://github.com/osu-tournament-rating/otr/tree/master/apps/docs), [`apps/scripts`](https://github.com/osu-tournament-rating/otr/tree/master/apps/scripts), and [`apps/replay`](https://github.com/osu-tournament-rating/otr/tree/master/apps/replay), and renamed otr-web to [otr](https://github.com/osu-tournament-rating/otr).
    - Changed releases to build the `stagecodes/otr-docs` image and deploy the docs with the rest of the stack.
    - Added docs and scripts checks to CI, which run when their apps change.
- Moved the docs to lowercase page addresses. Old links redirect.
- Changed releases to no longer interrupt the site or the API, and requests to retry briefly while the site restarts.
- Limited how often one visitor can search tournaments, beatmaps, the leaderboard, and the header search, and how many new players registrant filtering can add per hour.
- Turned away outside callers of the site's internal API. Tools use the [public API](https://otr.stagec.net/spec).
- Capped API tournament search terms at 200 characters.
- Freed osu! rate limit for tournament submissions by refreshing unrated players every 30 days.
- Updated the [[Privacy Policy|privacy policy]] to say error logs are no longer stored in the database, and to describe the daily-hashed IP and API key ID in request logs.
- Updated the [[Steps to Generate Ratings|rating reproduction guide]] to clone otr, and removed the processor's ineffective `--ignore-constraints` option from it.
- Improved the processor's database performance.
- Fixed the processor logging, and reconnecting to, the default RabbitMQ address instead of the configured broker.
- Removed the dotenv banner from worker startup logs.

## [2026.10.09](https://github.com/osu-tournament-rating/otr/compare/2026.10.03...2026.10.09)

### Fixed

- Fixed button tooltips opening by themselves after a dialog closed, and staying open until the next click or scroll.
    - Affected the report button on tournament and match pages, including game and score cards.
    - Affected the admin edit button on beatmap pages, and the admin delete, merge, refetch, reset automated checks, and accept pre-verification statuses buttons.

### Other

- Changed releases to be created after each merge to master, replacing batched releases and the staging environment.
- Moved the [otr-processor](https://github.com/osu-tournament-rating/otr-processor) codebase into otr-web under [`apps/processor`](https://github.com/osu-tournament-rating/otr/tree/master/apps/processor), as part of migrating o!TR towards a monorepo. Processor changes are recorded in the [[Processor Changelog|processor changelog]].
    - Added processor format, lint, test, and image checks to CI, which run when `apps/processor` changes.
    - Changed releases to build the `stagecodes/otr-processor` image only when `apps/processor` changed since the previous release. Each release's notes name the processor image it runs.

## [2026.10.03](https://github.com/osu-tournament-rating/otr/compare/2026.09.01...2026.10.03)

### Breaking API Changes

- `GET /users/{id}` returns only the user ID and the linked player's ID, osu! ID, username, and country. It no longer returns account settings, scopes, or activity times.

### Added

- Added a `Submitted` entry to the audit page of tournaments submitted before October 2025, when submissions were not yet audited. It shows the submitter and submission time recorded on the tournament.
    - `GET /audit/timeline` returns them as `unauditedSubmission`.
- Updated deletion entries in audit logs to no longer list every field of the deleted entity.
- Updated verified entries on audit pages to start collapsed.

### Fixed

- Fixed signed-in users being able to change the player linked to their account.
- Fixed tournament submissions accepting any number of match and beatmap IDs. A submission accepts at most 1,000 of each, and the submission form shows the error under the field.
- Fixed incorrect next sub-tier targets in player statistics, leaderboard, and search API responses.
- Fixed API responses reporting higher Bronze sub-tiers than rating charts for some players. Bronze II now starts at 200 TR instead of about 133 TR, and Bronze I at 300 TR instead of about 267 TR.
- Fixed `topPerformers[].accuracy` in the `GET /beatmaps/{id}/stats` schema to use a fraction from 0 to 1 instead of a percentage from 0 to 100.
- Fixed matches deleted from a tournament disappearing from the tournament's audit page, along with their history. The `Matches` tab now lists a deleted match's history, ending with its deletion.
    - `GET /audit/descendants` and `GET /audit/descendant-counts` include these matches.
    - Matches deleted before October 2025 are not included, because their deletions did not record a tournament.
- Fixed deleted matches showing only their ID in audit logs. They now show the name recorded when they were deleted.

### Other

- Improved release and preview image builds to continue when exporting the build cache fails.
- Changed failed data worker messages to retry after 30 seconds, up to 5 attempts, and then move to a `<queue>.failed` parking queue. Before, a message that always failed stalled its queue.
- Changed internal service ports to listen on loopback only.
- Removed the unused authentication callback page.

## [2026.09.01](https://github.com/osu-tournament-rating/otr/compare/2026.08.16...2026.09.01)

### Added

- Added child audit logs to tournament, match, game, and score audit pages, showing changes recorded against an entity's children.
    - Added `GET /audit/descendants` and `GET /audit/descendant-counts`.
- Added the ability for admins to fill in data for beatmaps the osu! API no longer serves.
    - Editable fields:
        - Difficulty name, artist, and title.
        - Set owner and mappers.
        - Ruleset, star rating, BPM, length, and drain length.
        - CS, HP, OD, and AR. CS represents key count in osu!mania.
        - Circle, slider, and spinner counts, and max combo.
    - Labeled beatmaps edited this way `Manually configured`.
    - Stopped the osu! API from overwriting beatmaps edited this way.
    - Audits are recorded at `/audit/beatmaps/{id}`.
- Added support for tracing oRPC procedures through to database queries using Tempo.
- Updated the leaderboard first-visit notice to a single sentence that can be dismissed immediately.
- Added sticky column headers to tables across the site.
    - [Leaderboard](https://otr.stagec.net/leaderboard), [tournaments list](https://otr.stagec.net/tournaments), and [beatmap list](https://otr.stagec.net/beatmaps).
    - Tournament match list and ratings tab.
    - Player rating history and per-tournament match tables.
    - Beatmap score leaderboard and pooled tournaments dialog.
    - Filter report results.
    - [`/reports`](https://otr.stagec.net/reports) and [`/admin/reports`](https://otr.stagec.net/admin/reports).
- Added site-wide search matching on osu! usernames a player no longer holds.
    - A result matched through a former username shows `formerly <name>`.
- Added a setting on the [settings page](https://otr.stagec.net/settings) to turn off the `Ctrl+L` shortcut that switches between the light and dark themes.
- Added separate raw score and score override fields to the admin score editor.
    - Admins may now set a 'score override'. Previously, overriding a score was a permanent change to the score object. Now, the original API value is always kept in-tact alongside the override.
    - Re-fetching a match no longer wipes an admin's score override.
    - Automated modifications to scores, such as EZ's 1.75x adjustment, are now stored in a new field `adjustedScore`. This way, automatic/expected and manual score overrides are maintained separately *and* the original API data is preserved.
    - Previous automatic adjustments have been identified and mapped to the `adjustedScore` column.
    - Easy scores keep the original osu! total alongside the 1.75x adjusted value, which previously replaced it.
    - Match API responses now include `rawScore`, `adjustedScore`, and `scoreOverride` alongside `score`.
- Added a choice of what happens to a tournament's, match's, or game's children when an admin sets it to verified: verify all children, accept pre-verification statuses, or leave children unchanged.
    - Setting a parent to verified no longer verifies its children on its own.
    - Setting a parent to rejected still rejects all of its children.
- Disabled verifying a match, game, or score whose parent is rejected.
- Redesigned the tournament page match list.
    - Matches are grouped by weekend, with each group's dates in its header.
    - Each match row shows its scoreline, winning team first.
    - Every game shows a verification pip, even on large matches.

### Fixed

- Fixed the results header not staying pinned while scrolling on the [registrant filtering tool](https://otr.stagec.net/tools/filter).
- Fixed matches with no start time being listed under the current date on the tournament page. They now appear in a `No start time` group at the end of the match list.
- Fixed Easy scores in osu!lazer matches being stored without the 1.75x multiplier.
- Fixed the profile avatar's report notification dot not clearing while viewing reports on [`/admin/reports`](https://otr.stagec.net/admin/reports) or [`/reports`](https://otr.stagec.net/reports).
- Fixed audit logs labeling automated verifications and rejections as pre-verified and pre-rejected.
- Fixed tooltip text contrast in the light theme.
- Fixed match dates on the tournament page showing in local time instead of UTC on narrow screens.
- Fixed audit cascade banners showing mismatched counts, such as `993 of 8 games`.
- Fixed audit log cards for bulk verification describing an entire cascade by its top-level action. A card that verified a tournament and rejected some of its matches now names each outcome and its count.
- Fixed verification statuses in audit log changes always reading as a red original value and a green new value. Each status is now colored by its own meaning.
- Refined the logic behind the `Accept pre-verification statuses` action. Functionally, it behaves the same as before, just in a more predictable way.
    - A pre-rejected tournament now rejects all of its matches, games, and scores.
    - Scores rejected because their game was rejected now carry the `Rejected game` reason instead of no reason.
- Fixed the admin score editor running off the edge of the screen on phones when a score had mods, cutting off the `Mods` field and the `Save` button.
- Fixed the note explaining the 1.75x Easy multiplier never appearing on a player's Mod Performance chart.

### Other

- Added per-pull-request preview deployments served on private tailnet URLs.
- Added `OTEL_EXPORTER_OTLP_ENDPOINT` to the `.env` format.

## [2026.08.16](https://github.com/osu-tournament-rating/otr/compare/2026.06.16...2026.08.16)

### Breaking API Changes

- Removed `GET /beatmaps/{beatmapId}/tournaments/{tournamentId}/matches`.

### Added

- Complete overhaul of all beatmap pages and cards.
    - Redesigned beatmap overview / core information display.
    - Redesigned mod distribution, tournament activity, and tournament usage charts.
    - Redesigned beatmap score leaderboard, now shows top 25 instead of top 10.
    - Added charts to display distributions for grades, rank ranges, freemod-specific mod choices.
    - Added charts to display scores earned by tier and rank range.
    - Added chart to display accuracy earned by tier.
    - Added histogram to display how close games usually are compared to other beatmaps of the same ruleset and team size.
    - Added miss count histogram.
- Added the ability for users to view data reports they've created.
- Added "Awaiting review" pill on the tournaments landing page for unverified tournaments.
- Added a mechanism for audit logs to precisely know which entities were edited through the same admin action.
- Redesigned the beatmap audio preview panel.
- Redesigned tournament landing page.
- Redesigned the data report experience for tournaments, matches, games, and scores.
- Redesigned the match page's stats tab.
- Updated the site-wide rating distribution chart design.
- Updated API spec implementation.
- Updated Grafana monitoring dashboards.
- Updated audit logging logic to automatically handle changes in data models.
- Updated the weekly maintenance window to end automatically once new ratings for the week are detected.
- Improved tournament and beatmap search/filter interfaces.
- Improved handling of sparse keywords in site-wide search.
- Improved beatmap search ranking.
- Replaced ruleset icons with official designs, except for Mania 4K and 7K. The latter were updated to be more in-line with the official icons.
- Disabled registrant filtering during the weekly maintenance window to guarantee auditability.

### Fixed

- Restored missing submitter data for 285 tournaments.
- Fixed bugs with site-wide search that caused some results, like [w/WWW](https://otr.stagec.net/beatmaps/2855311), to not show up.
- Fixed a bug where lazer-specific fields were missing from audit logs.

### Other

- Updated packages.
- Updated the `.env` format to accept port overrides for the website and Grafana.
- Dusted cobwebs throughout the codebase.

## Full Changelogs

- [2026.10.29.3](https://github.com/osu-tournament-rating/otr/compare/2026.10.09...2026.10.29.3)
- [2026.10.09](https://github.com/osu-tournament-rating/otr/compare/2026.10.03...2026.10.09)
- [2026.10.03](https://github.com/osu-tournament-rating/otr/compare/2026.09.01...2026.10.03)
- [2026.09.01](https://github.com/osu-tournament-rating/otr/compare/2026.08.16...2026.09.01)
- [2026.08.16](https://github.com/osu-tournament-rating/otr/compare/2026.06.16...2026.08.16)
