---
name: stats-ideas
description: Find new statistics worth showing on the o!TR website by querying a local copy of production-like data. Use when asked to brainstorm, find, or evaluate new stats, metrics, insights, records, or charts for a page such as a player profile, tournament, match, beatmap, leaderboard, or the /stats page. Covers starting a read-only database, what each page already shows, the data model and its traps, testing each idea against real data, and the report format.
---

# Finding new stats

A stat idea is only worth proposing once real data shows three things: most
of the pages it would appear on have enough data to fill it, its values vary
enough to tell visitors something, and it can be served fast enough. Ideas
that sound good but fail one of these are the common failure. Test every idea
with a query before you propose it.

## Setup

1. Run `apps/scripts/otr up --no-web`. It gives this worktree a copy of the
   developer's local database, which holds production-like data (about 100k
   players, 3k tournaments, and 5M scores). The copy's age is printed next to
   `db`.
2. Run every query through `.claude/skills/stats-ideas/scripts/q.sh`. It
   takes any psql arguments, for example `q.sh -c "select ..."` or
   `q.sh -f idea.sql`. It connects only to this worktree's stack, opens every
   transaction read-only, and stops a statement after 60 seconds
   (`Q_TIMEOUT=5min` raises it; Postgres units are `s` and `min`). Never
   query `localhost:5432`.
3. Read-only mode also blocks temporary tables, so write each analysis as
   one query with CTEs. When a correlated `exists` over many rows times out,
   rewrite it as a join against a `materialized` CTE.
4. Put scratch SQL files in your scratchpad directory, not in the repository.
5. When you finish, run `apps/scripts/otr down` unless the user wants to keep
   exploring, and say which you did.

## 1. Pick the scope

Ask which page or audience the user cares about if they didn't say. Each
page answers a different question:

- Player profile: how good am I, how am I trending, and what is my style?
- Tournament: what happened, who stood out, and how strong was the field?
- Match: who carried, and was it close?
- Beatmap: how hard was it in practice, and who does it suit?
- Leaderboard: how do players compare? Only a filter or a sortable column
  fits here.
- `/stats`: what does the whole scene look like, and how has it changed?

## 2. Read what the page already shows

Never propose a stat a page already shows, or one a visitor can read off a
number next to it. Open the page file (`app/<page>/page.tsx`, which wires up
tabs) and its components before you generate ideas. Compare what the
procedure returns with what the page renders: a field that is returned but
never shown is the cheapest idea there is. Paths are under `apps/web`:

| Page         | Components                                                            | Procedures (`app/server/oRPC/procedures/`)               |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------------------- |
| Player       | `components/player/`                                                  | `playerProcedures.ts`, `playerRatingsProcedures.ts`      |
| Tournament   | `components/tournaments/`, `components/beatmaps/list/` (Beatmaps tab) | `tournamentsProcedures.ts`                               |
| Match        | `components/matches/`, `components/games/`                            | `matchesProcedures.ts`                                   |
| Beatmap      | `components/beatmap/`                                                 | `beatmapProcedures.ts`, `beatmapStatsHelpers.ts`         |
| Beatmap list | `components/beatmaps/list/`                                           | `beatmapListProcedures.ts`                               |
| Leaderboard  | `components/leaderboard/`                                             | `leaderboardProcedures.ts`, `shared/leaderboardQuery.ts` |
| `/stats`     | `components/stats/`                                                   | `statsProcedures.ts`, `stats/statsPageProcedures.ts`     |

If the table has gone stale, fix it in the same change.

## 3. Know the data

The schema is `packages/otr-core/src/db/schema.ts`. Enum numbers are in
`packages/otr-core/src/osu/enums.ts`. Look them up there rather than
guessing. The data has three layers:

- Raw match data, fetched from osu!: `tournaments` → `matches` → `games` →
  `game_scores`, plus `beatmaps` and `join_pooled_beatmaps` for mappools.
  `match_rosters.score` is the maps a team won in the match, while
  `game_rosters.score` is the team's summed score in one game.
- Stats precomputed by the data worker (`apps/data-worker/src/stats/`):
  `player_match_stats` (match cost, averages, teammates, opponents) and
  `player_tournament_stats`. Postgres triggers keep `beatmap_stats` current.
- Ratings rebuilt weekly by the processor: `player_ratings` holds only the
  current rating per player and ruleset. `rating_adjustments` is the whole
  history, one row per match, decay, or initial rating. A player's rating
  at the time of a match is that match's `rating_adjustments.rating_before`,
  never `player_ratings`. Tier boundaries are `baseRating` in
  `apps/web/lib/utils/tierData.ts`. Players' osu!
  profile data is in `players`, `player_osu_ruleset_data`, and
  `player_highest_ranks`.

Traps that produce wrong numbers:

- **Count only verified data.** Public stats use
  `verification_status = 4` (Verified). Each level has its own status, so a
  verified match can hold rejected games and scores. Filter every level you
  join. Never compare statuses with `<` or `>`.
- **Split by ruleset.** osu!, taiko, catch, and mania are separate
  communities with separate ratings. Never pool them in one number. Mania is
  rulesets 4 (4K) and 5 (7K). Ruleset 3 has a few tournaments but no
  ratings, and none of them is verified.
- **Every verified game is TeamVs on ScoreV2**, including 1v1s, so
  `games.team_type` can't tell formats apart. Use `tournaments.lobby_size`
  or the roster size.
