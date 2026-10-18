The o!TR suite of tools processes various amounts of data in various ways.

## Tournament Data

We process data from osu! multiplayer lobbies. This data comes from tournament data. Any osu! player who has participated in any of the lobbies submitted to o!TR will have some of their account information stored in our system.

This data includes:

- Tournament performance data
- Scores
- Games participated

- osu! profile information: Player ID, username, country, and global ranks for all rulesets
- osu!track information: Closest global rank (with timestamp) to the first date of play in a verified tournament, for each ruleset

### Data Manipulation

The o!TR team manipulates raw match data in the following ways:

- Automatically multiply all score values that have the [`EZ` modifier](https://osu.ppy.sh/wiki/en/Gameplay/Game_modifier/Easy) by **1.75x**. This is in the range of typically used multipliers when scores with the `EZ` mod are compared to scores with other mods.
- When possible, automatically convert 1v1 matches played in the `HeadToHead` team mode to `TeamVS`.
- Correct match records (such as in the ways described [[Data Verification#Modifying submitted data|here]]) with corresponding public documentation.
