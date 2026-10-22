'use client';

import { Team, VerificationStatus } from '@otr/core/osu';
import { ChartLine } from 'lucide-react';
import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { ChartLegend } from '@/components/kit/charts/ChartLegend';
import { ChartTooltipContent } from '@/components/kit/charts/ChartTooltip';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { getBeatmapArtist, getBeatmapTitle } from '@/lib/beatmaps/presentation';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';
import {
  CHART_CURSOR,
  CHART_LINE_WIDTH,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import { formatCompactTick, formatCountTick } from '@/lib/kit/charts/format';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getNiceTicks,
} from '@/lib/kit/charts/ticks';
import { seriesColor } from '@/lib/kit/color/categorical';
import { getTeamColor } from '@/lib/kit/color/teams';
import { formatMods } from '@/lib/kit/format/mods';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import type { Game, MatchPlayer } from '@/lib/orpc/schema/match';

/** The game a point charts, as the tooltip's title names it. */
interface ChartGame {
  mapNumber: number;
  beatmapTitle: string;
  beatmapArtist: string;
  beatmapDifficulty: string;
  mods: string;
}

export interface TeamScoreChartPoint extends ChartGame {
  mapLabel: string;
  redScore: number;
  blueScore: number;
  winner: 'red' | 'blue' | 'tie';
  scoreDifference: number;
}

/** A 1v1 game: each player's verified score, keyed `player-<id>`. */
export interface PlayerScoreChartPoint extends ChartGame {
  [series: `player-${number}`]: number;
  /** The winner's series key, or null for a tied game. */
  winner: `player-${number}` | null;
  /** "Kahli wins by 12,345", or "Game tied". */
  result: string;
}

/** One line: a team, or in a 1v1 a player. */
interface ScoreSeries {
  key: string;
  label: string;
  color: string;
}

const TEAM_SERIES: readonly ScoreSeries[] = [
  { key: 'redScore', label: 'Red team', color: getTeamColor(Team.Red) },
  { key: 'blueScore', label: 'Blue team', color: getTeamColor(Team.Blue) },
];

// Players take the palette in name order, so a colour never follows a result.
const nameCollator = new Intl.Collator('en-US', { sensitivity: 'base' });

function chartGame(game: Game, gameIndex: number): ChartGame {
  return {
    mapNumber: gameIndex + 1,
    beatmapTitle: game.beatmap
      ? (getBeatmapTitle(game.beatmap) ?? 'Unknown title')
      : 'Unknown title',
    beatmapArtist: game.beatmap
      ? (getBeatmapArtist(game.beatmap) ?? 'Unknown artist')
      : 'Unknown artist',
    beatmapDifficulty: game.beatmap?.diffName ?? 'Unknown difficulty',
    mods: formatMods(game.mods ?? 0),
  };
}

/** The verified scores of a verified game, best first; none otherwise. */
function verifiedScores(game: Game) {
  if (game.verificationStatus !== VerificationStatus.Verified) return [];

  return game.scores
    .filter((score) => score.verificationStatus === VerificationStatus.Verified)
    .sort((a, b) => b.score - a.score);
}

export function buildTeamScoreChartData(
  games: Game[] | undefined
): TeamScoreChartPoint[] {
  if (!games?.length) return [];

  return games.flatMap((game, gameIndex): TeamScoreChartPoint[] => {
    const scores = verifiedScores(game);
    const redScores = scores.filter((score) => score.team === Team.Red);
    const blueScores = scores.filter((score) => score.team === Team.Blue);

    if (redScores.length === 0 && blueScores.length === 0) {
      return [];
    }

    const redScore = redScores.reduce((total, score) => total + score.score, 0);
    const blueScore = blueScores.reduce(
      (total, score) => total + score.score,
      0
    );
    const scoreDifference = redScore - blueScore;

    return [
      {
        ...chartGame(game, gameIndex),
        mapLabel: `${gameIndex + 1}`,
        redScore,
        blueScore,
        winner:
          scoreDifference > 0 ? 'red' : scoreDifference < 0 ? 'blue' : 'tie',
        scoreDifference,
      },
    ];
  });
}

/**
 * A 1v1's verified games, player against player: each player's verified
 * score per game, with no team. The series are the players, in name order.
 */
export function buildPlayerScoreChartData(
  games: Game[] | undefined,
  players: readonly MatchPlayer[]
): { points: PlayerScoreChartPoint[]; series: ScoreSeries[] } {
  const usernames = new Map(
    players.map((player) => [player.id, player.username])
  );
  const nameOf = (playerId: number) =>
    usernames.get(playerId) ?? 'Unknown player';
  const playerIds = new Set<number>();
  const points: PlayerScoreChartPoint[] = [];

  (games ?? []).forEach((game, gameIndex) => {
    const scores = verifiedScores(game);
    const [first, second] = scores;
    if (!first) return;

    const tied = second !== undefined && second.score === first.score;
    const point: PlayerScoreChartPoint = {
      ...chartGame(game, gameIndex),
      winner: tied ? null : `player-${first.playerId}`,
      result: tied
        ? 'Game tied'
        : second
          ? `${nameOf(first.playerId)} wins by ${formatCount(first.score - second.score)}`
          : `${nameOf(first.playerId)} wins`,
    };

    for (const score of scores) {
      point[`player-${score.playerId}`] = score.score;
      playerIds.add(score.playerId);
    }

    points.push(point);
  });

  const series = [...playerIds]
    .map((playerId) => ({ key: `player-${playerId}`, label: nameOf(playerId) }))
    .sort((a, b) => nameCollator.compare(a.label, b.label))
    .map((entry, index) => ({ ...entry, color: seriesColor(index) }));

  return { points, series };
}

