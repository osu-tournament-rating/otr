import { Ruleset } from '@otr/core/osu';

/**
 * Fitted cohort baselines for the beatmap game-closeness card. A cohort is
 * `games.ruleset` x team size (capped at 5); cells under `MIN_COHORT_GAMES`
 * fall back through `ruleset` to `global`.
 *
 * Refit: `betweenMapVariance` is a one-way random-effects estimate over maps
 * with at least two games in scope — `tau^2 = (MSB - MSW) / n0`,
 * `n0 = (N - sum(n_i^2) / N) / (groups - 1)`, `icc = tau^2 / (tau^2 + MSW)`,
 * `shrinkageK = (1 - icc) / icc`. `zDecileEdges` are q10..q90 of
 * `(lr - meanLogRatio) / sdLogRatio`, interpolated at index `q * (n - 1)`.
 * Source rows:
 *
 * ```sql
 * SELECT g.beatmap_id,
 *        g.ruleset,
 *        LEAST(MIN(cardinality(r.roster)), 5) AS team_size,
 *        LN(MAX(r.score)::float8 / MIN(r.score)) AS lr
 * FROM game_rosters r
 * JOIN games g ON g.id = r.game_id
 * JOIN matches m ON m.id = g.match_id
 * JOIN tournaments t ON t.id = m.tournament_id
 * WHERE t.verification_status = 4
 *   AND m.verification_status = 4
 *   AND g.verification_status = 4
 *   AND (g.team_type = 2 OR (g.team_type = 0 AND t.lobby_size = 1))
 * GROUP BY g.id, g.beatmap_id, g.ruleset
 * HAVING COUNT(*) = 2
 *    AND MAX(cardinality(r.roster)) = MIN(cardinality(r.roster))
 *    AND MIN(r.score) > 0
 * ```
 *
 * Aggregate those rows three ways: per (ruleset, team_size), per ruleset, and
 * pooled. Ruleset 3 (ManiaOther) has no qualifying games, so it has no row.
 * The fit predates the team type 0 branch, but counts those games: until
 * October 2026 the automated checks converted head-to-head games in 1v1
 * tournaments to team type 2.
 */

/** Qualifying games behind the fit. */
export const CORPUS_GAMES = 932137;

/** Games a (ruleset, team size) cell needs before it earns its own row. */
export const MIN_COHORT_GAMES = 1000;

/** Which population a baseline row was fitted over. */
export type BaselineScope = 'cohort' | 'ruleset' | 'global';

/** q10..q90 of the standardized game-level distribution within a scope. */
export type ZDecileEdges = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface ClosenessBaseline {
  scope: BaselineScope;
  /** Null on the global row. */
  ruleset: Ruleset | null;
  /** Null on ruleset and global rows. */
  teamSize: number | null;
  gameCount: number;
  /** Mean of `ln(winning score / losing score)`. */
  meanLogRatio: number;
  /** Sample SD of `ln(winning score / losing score)`. */
  sdLogRatio: number;
  /** Random-effects between-map variance of the log ratio. */
  betweenMapVariance: number;
  /** `betweenMapVariance / (betweenMapVariance + withinMapVariance)`. */
  icc: number;
  /** Games of evidence a map needs to move halfway off the baseline. */
  shrinkageK: number;
  zDecileEdges: ZDecileEdges;
}

