The o!TR team requires tournaments meet the criteria below before being accepted into our rating system. Please note that the team reserves the final say on whether a specific tournament is deemed fair for acceptance into our system.

> [!note]
> A comprehensive page of all submitted tournaments and their respective approval statuses can be seen on the [tournament listing](https://otr.stagec.net/tournaments).
> For more details on the verification review process, see [[Data Verification|this page]].

The following is a reference on what constitutes an acceptable tournament and how to submit new data.

## Acceptance criteria

In order for a tournament to be accepted into the o!TR system for rating calculation, it should abide by the following guidelines. The o!TR team may make exceptions to the criteria below, but any such cases will be clearly documented with admin notes explaining the circumstances.

> [!important]
> Badge eligibility is **not** a requirement for acceptance, and conversely, not all badged tournaments meet the criteria below.

1. Feature a bracket size of at least Round of 8 double elimination.
1. Publicly document all match links to an acceptable standard, such as through a public Google sheet.
1. Not have significant lapses in data, such as missing a full round of matches or a large amount of forfeits.
    - Exceptions are made for older tournaments for the sake of preservation.
1. Show no evidence of match fixing, collusion, or other forms of competitive integrity violations.
    - In the case of isolated matches or games with extenuating circumstances, such as organizer nullification or cheating, the o!TR team may reject only that data as long as documented reasoning is provided.
1. Target an acceptable skill range of players[^1].
    - For osu!, the upper rank restriction should be no lower than `#150,000+`. The team reserves the right to make exceptions up to a ceiling of `#300,000+` if the tournament is particularly central to the competitive scene.
    - For all other game modes, there is no restriction on rank range.
1. Have a forum post or wiki page hosted on the osu! website.
1. Use the [ScoreV2](https://osu.ppy.sh/wiki/en/Gameplay/Game_modifier/ScoreV2) win condition and avoid unconventional mods such as Sudden Death or Relax throughout the tournament.
    - A maximum of one pooled beatmap per round may be tied to an alternate win condition (such as Accuracy or ScoreV1) or unconventional mod. Games featuring such beatmaps will be rejected, but the rest of the match and the tournament as a whole may still pass verification.
1. Not use variable lobby sizes or [game modes](https://osu.ppy.sh/wiki/en/Game_mode). Examples include:
    - Battle royale style tournaments.
    - Multi-mode tournaments.
    - Free-for-all tournaments[^3].
1. Feature a format that allows players to play at their full competitive strength throughout all matches.
    1. Mild gimmicks, such as unusual skillset pooling or pick/ban strategy, are generally acceptable. More unconventional formats may be judged by taking other factors into account (e.g. skill range and unconventional win conditions or mods, as listed above) to see whether the tournament strays too far from a typical environment.
1. Feature no asynchronous matches.
    1. Exceptions may be made if there are a very small fraction of such matches present; those matches will always be rejected.
1. Have discernible team compositions from match links alone [^4].

> [!example]
>
> - [Fulminare Ascension](https://osu.ppy.sh/community/forums/topics/2051608?n=1) is considered acceptable despite having roughly one accuracy or misscount win condition map per round and a slightly unconventional pooling and tiebreaker format.
> - [Pokémon Battle Tournament](https://osu.ppy.sh/community/forums/topics/1790791?n=1) is considered barely unacceptable due to the special HP / targeting rules creating alternate win conditions.

### osu!mania

In addition to the above criteria, osu!mania tournaments must:

1. Be of the 4-key or 7-key variants.
1. Not feature a format where multiple key counts are played simultaneously.

## Submission

When submitting a tournament, follow these steps:

1. Ensure the tournament is finished.
1. Gather all match links from bracket stages (and group stages if applicable).
    - Exclude links from qualifiers, tryouts, or show matches.
1. Gather all beatmap IDs pooled in the tournament, including qualifiers and group stages[^2].
    - Note that the _beatmap_ ID, rather than the _beatmapset_ ID, must be provided. For example, enter `75` rather than `1` for [this beatmap](https://osu.ppy.sh/beatmapsets/1#osu/75).
1. Enter the above data along with requested general tournament information on the [website submission form](https://otr.stagec.net/tournaments/submit).

An o!TR admin approves each submission before any of its data is fetched. Until then, the submission appears only to its submitter, under Your submissions on the submission page, and to admins. Submissions from admins skip this step.

Additionally, keep the following in mind for tiered tournaments or tournaments that feature multiple divisions:

> [!warning]
> Carefully check how the tournament defines the word "tier". The o!TR team considers "tiered" tournaments to be **tournaments where multiple rank ranges are participating within the same bracket** (usually on the same team). In cases where multiple brackets are used, we use the term **division**.

1. Tiered tournaments must be submitted as a single tournament. In this case, for the rank range field, denote the rank as the top-end rank restriction for the tournament.
    - [Broccoli Cup 3](https://otr.stagec.net/tournaments/525) is an example of a tiered tournament.
1. For divisional tournaments, submit them as separate tournaments - **one submission per bracket**. Append "(Division 1)", "(Division 2)", etc. to the tournament's title when submitting.

> [!example]
> Here are examples of multiple submissions for different divisions from the same tournament:
>
> - [hubba's hidden hooplah (Master Division)](https://otr.stagec.net/tournaments/2349)
> - [hubba's hidden hooplah (Weasel Division)](https://otr.stagec.net/tournaments/2350)
> - [hubba's hidden hooplah (Ninja Division)](https://otr.stagec.net/tournaments/2351)

## FAQ

### How far back can submissions be from?

Any tournament may be submitted from any time period. Make sure to do quality checks against our [[Tournament Approval#Acceptance criteria|acceptance criteria]].

### What if the tournament I want to submit is missing matches?

If the tournament is not yet finished, do not submit it. If a very old tournament is missing data, it is okay to submit it anyway as we do care about data preservation. If the tournament started on or after January 01, 2021 and is missing data, or you are unsure, please ask in our [[Contact#Quick Links|Discord Server]].

### Is it okay for two tournaments to share the same abbreviation?

Yes, this is fine.

### What about weird abbreviations?

If a tournament uses inconsistent abbreviations, please inform an o!TR team member after submitting. When submitting, in the abbreviation field, write the most consistent portion. For example, if a tournament has a scheme like so: `IGTS RO16`, `IGTS QF`, only write `IGTS` in the submission field.

### What's the best way to gather match links?

We know how time-consuming it is to gather links. There's a few methods we use for this:

- Contact the tournament host, spreadsheet owner, referee, or anyone else who may have access to that tournament's match data. Kindly ask them for a list of links or match ids.
- Assuming the data is on a Google sheet, an alternative is to use the `=IMPORTRANGE()` function on the cells with the match links to import them to a new sheet. You can then extract the links in the new sheet with a script detailed in [this post](https://stackoverflow.com/a/67206954).
- When in doubt, have the tournament's spreadsheet maintainers [[Contact|contact us]].

### How can invalid data be flagged for review?

Invalid data, such as warmups, show matches, or any other data that should not be in the system are primarily detected via [[Automated Checks|automated checks]]. In the future, users will be able to report invalid data for correction. Until then, know that this data does not significantly affect rating values, but please note it down so you can let us know later!

[^1]: This restriction exists in order to avoid "farming" rating from isolated pockets of newer tournament players, keeping in mind that most players below this rank range rarely play in subsequent tournaments.
[^2]: This data is used during the [[Automated Checks|automated checks]] process to flag warmups and generate additional tournament statistics.
[^3]: While free-for-all tournaments (e.g. 1v1v1v1) maintain a constant lobby size and do not cause issues with the rating algorithm itself, the presence of multiple opposing teams does not fit into the current framework for win-loss records, teammate/opponent statistics, and so on. The question of adding support for more complex rosters is still an open point of discussion.
[^4]: While the o!TR processor typically converts 1v1 tournaments that are played in the Head-to-head [team mode](https://osu.ppy.sh/wiki/en/Client/Interface/Multiplayer#team-mode-gameplay) to Team VS, it will be unable to do so if each team has more than one player because there are no indicators of which team each player is assigned to. Thus, some 1v1 tournaments with a team size larger than 1 (such as [BATBALL's Gimmick Emporium](https://osu.ppy.sh/community/forums/topics/1767170?n=1)) currently cannot be accepted and will not count towards ratings unless manual roster adjustment becomes possible.
