---
tags:
  - math
---

Although not used in rating calculations directly, o!TR does keep track of match costs for use in other statistics, such as gauging performance across tournaments. The formula is as follows.

## Formula

The match cost formula is inspired by [Bathbot](https://github.com/MaxOhn/Bathbot)'s formula, simplified to remove factors that are not relevant for our purposes. For each map played, each player receives a map score between $0.5$ and $1.5$, specifically
$$
\begin{equation}
    \text{map score} = 0.5 + \text{normcdf}\left(\frac{\text{score} - \text{avg}(\text{scores on map})}{\text{stddev}(\text{scores on map})}\right).
\end{equation}
$$
These map scores are then averaged together and multiplied by a bonus factor for playing more of the match, specifically
$$
\begin{equation}
    \text{lobby bonus} = 1 + 0.3 \cdot \sqrt{\frac{\text{maps played} - 1}{\text{total maps} - 1}}.
\end{equation}
$$

Thus, match cost values will range from $0.5$ to $1.95$, with a typical value being around $1.2$.

> [!note]
> Some other match cost formulas include bonus factors for playing in tiebreaker or playing a variety of different mods during a match. We do not include such factors so that our formula primarily reflects relative performance rather than contribution towards winning. In our formula, the winner of a 1v1 match will always have a higher match cost, even if they won their maps by much smaller margins.

## Tournament Match Cost

A tournament's top performers are ranked by a match cost for the whole tournament. It averages the player's match costs across the verified matches they played in, then multiplies that average by a bonus for playing more matches, specifically
$$
\begin{equation}
    \text{tournament match cost} = \text{avg}(\text{match costs}) \cdot \left(0.9 + 0.1 \cdot \min(\text{matches played}, 6)\right).
\end{equation}
$$
The bonus grows from $1$ for a single match to $1.5$ for six or more, so one strong match cannot outrank a strong run through the whole bracket.