export const CLOSENESS_BASELINES: readonly ClosenessBaseline[] = Object.freeze([
  {
    scope: 'cohort',
    ruleset: Ruleset.Osu,
    teamSize: 1,
    gameCount: 344814,
    meanLogRatio: 0.491345,
    sdLogRatio: 0.455233,
    betweenMapVariance: 0.017629,
    icc: 0.085103,
    shrinkageK: 10.750515,
    zDecileEdges: [
      -0.9467, -0.7953, -0.6281, -0.4476, -0.2507, -0.0318, 0.238, 0.6058,
      1.2249,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Osu,
    teamSize: 2,
    gameCount: 233937,
    meanLogRatio: 0.350135,
    sdLogRatio: 0.317539,
    betweenMapVariance: 0.008515,
    icc: 0.084405,
    shrinkageK: 10.847574,
    zDecileEdges: [
      -0.9514, -0.7931, -0.6281, -0.4502, -0.2527, -0.0277, 0.2512, 0.6234,
      1.2307,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Osu,
    teamSize: 3,
    gameCount: 86700,
    meanLogRatio: 0.27618,
    sdLogRatio: 0.245877,
    betweenMapVariance: 0.005886,
    icc: 0.097351,
    shrinkageK: 9.272078,
    zDecileEdges: [
      -0.961, -0.7964, -0.6267, -0.4468, -0.244, -0.0173, 0.2584, 0.631, 1.2376,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Osu,
    teamSize: 4,
    gameCount: 93054,
    meanLogRatio: 0.223734,
    sdLogRatio: 0.196865,
    betweenMapVariance: 0.003608,
    icc: 0.093216,
    shrinkageK: 9.72781,
    zDecileEdges: [
      -0.9739, -0.8051, -0.6334, -0.4491, -0.246, -0.0112, 0.2692, 0.643,
      1.2605,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Osu,
    teamSize: 5,
    gameCount: 1072,
    meanLogRatio: 0.188817,
    sdLogRatio: 0.176727,
    betweenMapVariance: 0.004563,
    icc: 0.145168,
    shrinkageK: 5.888592,
    zDecileEdges: [
      -0.9243, -0.7953, -0.6162, -0.4594, -0.2667, -0.0389, 0.2429, 0.6103,
      1.1683,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Taiko,
    teamSize: 1,
    gameCount: 32771,
    meanLogRatio: 0.139178,
    sdLogRatio: 0.272613,
    betweenMapVariance: 0.010637,
    icc: 0.142294,
    shrinkageK: 6.027686,
    zDecileEdges: [
      -0.4834, -0.448, -0.4058, -0.3531, -0.2906, -0.2054, -0.0798, 0.1397,
      0.642,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Taiko,
    teamSize: 2,
    gameCount: 19324,
    meanLogRatio: 0.066322,
    sdLogRatio: 0.112259,
    betweenMapVariance: 0.001859,
    icc: 0.151206,
    shrinkageK: 5.613487,
    zDecileEdges: [
      -0.5411, -0.4846, -0.424, -0.355, -0.2741, -0.1731, -0.0321, 0.2002,
      0.6875,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Taiko,
    teamSize: 3,
    gameCount: 3492,
    meanLogRatio: 0.072078,
    sdLogRatio: 0.099558,
    betweenMapVariance: 0.001979,
    icc: 0.200899,
    shrinkageK: 3.977619,
    zDecileEdges: [
      -0.6651, -0.6017, -0.5299, -0.4407, -0.3292, -0.184, 0.0193, 0.3286,
      0.9905,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Taiko,
    teamSize: 4,
    gameCount: 1722,
    meanLogRatio: 0.048327,
    sdLogRatio: 0.055485,
    betweenMapVariance: 0.000614,
    icc: 0.228029,
    shrinkageK: 3.385398,
    zDecileEdges: [
      -0.7673, -0.6669, -0.5545, -0.4492, -0.32, -0.1563, 0.0832, 0.4317,
      1.1258,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Catch,
    teamSize: 1,
    gameCount: 27577,
    meanLogRatio: 0.147728,
    sdLogRatio: 0.205612,
    betweenMapVariance: 0.007967,
    icc: 0.187171,
    shrinkageK: 4.342703,
    zDecileEdges: [
      -0.6615, -0.5701, -0.4863, -0.3893, -0.2765, -0.1373, 0.0451, 0.3196,
      0.8676,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Catch,
    teamSize: 2,
    gameCount: 5437,
    meanLogRatio: 0.093258,
    sdLogRatio: 0.096501,
    betweenMapVariance: 0.000999,
    icc: 0.114138,
    shrinkageK: 7.761331,
    zDecileEdges: [
      -0.8523, -0.7284, -0.593, -0.4567, -0.2883, -0.0969, 0.1539, 0.5179,
      1.1633,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Catch,
    teamSize: 3,
    gameCount: 9418,
    meanLogRatio: 0.072068,
    sdLogRatio: 0.10122,
    betweenMapVariance: 0.003848,
    icc: 0.374759,
    shrinkageK: 1.668384,
    zDecileEdges: [
      -0.642, -0.5656, -0.4799, -0.3841, -0.2822, -0.1508, 0.0212, 0.283,
      0.7799,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Mania4k,
    teamSize: 1,
    gameCount: 46894,
    meanLogRatio: 0.0452,
    sdLogRatio: 0.147089,
    betweenMapVariance: 0.003429,
    icc: 0.158889,
    shrinkageK: 5.293712,
    zDecileEdges: [
      -0.2961, -0.2826, -0.2662, -0.2452, -0.2179, -0.1811, -0.1218, -0.0159,
      0.2755,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Mania4k,
    teamSize: 2,
    gameCount: 5408,
    meanLogRatio: 0.03293,
    sdLogRatio: 0.089228,
    betweenMapVariance: 0.002634,
    icc: 0.353464,
    shrinkageK: 1.82914,
    zDecileEdges: [
      -0.3539, -0.3368, -0.3181, -0.2932, -0.2619, -0.2165, -0.1438, -0.0136,
      0.3914,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Mania4k,
    teamSize: 3,
    gameCount: 11780,
    meanLogRatio: 0.018933,
    sdLogRatio: 0.051701,
    betweenMapVariance: 0.000841,
    icc: 0.329781,
    shrinkageK: 2.032312,
    zDecileEdges: [
      -0.3431, -0.3181, -0.2917, -0.2589, -0.2216, -0.1705, -0.099, 0.0176,
      0.3131,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Mania7k,
    teamSize: 1,
    gameCount: 6153,
    meanLogRatio: 0.065499,
    sdLogRatio: 0.160988,
    betweenMapVariance: 0.005377,
    icc: 0.207775,
    shrinkageK: 3.812897,
    zDecileEdges: [
      -0.3815, -0.3539, -0.3185, -0.2782, -0.2316, -0.1649, -0.0682, 0.0757,
      0.4499,
    ],
  },
  {
    scope: 'cohort',
    ruleset: Ruleset.Mania7k,
    teamSize: 2,
    gameCount: 2370,
    meanLogRatio: 0.030137,
    sdLogRatio: 0.051814,
    betweenMapVariance: 0.000348,
    icc: 0.143105,
    shrinkageK: 5.987855,
    zDecileEdges: [
      -0.53, -0.4733, -0.4097, -0.3398, -0.2606, -0.1644, -0.0216, 0.1942,
      0.6511,
    ],
  },
  {
    scope: 'ruleset',
    ruleset: Ruleset.Osu,
    teamSize: null,
    gameCount: 759577,
    meanLogRatio: 0.390084,
    sdLogRatio: 0.383272,
    betweenMapVariance: 0.01203,
    icc: 0.081853,
    shrinkageK: 11.217039,
    zDecileEdges: [
      -0.8923, -0.7579, -0.6137, -0.4546, -0.2755, -0.0635, 0.1985, 0.5641,
      1.2002,
    ],
  },
  {
    scope: 'ruleset',
    ruleset: Ruleset.Taiko,
    teamSize: null,
    gameCount: 57309,
    meanLogRatio: 0.107793,
    sdLogRatio: 0.220838,
    betweenMapVariance: 0.007468,
    icc: 0.15275,
    shrinkageK: 5.546652,
    zDecileEdges: [
      -0.4591, -0.4232, -0.3832, -0.3354, -0.2751, -0.1973, -0.0796, 0.1214,
      0.5935,
    ],
  },
  {
    scope: 'ruleset',
    ruleset: Ruleset.Catch,
    teamSize: null,
    gameCount: 42432,
    meanLogRatio: 0.123955,
    sdLogRatio: 0.178964,
    betweenMapVariance: 0.00635,
    icc: 0.196948,
    shrinkageK: 4.07749,
    zDecileEdges: [
      -0.6381, -0.5585, -0.4792, -0.3918, -0.2829, -0.1496, 0.0325, 0.3037,
      0.8656,
    ],
  },
  {
    scope: 'ruleset',
    ruleset: Ruleset.Mania4k,
    teamSize: null,
    gameCount: 64082,
    meanLogRatio: 0.039335,
    sdLogRatio: 0.130769,
    betweenMapVariance: 0.002807,
    icc: 0.165,
    shrinkageK: 5.060604,
    zDecileEdges: [
      -0.2892, -0.2759, -0.2602, -0.2401, -0.2138, -0.178, -0.1222, -0.0176,
      0.2654,
    ],
  },
  {
    scope: 'ruleset',
    ruleset: Ruleset.Mania7k,
    teamSize: null,
    gameCount: 8737,
    meanLogRatio: 0.05525,
    sdLogRatio: 0.138852,
    betweenMapVariance: 0.004077,
    icc: 0.212823,
    shrinkageK: 3.698741,
    zDecileEdges: [
      -0.3717, -0.3448, -0.3112, -0.273, -0.2249, -0.1627, -0.0639, 0.0776,
      0.4427,
    ],
  },
  {
    scope: 'global',
    ruleset: null,
    teamSize: null,
    gameCount: 932137,
    meanLogRatio: 0.333362,
    sdLogRatio: 0.374072,
    betweenMapVariance: 0.022957,
    icc: 0.163749,
    shrinkageK: 5.106904,
    zDecileEdges: [
      -0.8434, -0.7564, -0.6349, -0.4843, -0.3038, -0.0875, 0.1853, 0.5577,
      1.204,
    ],
  },
]);