/** The result of one game, as the tooltip's footer says it. */
function describeResult(
  point: TeamScoreChartPoint | PlayerScoreChartPoint
): string {
  if ('result' in point) return point.result;
  if (point.winner === 'tie') return 'Game tied';
  const team = point.winner === 'red' ? 'Red' : 'Blue';
  return `${team} wins by ${formatCount(Math.abs(point.scoreDifference))}`;
}

function TooltipTitle({ point }: { point: ChartGame }) {
  return (
    <div className="flex max-w-64 flex-col gap-0.5">
      <span className="flex items-center justify-between gap-3">
        <span>Game {point.mapNumber}</span>
        <span className="font-normal text-muted-foreground">{point.mods}</span>
      </span>
      <span className="truncate font-normal">
        {point.beatmapArtist} – {point.beatmapTitle}
      </span>
      <span className="truncate font-normal text-muted-foreground">
        [{point.beatmapDifficulty}]
      </span>
    </div>
  );
}

type ChartPoint = TeamScoreChartPoint | PlayerScoreChartPoint;

const pointOf = (payload: readonly { payload?: unknown }[]) =>
  payload[0]?.payload as ChartPoint | undefined;

/** The chart's summary for screen readers: who won how many games. */
function describeChart(
  points: readonly ChartPoint[],
  series: readonly ScoreSeries[],
  oneVsOne: boolean
): string {
  const wins = (winner: string | null) =>
    formatCountOf(
      points.filter((point) => point.winner === winner).length,
      'game'
    );
  const ties = points.filter(
    (point) => point.winner === null || point.winner === 'tie'
  ).length;
  const winners = oneVsOne
    ? series.map((entry) => `${entry.label} won ${wins(entry.key)}`)
    : [`Red won ${wins('red')}`, `Blue won ${wins('blue')}`];

  return `Line chart of verified ${oneVsOne ? 'player' : 'team'} scores. ${winners.join(', ')}, and ${formatCountOf(ties, 'game')} ${ties === 1 ? 'was' : 'were'} tied.`;
}

/**
 * Each side's verified total per game, with the beatmap and result of a game
 * on hover. Team matches draw a line per team in the team colours. A 1v1
 * draws a line per player in the neutral palette: its red and blue are often
 * o!TR's own, from head-to-head lobbies it converted, so it never shows them.
 */
export default function MatchTeamScoresChart({
  games,
  players = [],
  oneVsOne = false,
}: {
  games: Game[] | undefined;
  players?: readonly MatchPlayer[];
  oneVsOne?: boolean;
}) {
  const isNarrow = useIsNarrowChart();
  const { points, series } = useMemo(
    (): { points: ChartPoint[]; series: readonly ScoreSeries[] } =>
      oneVsOne
        ? buildPlayerScoreChartData(games, players)
        : { points: buildTeamScoreChartData(games), series: TEAM_SERIES },
    [games, players, oneVsOne]
  );
  const seriesLabels: Record<string, string> = Object.fromEntries(
    series.map((entry) => [entry.key, entry.label])
  );

  const xTicks = useMemo(() => {
    const numbers = points.map((point) => point.mapNumber);
    return getNiceTicks(Math.min(...numbers), Math.max(...numbers), {
      integer: true,
      within: true,
      maxTicks: isNarrow ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS,
    });
  }, [points, isNarrow]);
  const yTicks = useMemo(() => {
    const scores = points.flatMap((point) =>
      series.flatMap((entry) => {
        const value = (point as unknown as Record<string, unknown>)[entry.key];
        return typeof value === 'number' ? [value] : [];
      })
    );
    return getNiceTicks(Math.min(...scores), Math.max(...scores), {
      integer: true,
    });
  }, [points, series]);

  if (points.length === 0) {
    return null;
  }

  return (
    <Panel data-testid="team-scores-chart">
      <SectionHeader
        icon={ChartLine}
        title={oneVsOne ? 'Player score progression' : 'Team score progression'}
        meta={formatCountOf(points.length, 'verified game')}
      />
      <PanelBody className="flex flex-col gap-3">
        <ChartLegend
          marker="line"
          items={series.map((entry) => ({
            key: entry.key,
            label: entry.label,
            color: entry.color,
          }))}
        />
        <ChartContainer
          config={{}}
          className="aspect-auto h-60 w-full sm:h-72"
          role="img"
          aria-label={describeChart(points, series, oneVsOne)}
        >
          <LineChart data={points} margin={CHART_MARGIN}>
            <CartesianGrid {...chartGridProps} />
            <XAxis
              {...chartAxisProps}
              {...niceAxisProps(xTicks)}
              dataKey="mapNumber"
              tickFormatter={formatCountTick}
            />
            <YAxis
              {...chartValueAxisProps}
              {...niceAxisProps(yTicks)}
              tickFormatter={formatCompactTick}
            />
            <ChartTooltip
              cursor={CHART_CURSOR.line}
              content={
                <ChartTooltipContent
                  marker="line"
                  valueFormatter={formatCountTick}
                  nameFormatter={(key) => seriesLabels[key] ?? key}
                  labelFormatter={(_, payload) => {
                    const point = pointOf(payload);
                    return point ? <TooltipTitle point={point} /> : null;
                  }}
                  footer={(payload) => {
                    const point = pointOf(payload);
                    return point ? describeResult(point) : null;
                  }}
                />
              }
            />
            {series.map((entry) => (
              <Line
                key={entry.key}
                type="monotone"
                dataKey={entry.key}
                stroke={entry.color}
                strokeWidth={CHART_LINE_WIDTH}
                dot={{ r: 3, fill: entry.color, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  );
}
