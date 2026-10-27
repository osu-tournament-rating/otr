# Palettes and charts

Each domain keeps its own palette. A colour from one never stands in for another, and status colours only ever mean status.

## Categorical chart palette

- Neutral series, rank ranges, teams and the five chart mods take `chart-1` to `chart-8` **in this fixed order**. Never cycle it: a ninth series folds into `chart-other`.
- `chart-1` is the brand blue stepped to clear 3:1 on light cards. A single-series chart uses it.

## Verification

- Five statuses. The glyph shows the outcome and a dashed outline marks an automated check: Verified and Pre-verified in `verification-verified`, Rejected and Pre-rejected in `verification-rejected`, Pending in `verification-neutral`.
- Pending, Pre-verified and Pre-rejected are "Not in ratings yet" everywhere, and charts draw that bar in `verification-neutral`.
- Statuses are not ordered by meaning; never sort or compare them as if they were.

## Tiers

- Nine tiers, highest first: Elite Grandmaster, Grandmaster, Master, Diamond, Emerald, Platinum, Gold, Silver, Bronze. Each `tier-*` token colours that tier's name (text) and its chart marks; the tier badges in the Tiers asset group carry their own colours.
- Every tier but Elite Grandmaster has subtiers I, II and III.

## Mods

- Mod charts colour five mods: NM, HD, HR, DT and FL take `chart-1` to `chart-5`, in that order. Every other mod or combination is one "Other" group in `chart-other`, in the data as well as the colour, placed last. Box plots leave "Other" out.
- Every mod colour takes black text on its solid fill, in both themes.
- Mod badges (`ModIconset`) are the one exception: they mirror osu-web's lazer badges and colour by osu-web's mod types (blue automation, purple conversion, red difficulty increase, lime difficulty reduction, pink fun, yellow system), the same in both themes. Never use those type colours for a chart, swatch or pill; those keep the chart colours.
- Mod names are osu!'s proper names and keep its Title Case: "Hard Rock", "Spun Out", "Seven Keys".

## Score grades

- Grade marks are one blue ramp mixed from `chart-1`, SS strongest and D faintest: SS and S mixed toward `foreground`, A as `chart-1`, and B to D mixed toward `card`. No grade has a token.

## Match teams

- `match-red` and `match-blue` draw team edges, tints, swatches and chart lines; `match-red-foreground` and `match-blue-foreground` are the team text. Scores with no team are `match-no-team`.
- On the match page a game sits in a recessed `game-frame` holding lighter `score-card`s.

## Charts

- Every chart sits in a panel with a section header.
- One tick rule, at most six ticks. Counts get thousands separators; years and IDs never do.
- One tooltip, on `background` (not `accent`), with tabular values. One legend, for two or more series.
- Chart text is Inter like everything else, at 12px or larger.
