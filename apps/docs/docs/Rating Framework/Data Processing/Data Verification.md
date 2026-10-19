Submitted tournaments run through a series of manual and automated checks before they may be processed for rating calculations. The [[Development/Platform Architecture#data worker|Data worker]] and [[Automated Checks|Automated Checks]] pages describe most of the automatic flow, while this page details the manual flow for verifying tournament data and provides more transparency on various conditions.

## Verifying or rejecting data

Once data finishes running through automated checks, each score, game, match, and tournament will be marked as either `PreVerified` or `PreRejected`. Typically, `PreVerified` data will end up `Verified` and `PreRejected` data will end up `Rejected` after manual review, and the steps below explain how the o!TR team interprets or modifies these statuses.

First, general information about the tournament, such as rank limit, name, and abbreviation, is cross-checked against the tournament's wiki page or forum post. If the tournament does not meet the [[Tournament Approval#Acceptance criteria|acceptance criteria]], it will be rejected, meaning that none of the match data will factor into ratings.

> [!note]
> There is currently no strict numerical cutoff for allowed forfeits or minimum match count per tournament. Admin notes will detail the rationale behind verifying or rejecting tournaments which fall into gray areas.

Next, matches that have been `PreRejected` or otherwise flagged are considered. If the match data is valid but not aligned with other automation rules, the source of the issue will be identified and necessary data will be altered to fix this. Then, data will be manually `Verified` or `Rejected` by the reviewer. If there are an usually small number of games (4 or fewer), verification depends on whether the match was forfeited early.

- There may be some ambiguity with partial matches, since they may come from the loser conceding early or as a result of technical issues or missing players. When in doubt, the original sources of truth -- the tournament bracket or main sheet -- are consulted.
- Pre-rejections due to lobby size mismatches (e.g. async matches or matches where the teams agreed to play 2v2 or 2v3 in a 3v3 tournament) will not be overridden, since they usually indicate extenuating circumstances and hence inaccurate performance prediction.

After that, reasons for rejection in any `PreRejected` games in verified matches are looked at more closely. One of the two most common reasons is a lobby size mismatch due to a mid-game disconnect or a "showmap" played at the end of the match for fun; in both cases, since we do not have full information on the true performance of the players, we do indeed reject the game from data.

> [!info]
> The minimum score check filters out in-lobby referees to prevent lobby size mismatches. If legitimate plays are affected, player performance is reviewed case-by-case.

The other common reason is that the beatmap was detected not to be in the list of beatmap IDs provided at submission. This almost always means a game was played at the beginning or end of the match for fun (and this automation process catches almost all such cases), but if this error is detected for a game in the middle of the match, we double-check whether the list of mappool IDs for the tournament is missing data and add to it if necessary.

> [!note]
> We do not ask for beatmap IDs to be separated by round during submission. This means that a warmup game may very rarely be counted as a verified game if the corresponding beatmap was pooled in a different round in the same tournament; if you notice this, please submit a ticket to the o!TR team.

At any point in this process, individual games or matches falling under the exceptions detailed in the [[Tournament Approval#Acceptance criteria|acceptance criteria]] may also be additionally verified or rejected, and appropriate admin note documentation will always be provided in such cases.

Finally, any remaining `PreVerified` data is marked as `Verified`, and any remaining `PreRejected` data is marked as `Rejected`.

### Restricted player data

Match data involving players who were restricted, including those who were tournament banned for foul play, is handled by the system just like any other match data. However, restricted players will not appear on any rating leaderboards. Depending on the influence of such players on the match, the o!TR team may include or exclude such games or matches from verification on a case-by-case basis.

### Modifying submitted data

The o!TR admins have the ability to manually modify match data in the database, including scores, tournament names, and match win records. (Note that this is different from simply changing the verification status of a score, game, match, or tournament.) Any such events will always be clearly documented in admin notes and made publicly viewable. Below is a non-exhaustive list of cases where this may be done, pending feature development:

- Renaming a tournament for consistency with past or future iterations
- Renaming individual match names to fix prefix inconsistencies
- Correcting the EZ (or other mod) multipliers specified in a particular tournament's ruleset by manually changing the appropriate scores across that tournament, in place of the [[Data Processing Overview#Data Manipulation|automatic 1.75x EZ multiplier]]
- Adding a new score to correct a lobby size mismatch if (1) the player disconnected mid-game but provided a local replay or records of an on-stream score and (2) that data was actually used as the source of truth for tournament proceedings
- Assigning team rosters to a 1v1 match played in the `HeadToHead` team mode so that the match may be converted to `TeamVS`
- Reassigning team rosters in a `TeamVS` match in case a player mistakenly assigned themselves the wrong team color for a game
- Removing "phantom mods" that mistakenly appear in scores (for example, players may mistakenly appear to play a map with the DT mod if the previous map was played with DT)
- Merging two matches into one if a match was split across two MP links due to technical difficulties

Any modifications of this kind, as well as any changes to verification status detailed above, will be recorded in audit logs. These logs include the time the change was made, the user who performed it, and the state of properties before and after the change; thus, any manual edits will be trackable and reversible if needed. While these audit logs will not be available in the [public replicas](https://data.otr.stagec.net) (since they are attached to specific users), more transparent record-keeping is in development.

### Effect on ratings

As mentioned on the [[Rating Calculation Overview#Rating update schedule|rating calculation]] page, changes to ratings and associated statistics occur on a regular schedule (each week at Tuesday 12:00 UTC). Thus, even though admin notes, changes to verification status, and modifications to match data will be viewable on the website immediately, their effects on player ratings will not be instantaneous. This minimizes the ability for an individual to manipulate TR by submitting tickets for individual scores, games, matches, or tournaments.