- **Matches can be level.** Some verified matches end with equal
  `match_rosters.score`. Leave them out of win and upset logic.
- **Mods are bitflags.** Test them with `mods & 8 <> 0`, never with `=`.
  Scores may carry mods the game doesn't (freemod).
- **Some columns are empty.** `game_scores.pp` is null for every verified
  score, and some beatmaps have `sr = 0`. Check a column's null rate before
  you build on it.
- **Star rating with mods is partial.** `beatmap_attributes` covers only
  osu! standard beatmaps: `mods = 0` (NM) plus each mod key that any score in
  a verified game played, rejected scores included. A key keeps only EZ, HD, HR, and DT, with
  NC counted as DT, so join a score on its key, never on raw mods. With
  `m = games.mods | game_scores.mods`, the key is null when `m & 9604 <> 0`
  (HT, FL, TD, RX, or AP, which have no row), and otherwise
  `(m | CASE WHEN m & 512 <> 0 THEN 64 ELSE 0 END) & 90`, as in
  `packages/otr-core/src/osu/attribute-mods.ts`. `calculator` names the
  rosu-pp-js release behind each row: its values can differ from osu!'s
  `beatmaps.sr`, and rows from two releases coexist while a recalculation
  runs. An older copy may have no rows at all.
- **Match cost has a ceiling.** In 1v1 it tops out at about 1.468, so a
  "best match cost" record ties in every 1v1 tournament. Look at the spread
  of the maximum, not just the average.
- **Small samples mislead.** A 100% win rate from one match is noise. Choose
  a minimum sample, such as matches or games, and report how many entities
  clear it.
- **The data has edges.** Measure "recent" against the newest
  `tournaments.end_time` in the copy, not `now()`. At the other end, rated
  data starts around 2018, so "first tournament" or "first played" stats are
  inflated for early tournaments. Find the start and hide such stats there.
- **Raw scores compare only within a game.** A score depends on the map and
  the mods, so averaging raw scores across games mostly measures which maps
  were played. Compare players inside the same game (placement, or a share of
  the game's top score) and aggregate that instead.

## 4. Generate candidates

Aim for 10–20 candidates before you test any. Use these lenses:

- **Form and trend:** change over a window, streaks, peaks and slumps, and
  improvement since a player's first tournament.
- **Style:** mod preferences and their win rates, score consistency, and
  strengths by map type (star rating, length, or BPM bucket).
- **Context:** how a number compares with the field: rank within the
  tournament, percentile among players of the same tier, or strength of the
  opponents faced.
- **Relationships:** rivalries with head-to-head records, best partners, and
  teams that win more together than apart.
- **Narrative:** upsets (the lower-rated side won), comebacks, the closest
  games, and the deciding map.
- **Scene:** activity over time, country representation, how far ratings
  spread inside one tournament, and which maps keep returning to pools.

## 5. Test each candidate

Write a query for each idea and record four measurements:

1. **Coverage.** What share of the pages it would appear on get a
   non-empty, meaningful value? Count across all players with a current
   rating, or all verified tournaments, not just famous ones. A stat that
   fills under ~30% of pages needs an empty state the page can live with.
2. **Spread.** Show the distribution: `percentile_cont(array[.1,.5,.9])`
   or a histogram with `width_bucket`. If nearly everyone gets the same
   value, it tells visitors nothing.
3. **Examples.** Pull three to five real cases: a typical one, an extreme,
   and an edge case such as a player with few matches. Read them and check
   that the numbers make sense for those players.
4. **Cost.** Run `explain (analyze, buffers)` on the query for one entity,
   the way the page would call it, and note which indexes it uses
   (`\d table`). Under ~100 ms per entity can run per request. A stat that
   compares one entity with all the others, such as a percentile against
   every tournament, needs the whole population on every request, so plan to
   precompute or cache that part even when one entity is cheap. Anything
   slower needs precomputing. Name where: a new column in the data worker's stats tables,
   a Postgres trigger like `beatmap_stats`, the processor, or, for a
   site-wide stat on `/stats`, a stored platform stat
   (`packages/otr-core/src/platform-stats/`), which the data worker
   recomputes daily and after each rating run. Treat any table
   the processor reads or writes as a contract (see the root `AGENTS.md`).

## 6. Cut

Drop an idea when it:

- repeats something the page already shows, or can be read off it,
- is empty or noisy for most entities,
- would mislead, such as one ranking that mixes rulesets or eras,
- needs data the database doesn't have; say what would supply it instead,
- costs more to compute than it's worth on that page.

Keep a line on each dropped idea and why. The user often wants to know what
was ruled out.

## 7. Report

Rank the surviving ideas, best first. For each one, give:

- **Name and placement:** the page, and where on it, such as "Player
  profile, next to the rating history chart".
- **What visitors learn:** one sentence in the site's own wording. Reuse
  labels already on the page (match cost, win rate, rating, tier) instead
  of inventing terms.
- **Evidence:** coverage, the distribution, and one or two real examples
  from step 5.
- **How to build it:** the query or its core, the cost, and where it should
  be computed.
- **How to show it:** the shared component from the `web-design` skill that
  fits, such as a stat tile, chart, or table column. Load that skill before
  suggesting a display.

Then list the dropped ideas, one line each. Offer to file the ones the user
picks as `Feature` issues with the `issue` skill, and include the evidence
in each issue.
