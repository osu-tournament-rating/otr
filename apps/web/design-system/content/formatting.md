# Writing values

One way to write each kind of value, the same for every visitor. Never format with the visitor's locale or time zone.

| Value                        | Write it as                                                                          | Never                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| A day                        | `Jul 20, 2024`                                                                       | `2024-07-20` (ISO days are for URLs and files only) |
| A span of days               | `Jul 20 – Aug 3, 2024` (a spaced en dash)                                            | `2024-07-20 - 2024-08-03`, weekdays                 |
| A moment                     | `Jul 20, 2024, 15:42 UTC`                                                            | local time, 12-hour clocks, `UTC+02:00`             |
| Two moments in a day         | `15:42 – 15:45 UTC`                                                                  | two timestamps with a hand-made dash                |
| Recent activity (feeds only) | `just now`, `5m ago`, `3h ago`, `12d ago`, then the date from 30 days                | relative time in tables, headers or detail pages    |
| A count                      | `1,368`                                                                              | a bare `1368`                                       |
| A rank                       | `#1,234`; a shared rank `=#7`                                                        | `#1234`                                             |
| A rating                     | a whole number, `1,835`                                                              | decimals, except where they are the point           |
| A rating change              | `↑ +18.7`, `↓ −4.2`, `→ 0.0` (one decimal, a true minus) after the number it changes | two decimals, a tinted pill                         |
| A percentile                 | the ordinal, `93rd percentile`                                                       | `97.53%`                                            |
| Years and IDs                | `2024`, `12345678` (no separator)                                                    | `2,024`                                             |
| A beatmap length             | `m:ss`, or `h:mm:ss` from an hour                                                    |                                                     |
| A tier                       | `Gold II`, `Bronze III`, `Elite Grandmaster` (no subtier)                            | `Gold 2`                                            |
| Mods                         | `HD, HR`                                                                             |                                                     |
| Rulesets                     | `osu!`, `taiko`, `catch`, `mania 4K`, `mania 7K`                                     | `Osu!`, `Standard`                                  |
| Missing                      | an em dash `—` in `muted-foreground`                                                 | blank, `N/A`, `0`                                   |

- Rating changes take `color-success-foreground` up, `destructive-foreground` down and `muted-foreground` flat; the arrow and sign carry the direction, colour only reinforces it.
- Counts, ranks and ratings take tabular figures in columns. Dates keep proportional figures.
- Status names are sentence case: Verified, Pre-verified, Pending, Pre-rejected, Rejected.
