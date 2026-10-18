'use client';

import { Mods, Team, VerificationStatus } from '@otr/core/osu';
import {
  ChartBarBig,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartNoAxesColumn,
  Info,
  OctagonAlert,
  Star,
  Trophy,
  TriangleAlert,
} from 'lucide-react';
import * as React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import { GallerySection, Specimen } from '../gallery';
import { ChartLegend } from '@/components/kit/charts/ChartLegend';
import {
  CountBarChart,
  type CountBarDatum,
} from '@/components/kit/charts/CountBarChart';
import {
  ChartTooltipBody,
  ChartTooltipCard,
  ChartTooltipContent,
} from '@/components/kit/charts/ChartTooltip';
import { SeriesMarker } from '@/components/kit/charts/SeriesMarker';
import { Button } from '@/components/kit/controls/Button';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { Tile } from '@/components/kit/layout/Tile';
import { ChoiceChip } from '@/components/kit/lists/ChoiceChip';
import { NotificationDot } from '@/components/kit/status/NotificationDot';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import {
  CHART_BAR_RADIUS,
  CHART_CURSOR,
  CHART_LINE_WIDTH,
  CHART_MARGIN,
  chartAxisProps,
  chartGridProps,
  chartValueAxisProps,
  niceAxisProps,
} from '@/lib/kit/charts/axis';
import {
  formatCountTick,
  formatNumberTick,
  formatTimeTick,
  formatYearTick,
} from '@/lib/kit/charts/format';
import {
  DEFAULT_MAX_TICKS,
  NARROW_MAX_TICKS,
  getNiceTicks,
  getTimeTicks,
} from '@/lib/kit/charts/ticks';
import {
  CATEGORICAL_OTHER,
  CATEGORICAL_PALETTE,
  seriesColor,
} from '@/lib/kit/color/categorical';
import { contrastRatio, formatContrast } from '@/lib/kit/color/contrast';
import { GRADE_PALETTE } from '@/lib/kit/color/grades';
import { MOD_FILL_FOREGROUND, MOD_PALETTE } from '@/lib/kit/color/mods';
import {
  FREEMOD_COLOR,
  MOD_TYPE_COLORS,
  type ModType,
} from '@/lib/utils/mod-badges';
import FittingModIconset from '@/components/icons/FittingModIconset';
import ModIconset from '@/components/icons/ModIconset';
import {
  getStarRatingColor,
  getStarRatingForegroundColor,
  getStarRatingMarkColor,
} from '@/lib/kit/color/star-rating';
import {
  SURFACES,
  TEXT_COLORS,
  type Surface,
  type Theme,
} from '@/lib/kit/color/surfaces';
import {
  getTeamColor,
  getTeamTextColor,
  getTeamTintClass,
} from '@/lib/kit/color/teams';
import type { ThemeColor } from '@/lib/kit/color/theme-color';
import { TIER_TEXT_CLASS, getTierColor } from '@/lib/kit/color/tiers';
import {
  ACCENT_SURFACE_CLASSES,
  CALLOUT_COLORS,
  TOKEN_GROUPS,
  type CalloutTone,
  type TokenEntry,
} from '@/lib/kit/color/tokens';
import { getStatusHueColor } from '@/lib/kit/color/verification';
import {
  RATINGS_GROUPS,
  getVerificationStatusCopy,
} from '@/lib/kit/status/verification';
import { formatDate } from '@/lib/kit/format/date';
import { formatLobbySize } from '@/lib/kit/format/fields';
import { formatCount, formatPercent } from '@/lib/kit/format/number';
import { useIsNarrowChart } from '@/lib/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { tierNames } from '@/lib/utils/tierData';

const COLOR_LIB = '@/lib/kit/color';
const CHARTS = '@/components/kit/charts';
/** The modules every demo chart below is built from. */
const CHART_PARTS = `@/lib/kit/charts/{axis,ticks,format}, ${CHARTS}/ChartTooltip`;

/** The mods otr stores, by the type osu-web gives them. No stored mod is Fun. */
const MOD_BADGE_SPECIMENS: readonly {
  type: ModType;
  label: string;
  mods: readonly Mods[];
  freemod?: boolean;
  /** A fill other than the type's. */
  fill?: string;
}[] = [
  {
    type: 'DifficultyReduction',
    label: 'Difficulty reduction',
    mods: [Mods.Easy, Mods.NoFail, Mods.HalfTime],
  },
  {
    type: 'DifficultyIncrease',
    label: 'Difficulty increase',
    mods: [
      Mods.Hidden,
      Mods.HardRock,
      Mods.SuddenDeath,
      Mods.Perfect,
      Mods.DoubleTime,
      Mods.Nightcore,
      Mods.Flashlight,
      Mods.FadeIn,
    ],
  },
  {
    type: 'Conversion',
    label: 'Conversion',
    mods: [
      Mods.Random,
      Mods.Mirror,
      Mods.Key1,
      Mods.Key2,
      Mods.Key3,
      Mods.Key4,
      Mods.Key5,
      Mods.Key6,
      Mods.Key7,
      Mods.Key8,
      Mods.Key9,
    ],
  },
  {
    type: 'Automation',
    label: 'Automation',
    mods: [Mods.Relax, Mods.Relax2, Mods.Autoplay, Mods.SpunOut, Mods.Cinema],
  },
  {
    type: 'System',
    label: 'System',
    mods: [Mods.TouchDevice, Mods.ScoreV2],
  },
  {
    type: 'System',
    label: 'Freemod, not a mod type',
    mods: [],
    freemod: true,
    fill: FREEMOD_COLOR,
  },
];

/** Shows the light value inside light frames and the dark one inside dark frames. */
function ThemeValue({
  light,
  dark,
}: {
  light: React.ReactNode;
  dark: React.ReactNode;
}) {
  return (
    <>
      <span className="dark:hidden">{light}</span>
      <span className="hidden dark:inline">{dark}</span>
    </>
  );
}

function contrastNote(
  color: ThemeColor,
  theme: Theme,
  surface: Surface = 'card'
): string {
  const value = color[theme];
  const ratio = formatContrast(contrastRatio(value, SURFACES[theme][surface]));
  const on = surface === 'card' ? '' : ` on ${surface}`;

  switch (color.role) {
    case 'text':
      return `${ratio} text${on}`;
    case 'mark':
      return `${ratio} mark${on}`;
    case 'surface':
      return `${formatContrast(contrastRatio(TEXT_COLORS[theme].muted, value))} muted text`;
    default:
      return 'border';
  }
}

function TokenSwatch({ entry }: { entry: TokenEntry }) {
  const { color, label, utility, surface } = entry;

  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2 dark:bg-muted/75">
      <span
        className="size-8 shrink-0 rounded-md border border-foreground/10"
        style={{ backgroundColor: color.css }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {utility ?? color.token}
        </p>
      </div>
      <div className="shrink-0 text-right text-xs">
        <p>
          <ThemeValue light={color.light} dark={color.dark} />
        </p>
        <p className="text-muted-foreground">
          <ThemeValue
            light={contrastNote(color, 'light', surface)}
            dark={contrastNote(color, 'dark', surface)}
          />
        </p>
      </div>
    </li>
  );
}

function TokenList({ groupId }: { groupId: string }) {
  const group = TOKEN_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) return null;

  return (
    <div className="@container">
      <ul className="grid gap-2 @xl:grid-cols-2">
        {group.entries.map((entry) => (
          <TokenSwatch key={entry.color.token} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

// The site's own notices: the home page, the maintenance banner and the
// account deletion card in settings.
const CALLOUT_DEMO: Record<
  CalloutTone,
  { icon: React.ComponentType<{ className?: string }>; text: string }
> = {
  info: {
    icon: Info,
    text: 'Ratings are recalculated every Tuesday at 12:00 UTC',
  },
  warning: {
    icon: TriangleAlert,
    text: 'Ratings are pending recalculation, performance may be degraded',
  },
  danger: {
    icon: OctagonAlert,
    text: 'Permanently delete your account and remove your data from o!TR. Your player profile will remain public.',
  },
};

function CalloutPreviews() {
  return (
    <div className="flex flex-col gap-2">
      {(Object.keys(CALLOUT_DEMO) as CalloutTone[]).map((tone) => {
        const { icon: Icon, text } = CALLOUT_DEMO[tone];
        const colors = CALLOUT_COLORS[tone];

        return (
          <div
            key={tone}
            className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
            style={{
              backgroundColor: colors.fill.css,
              borderColor: colors.border.css,
              color: colors.foreground.css,
            }}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{text}</p>
          </div>
        );
      })}
    </div>
  );
}

// A 2v2 game: red scores, then blue, each best first, as the match page lists them.
const DEMO_SCORES = [
  { team: Team.Red, player: 'mrekk', score: 1_052_311, accuracy: '98.74%' },
  { team: Team.Red, player: 'lifeline', score: 874_560, accuracy: '96.88%' },
  { team: Team.Blue, player: 'Akolibed', score: 987_244, accuracy: '97.90%' },
  { team: Team.Blue, player: 'aetrna', score: 905_118, accuracy: '97.21%' },
];

function teamTotal(team: Team) {
  return DEMO_SCORES.filter((entry) => entry.team === team).reduce(
    (sum, entry) => sum + entry.score,
    0
  );
}

/**
 * A game frame holding score cards, with only the library tokens: the team
 * tint, a coloured edge, team text and the result line. Head-to-head scores
 * take the no-team grey (`getTeamColor(Team.NoTeam)`).
 */
function MatchSurfaceDemo() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-game-frame p-3">
      <p className="text-sm font-medium">Game 3 · Sidetracked Day</p>
      {DEMO_SCORES.map(({ team, player, score, accuracy }) => (
        <div
          key={player}
          className="relative flex overflow-clip rounded-lg border bg-score-card"
        >
          <span
            className={cn('absolute inset-0', getTeamTintClass(team))}
            aria-hidden="true"
          />
          <span
            className="relative w-1.5 shrink-0 opacity-70"
            style={{ backgroundColor: getTeamColor(team) }}
            aria-hidden="true"
          />
          <div className="relative flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{player}</p>
              <p className="text-xs text-muted-foreground">{accuracy}</p>
            </div>
            <span
              className="text-sm font-semibold"
              style={{ color: getTeamTextColor(team) }}
            >
              {formatCount(score)}
            </span>
          </div>
        </div>
      ))}
      <p className="text-sm font-medium text-match-red-foreground">
        Team Red wins by{' '}
        {formatCount(teamTotal(Team.Red) - teamTotal(Team.Blue))}
      </p>
    </div>
  );
}

/**
 * The theme text colours on the surfaces they sit on: a panel, a tile, and the
 * tooltip surface, where muted text switches to its accent value.
 */
function ThemeTextDemo() {
  const { name, summary } = getVerificationStatusCopy(
    VerificationStatus.PreVerified
  );

  return (
    <div className="@container">
      <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_auto] @lg:items-start">
        <Panel>
          <PanelBody className="flex flex-col gap-3 text-sm">
            <p>text-foreground</p>
            <p className="text-muted-foreground">text-muted-foreground</p>
            <p className="text-destructive-foreground">
              text-destructive-foreground
            </p>
            <Tile className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                text-muted-foreground on a tile
              </p>
              <p className="text-destructive-foreground">
                text-destructive-foreground on a tile
              </p>
            </Tile>
          </PanelBody>
        </Panel>
        {/* Drawn open: the tooltip surface with its scoped muted text. */}
        <div
          className={cn(
            'flex max-w-64 flex-col gap-1 rounded-md px-3 py-1.5 text-xs text-pretty',
            ACCENT_SURFACE_CLASSES
          )}
        >
          <p className="font-semibold">{name}</p>
          <p className="text-muted-foreground">{summary}</p>
        </div>
      </div>
    </div>
  );
}

function AccentRule() {
  const [selected, setSelected] = React.useState('osu');

  return (
    <div className="@container grid gap-4">
      <div className="grid gap-3 @lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Do</p>
          <Panel>
            <SectionHeader
              icon={Trophy}
              title="Tournament history"
              meta="12 tournaments"
            />
            <PanelBody className="flex flex-col gap-3 text-sm">
              <a
                href="#color-accent-rule"
                className="w-fit rounded-sm font-medium transition-colors hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Corsace Open 2025 (a name link, blue on hover)
              </a>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Submit tournament</Button>
                {RULESET_FILTER.map((ruleset) => (
                  <ChoiceChip
                    key={ruleset.key}
                    selected={selected === ruleset.key}
                    onClick={() => setSelected(ruleset.key)}
                  >
                    {ruleset.label}
                  </ChoiceChip>
                ))}
              </div>
              <span className="flex items-center gap-1.5">
                Reports
                <NotificationDot label="Unread report updates" />
              </span>
            </PanelBody>
          </Panel>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Don&apos;t
          </p>
          <Panel>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Trophy className="size-4 text-primary" aria-hidden />
              <h4 className="font-semibold">Tournament history</h4>
            </div>
            <PanelBody className="flex flex-col gap-3 text-sm">
              <span className="w-fit font-medium text-primary">
                Corsace Open 2025 (blue at rest)
              </span>
              <span className="text-muted-foreground">
                Blue section icons, blue names that are not links, and a second
                dot colour all dilute what blue means.
              </span>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}

const VERIFICATION_COUNTS = {
  verified: 8_412,
  notInRatingsYet: 1_306,
  rejected: 2_155,
};

function VerificationShares() {
  const total = Object.values(VERIFICATION_COUNTS).reduce(
    (sum, count) => sum + count,
    0
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {RATINGS_GROUPS.map((group) => (
          <span
            key={group.key}
            style={{
              backgroundColor: getStatusHueColor(group.hue),
              width: `${(VERIFICATION_COUNTS[group.key] / total) * 100}%`,
            }}
          />
        ))}
      </div>
      <ChartLegend
        items={RATINGS_GROUPS.map((group) => ({
          key: group.key,
          label: `${group.label} ${formatCount(VERIFICATION_COUNTS[group.key])}`,
          color: getStatusHueColor(group.hue),
        }))}
      />
    </div>
  );
}

const STAR_RATINGS = [1.2, 2.3, 3.4, 4.5, 5.6, 6.7, 7.8, 9.2];

function StarRatingDemo() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {STAR_RATINGS.map((rating) => (
          <span
            key={rating}
            className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold"
            style={{
              backgroundColor: getStarRatingColor(rating),
              color: getStarRatingForegroundColor(rating),
            }}
          >
            <Star className="size-3 fill-current" aria-hidden />
            {rating.toFixed(2)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {STAR_RATINGS.map((rating) => (
          <span key={rating} className="inline-flex items-center gap-1 text-xs">
            <Star
              className="size-4 fill-current"
              style={{ color: getStarRatingMarkColor(rating) }}
              aria-hidden
            />
            {rating.toFixed(2)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Static demo data for the charts. Deterministic, so server and client agree.
const DAY_MS = 86_400_000;
const RATING_START = Date.UTC(2023, 0, 10);
const RATING_HISTORY = Array.from({ length: 48 }, (_, index) => ({
  timestamp: RATING_START + index * 21 * DAY_MS,
  rating: Math.round(
    1_020 + index * 7.5 + 90 * Math.sin(index / 4) + 30 * Math.cos(index / 1.7)
  ),
}));
const PEAK_RATING = Math.max(...RATING_HISTORY.map((point) => point.rating));

const TOURNAMENTS_BY_YEAR = [
  { year: '2015', count: 42 },
  { year: '2016', count: 88 },
  { year: '2017', count: 131 },
  { year: '2018', count: 214 },
  { year: '2019', count: 356 },
  { year: '2020', count: 803 },
  { year: '2021', count: 1_104 },
  { year: '2022', count: 1_320 },
  { year: '2023', count: 1_489 },
  { year: '2024', count: 1_377 },
  { year: '2025', count: 1_118 },
];

const RULESETS = [
  { key: 'osu', label: 'osu!' },
  { key: 'taiko', label: 'taiko' },
  { key: 'catch', label: 'catch' },
  { key: 'mania4k', label: 'mania 4K' },
  { key: 'mania7k', label: 'mania 7K' },
] as const;

/** A few chips to show the selected state; one is selected at a time. */
const RULESET_FILTER = [{ key: 'all', label: 'All' }, ...RULESETS.slice(0, 2)];

const MATCHES_BY_RULESET = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map(
  (year, index) => ({
    year: String(year),
    osu: 2_100 + index * 610,
    taiko: 380 + index * 95,
    catch: 240 + index * 60,
    mania4k: 520 + index * 170,
    mania7k: 90 + index * 30,
  })
);
const MATCHES_2024 = MATCHES_BY_RULESET[5];

const RATING_BUCKET = 100;
const PLAYERS_BY_RATING = Array.from({ length: 28 }, (_, index) => {
  const rating = 200 + index * RATING_BUCKET;
  const z = (rating - 1_050) / 380;
  return {
    rating,
    players: Math.round(
      2_900 * Math.exp(-(z * z) / 2) * (rating > 1_050 ? 1 : 0.9) + 12
    ),
  };
});

const CHART_CLASS = 'aspect-auto h-60 w-full';

function RatingLineDemo() {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const values = RATING_HISTORY.map((point) => point.rating);
  const yTicks = getNiceTicks(Math.min(...values), Math.max(...values));
  const time = getTimeTicks(
    RATING_HISTORY[0].timestamp,
    RATING_HISTORY[RATING_HISTORY.length - 1].timestamp,
    maxTicks
  );

  return (
    <Panel>
      <SectionHeader
        icon={ChartLine}
        title="Rating"
        level={4}
        meta={`Peak ${formatNumberTick(PEAK_RATING)}`}
      />
      <PanelBody>
        <ChartContainer config={{}} className={CHART_CLASS}>
          <LineChart data={RATING_HISTORY} margin={CHART_MARGIN}>
            <CartesianGrid {...chartGridProps} />
            <XAxis
              {...chartAxisProps}
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={time.ticks}
              interval={0}
              tickFormatter={(value: number) =>
                formatTimeTick(value, time.unit)
              }
            />
            <YAxis
              {...chartValueAxisProps}
              {...niceAxisProps(yTicks)}
              tickFormatter={formatNumberTick}
            />
            <ChartTooltip
              cursor={CHART_CURSOR.line}
              content={
                <ChartTooltipContent
                  marker="line"
                  labelFormatter={(label) => formatDate(Number(label))}
                  nameFormatter={() => 'Rating'}
                  valueFormatter={formatNumberTick}
                />
              }
            />
            <ReferenceLine
              y={PEAK_RATING}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
            />
            <Line
              dataKey="rating"
              type="monotone"
              stroke={seriesColor(0)}
              strokeWidth={CHART_LINE_WIDTH}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  );
}

function YearBarDemo() {
  const max = Math.max(...TOURNAMENTS_BY_YEAR.map((entry) => entry.count));
  const yTicks = getNiceTicks(0, max, { integer: true });

  return (
    <Panel>
      <SectionHeader
        icon={ChartColumn}
        title="Tournaments by year"
        level={4}
        meta={`${formatCount(TOURNAMENTS_BY_YEAR.reduce((sum, entry) => sum + entry.count, 0))} verified`}
      />
      <PanelBody>
        <ChartContainer config={{}} className={CHART_CLASS}>
          <BarChart data={TOURNAMENTS_BY_YEAR} margin={CHART_MARGIN}>
            <CartesianGrid {...chartGridProps} />
            <XAxis
              {...chartAxisProps}
              dataKey="year"
              tickFormatter={formatYearTick}
              interval="preserveStartEnd"
            />
            <YAxis
              {...chartValueAxisProps}
              {...niceAxisProps(yTicks)}
              tickFormatter={formatCountTick}
            />
            <ChartTooltip
              cursor={CHART_CURSOR.bar}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatYearTick(label)}
                  nameFormatter={() => 'Tournaments'}
                  valueFormatter={formatCountTick}
                />
              }
            />
            <Bar
              dataKey="count"
              fill={seriesColor(0)}
              radius={CHART_BAR_RADIUS}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  );
}

function StackedBarDemo() {
  const max = Math.max(
    ...MATCHES_BY_RULESET.map((entry) =>
      RULESETS.reduce((sum, ruleset) => sum + entry[ruleset.key], 0)
    )
  );
  const yTicks = getNiceTicks(0, max, { integer: true });
  const labels = Object.fromEntries(
    RULESETS.map((ruleset) => [ruleset.key, ruleset.label])
  );

  return (
    <Panel>
      <SectionHeader
        icon={ChartColumnStacked}
        title="Verified matches by ruleset"
        level={4}
      />
      <PanelBody className="flex flex-col gap-3">
        <ChartLegend
          items={RULESETS.map((ruleset, index) => ({
            key: ruleset.key,
            label: ruleset.label,
            color: seriesColor(index),
          }))}
        />
        <ChartContainer config={{}} className={CHART_CLASS}>
          <BarChart data={MATCHES_BY_RULESET} margin={CHART_MARGIN}>
            <CartesianGrid {...chartGridProps} />
            <XAxis
              {...chartAxisProps}
              dataKey="year"
              tickFormatter={formatYearTick}
            />
            <YAxis
              {...chartValueAxisProps}
              {...niceAxisProps(yTicks)}
              tickFormatter={formatCountTick}
            />
            <ChartTooltip
              cursor={CHART_CURSOR.bar}
              content={
                <ChartTooltipContent
                  reverse
                  labelFormatter={(label) => formatYearTick(label)}
                  nameFormatter={(name) => labels[name] ?? name}
                  valueFormatter={formatCountTick}
                  footer={(payload) =>
                    `Total ${formatCountTick(
                      payload.reduce(
                        (sum, item) =>
                          sum +
                          (typeof item.value === 'number' ? item.value : 0),
                        0
                      )
                    )}`
                  }
                />
              }
            />
            {RULESETS.map((ruleset, index) => (
              <Bar
                key={ruleset.key}
                dataKey={ruleset.key}
                stackId="rulesets"
                fill={seriesColor(index)}
                // A thin line in the card colour between segments.
                stroke="var(--card)"
                strokeWidth={1}
                radius={index === RULESETS.length - 1 ? CHART_BAR_RADIUS : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  );
}

function DistributionDemo() {
  const maxTicks = useIsNarrowChart() ? NARROW_MAX_TICKS : DEFAULT_MAX_TICKS;
  const max = Math.max(...PLAYERS_BY_RATING.map((entry) => entry.players));
  const yTicks = getNiceTicks(0, max, { integer: true });
  // Bucket starts are categories, so the ticks stay inside the data.
  const xTicks = getNiceTicks(
    PLAYERS_BY_RATING[0].rating,
    PLAYERS_BY_RATING[PLAYERS_BY_RATING.length - 1].rating,
    { within: true, maxTicks }
  ).ticks;

  return (
    <Panel>
      <SectionHeader
        icon={ChartNoAxesColumn}
        title="Rating distribution"
        level={4}
        meta={`${formatCount(PLAYERS_BY_RATING.reduce((sum, entry) => sum + entry.players, 0))} players`}
      />
      <PanelBody>
        <ChartContainer config={{}} className={CHART_CLASS}>
          <BarChart
            data={PLAYERS_BY_RATING}
            margin={CHART_MARGIN}
            barCategoryGap={1}
          >
            <CartesianGrid {...chartGridProps} />
            <XAxis
              {...chartAxisProps}
              dataKey="rating"
              ticks={xTicks}
              interval={0}
              tickFormatter={formatNumberTick}
            />
            <YAxis
              {...chartValueAxisProps}
              {...niceAxisProps(yTicks)}
              tickFormatter={formatCountTick}
            />
            <ChartTooltip
              cursor={CHART_CURSOR.bar}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) =>
                    `Rating ${formatNumberTick(Number(label))} – ${formatNumberTick(Number(label) + RATING_BUCKET - 1)}`
                  }
                  nameFormatter={() => 'Players'}
                  valueFormatter={formatCountTick}
                />
              }
            />
            <Bar
              dataKey="players"
              fill={seriesColor(0)}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  );
}

const LOBBY_SIZE_COUNTS = [612, 1_840, 455, 1_288, 61, 132, 9, 27];

const TOURNAMENTS_BY_LOBBY_SIZE: CountBarDatum[] = LOBBY_SIZE_COUNTS.map(
  (count, index) => ({
    key: String(index + 1),
    label: formatLobbySize(index + 1),
    count,
  })
);

const TOURNAMENTS_BY_RULESET: CountBarDatum[] = RULESETS.map(
  (ruleset, index) => ({
    key: ruleset.key,
    label: ruleset.label,
    count: [5_812, 921, 604, 1_377, 233][index],
  })
);

/** The ratings groups, each bar in its own verification colour. */
const TOURNAMENTS_BY_STATUS: CountBarDatum[] = RATINGS_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  count: VERIFICATION_COUNTS[group.key],
  fill: getStatusHueColor(group.hue),
}));

const STATUS_TOTAL = TOURNAMENTS_BY_STATUS.reduce(
  (sum, bar) => sum + bar.count,
  0
);

function CountBarDemo() {
  return (
    <div className="@container">
      <div className="grid gap-4 @2xl:grid-cols-2">
        <Panel>
          <SectionHeader
            icon={ChartColumn}
            title="Tournaments by lobby size"
            level={4}
          />
          <PanelBody>
            <CountBarChart
              data={TOURNAMENTS_BY_LOBBY_SIZE}
              valueName="Tournaments"
            />
          </PanelBody>
        </Panel>
        <Panel>
          <SectionHeader
            icon={ChartBarBig}
            title="Tournaments by ruleset"
            level={4}
          />
          <PanelBody>
            <CountBarChart
              data={TOURNAMENTS_BY_RULESET}
              layout="rows"
              valueName="Tournaments"
            />
          </PanelBody>
        </Panel>
        <Panel className="@2xl:col-span-2">
          <SectionHeader
            icon={ChartBarBig}
            title="Tournaments by status"
            level={4}
            meta={`${formatCount(STATUS_TOTAL)} tournaments`}
          />
          <PanelBody>
            <CountBarChart
              data={TOURNAMENTS_BY_STATUS}
              layout="rows"
              valueName="Tournaments"
              className="h-44"
              footer={(bar) =>
                `${formatPercent(bar.count / STATUS_TOTAL)} of all tournaments`
              }
            />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

/**
 * Tier marks side by side, in tier order as named above, the way the rating
 * distribution draws neighbouring buckets.
 */
function TierMarks() {
  return (
    <div className="flex h-8 gap-px overflow-hidden rounded-md" aria-hidden>
      {tierNames.map((tier) => (
        <span
          key={tier}
          className="flex-1"
          style={{ backgroundColor: getTierColor(tier) }}
        />
      ))}
    </div>
  );
}

const TICK_EXAMPLES: {
  data: string;
  min: number;
  max: number;
  /** What a local powers-of-5 rule draws for the same data. */
  before?: string;
}[] = [
  {
    data: 'Rating 1,000 – 1,450',
    min: 1_000,
    max: 1_450,
    before: '1,000 · 1,125 · 1,250 · 1,375 · 1,500',
  },
  {
    data: 'Volatility 182 – 226',
    min: 182,
    max: 226,
    before: '182 · 195 · 208 · 221 · 234',
  },
  { data: 'Tournaments 0 – 1,489', min: 0, max: 1_489 },
  { data: 'Scores 1,003,412 – 1,126,980', min: 1_003_412, max: 1_126_980 },
];

function TickRuleDemo() {
  return (
    <div className="@container">
      <ul className="grid gap-2">
        {TICK_EXAMPLES.map((example) => (
          <li
            key={example.data}
            className="grid gap-1 rounded-lg border bg-card px-3 py-2 text-sm @lg:grid-cols-[10rem_1fr] dark:bg-muted/75"
          >
            <span className="text-xs font-medium text-muted-foreground">
              {example.data}
            </span>
            <span className="flex flex-col gap-0.5">
              <span>
                {getNiceTicks(example.min, example.max)
                  .ticks.map(formatNumberTick)
                  .join(' · ')}
              </span>
              {example.before ? (
                <span className="text-xs text-muted-foreground">
                  A powers-of-5 rule: {example.before}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ColorSection() {
  return (
    <GallerySection
      id="color"
      title="Colour and charts"
      description="Theme tokens, domain palettes and the shared chart parts. Ratios are measured against the panel surface of each theme unless the note names another: marks and icons need 3:1, text 4.5:1."
    >
      <Specimen
        id="color-text"
        name="Theme text"
        importPath={`${COLOR_LIB}/tokens`}
        description="Text, muted text and red text clear 4.5:1 on panels, tiles and popovers. Tooltips sit on the accent surface, where muted text takes its own darker (light) or lighter (dark) value; the tooltip primitives apply it, so text-muted-foreground inside a tooltip just works."
      >
        <div className="flex flex-col gap-3">
          <ThemeTextDemo />
          <TokenList groupId="text" />
        </div>
      </Specimen>

      <Specimen
        id="color-categorical-palette"
        name="Categorical palette"
        importPath={`${COLOR_LIB}/categorical`}
        description="Eight hues in a fixed order for neutral series, rank restriction buckets and match teams. Assign slots in order and never cycle; a single series uses slot 1."
      >
        <div className="flex flex-col gap-3">
          <div className="flex h-8 gap-0.5 overflow-hidden rounded-md">
            {[...CATEGORICAL_PALETTE, CATEGORICAL_OTHER].map((color) => (
              <span
                key={color.token}
                className="flex-1"
                style={{ backgroundColor: color.css }}
              />
            ))}
          </div>
          <TokenList groupId="categorical" />
        </div>
      </Specimen>

      <Specimen
        id="color-verification"
        name="Verification colours"
        importPath={`${COLOR_LIB}/verification`}
        description="Green, neutral and red for status icons and chart fills. Charts show three groups: Pending, Pre-verified and Pre-rejected are one neutral Not in ratings yet. Colour only reinforces the status glyph."
      >
        <div className="flex flex-col gap-3">
          <VerificationShares />
          <TokenList groupId="verification" />
        </div>
      </Specimen>

      <Specimen
        id="color-callout-tones"
        name="Callout tones"
        importPath={`${COLOR_LIB}/tokens`}
        description="Fill, border and text for the info, warning and danger callouts. Info is a quiet slate, not the link blue."
      >
        <div className="flex flex-col gap-3">
          <CalloutPreviews />
          <TokenList groupId="callouts" />
        </div>
      </Specimen>

      <Specimen
        id="color-match"
        name="Match teams and surfaces"
        importPath={`${COLOR_LIB}/teams`}
        description="One red and blue pair everywhere, a theme-aware no-team grey, and the recessed game frame with lighter score cards."
      >
        <div className="flex flex-col gap-3">
          <MatchSurfaceDemo />
          <TokenList groupId="match" />
        </div>
      </Specimen>

      <Specimen
        id="color-accent-rule"
        name="Accent rule"
        description="Blue means you can act on it or it is selected: links on hover, primary buttons, the selected chip. Buttons fill with primary-solid, blue text uses link, and icons and borders use primary. Section icons stay muted, new things get the one notification dot, and the header's support heart turns pink on hover."
      >
        <div className="flex flex-col gap-3">
          <AccentRule />
          <TokenList groupId="brand" />
          <TokenList groupId="accent" />
          <TokenList groupId="support" />
        </div>
      </Specimen>

      <Specimen
        id="color-tiers"
        name="Tier colours"
        importPath={`${COLOR_LIB}/tiers`}
        description="Tier names as text, stepped per theme to clear 4.5:1, and the same colours as chart marks. Use the text-tier-* classes for text and getTierColor for fills."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
            {tierNames.map((tier) => (
              <span key={tier} className={TIER_TEXT_CLASS[tier]}>
                {tier}
              </span>
            ))}
          </div>
          <TierMarks />
          <TokenList groupId="tiers" />
        </div>
      </Specimen>

      <Specimen
        id="color-grades"
        name="Grade colours"
        importPath={`${COLOR_LIB}/grades`}
        description="Marks for grade charts. SS, S and A keep the osu! badge hues; B to D recede toward the card."
      >
        <div className="flex flex-col gap-3">
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            {Object.entries(GRADE_PALETTE).map(([grade, color], index) => (
              <span
                key={grade}
                style={{ backgroundColor: color.css, flexGrow: 6 - index }}
              />
            ))}
          </div>
          <TokenList groupId="grades" />
        </div>
      </Specimen>

      <Specimen
        id="color-mods"
        name="Mod colours"
        importPath={`${COLOR_LIB}/mods`}
        description="The mod colours the site has always used, each hue kept and only the lightness moved as far as contrast needs, so the light theme's are darker. Touch Device, which once shared Sudden Death's orange, is a greyer orange. Every mod clears 3:1 and takes black text as a solid pill. Rare combinations use the Other grey."
      >
        <div className="@container">
          <ul className="grid grid-cols-3 gap-2 @md:grid-cols-4 @xl:grid-cols-6">
            {[...MOD_PALETTE, { ...CATEGORICAL_OTHER, label: 'Other' }].map(
              (color) => (
                <li
                  key={color.token}
                  className="flex flex-col items-start gap-1"
                >
                  <span
                    className="inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold"
                    style={{
                      backgroundColor: color.css,
                      color: MOD_FILL_FOREGROUND,
                    }}
                  >
                    {color.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <ThemeValue
                      light={formatContrast(
                        contrastRatio(color.light, SURFACES.light.card)
                      )}
                      dark={formatContrast(
                        contrastRatio(color.dark, SURFACES.dark.card)
                      )}
                    />
                  </span>
                </li>
              )
            )}
          </ul>
        </div>
      </Specimen>

      <Specimen
        id="color-mod-badges"
        name="Mod badges"
        importPath="@/components/icons/ModIconset"
        description="osu-web's mod badges and type colours, mirrored one to one. The ratio is the badge against the card."
      >
        <ul className="flex flex-col gap-3">
          {MOD_BADGE_SPECIMENS.map(({ type, label, mods, freemod, fill }) => (
            <li key={label} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {label},{' '}
                <ThemeValue
                  light={formatContrast(
                    contrastRatio(
                      fill ?? MOD_TYPE_COLORS[type],
                      SURFACES.light.card
                    )
                  )}
                  dark={formatContrast(
                    contrastRatio(
                      fill ?? MOD_TYPE_COLORS[type],
                      SURFACES.dark.card
                    )
                  )}
                />
              </span>
              <div className="flex flex-wrap gap-1">
                {freemod && (
                  <ModIconset mods={Mods.None} freemod className="flex h-6" />
                )}
                {mods.map((mod) => (
                  <ModIconset key={mod} mods={mod} className="flex h-6" />
                ))}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            A combination, as game and score cards show it
          </span>
          <ModIconset
            mods={Mods.Hidden | Mods.HardRock | Mods.DoubleTime}
            className="flex h-6"
          />
        </div>
        <div className="mt-4 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            A lazer score, with a custom speed and lazer-only mods
          </span>
          <ModIconset
            mods={Mods.DoubleTime}
            lazerMods={[
              { acronym: 'DT', settings: { speed_change: 1.2 } },
              { acronym: 'DA', settings: { approach_rate: 9.5 } },
              { acronym: 'BR' },
            ]}
            className="flex h-6"
          />
        </div>
        <div className="mt-4 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            In a tight row, as score cards show it
          </span>
          <FittingModIconset
            mods={
              Mods.NoFail |
              Mods.Easy |
              Mods.Hidden |
              Mods.DoubleTime |
              Mods.Flashlight |
              Mods.SpunOut
            }
            className="h-5 w-28"
          />
        </div>
      </Specimen>

      <Specimen
        id="color-star-rating"
        name="Star rating colours"
        importPath={`${COLOR_LIB}/star-rating`}
        description="osu!'s spectrum as a solid pill with its own text colour, and getStarRatingMarkColor for icons and marks on a card, stepped per theme to clear 3:1."
      >
        <StarRatingDemo />
      </Specimen>

      <Specimen
        id="color-chart-line"
        name="Line chart"
        importPath={CHART_PARTS}
        description="A single series in slot 1 needs no legend; the section title names it. Time ticks land on calendar boundaries in UTC, and a dashed muted rule marks a reference value."
      >
        <RatingLineDemo />
      </Specimen>

      <Specimen
        id="color-chart-bar"
        name="Bar chart"
        importPath={CHART_PARTS}
        description="Bars start at zero with rounded data ends. Count axes get thousands separators; year labels never do."
      >
        <YearBarDemo />
      </Specimen>

      <Specimen
        id="color-chart-stacked"
        name="Stacked bar chart"
        importPath={`${CHART_PARTS}, ${CHARTS}/ChartLegend`}
        description="Series take the categorical slots in order, with a legend above the plot in the same order. The tooltip lists the stack top to bottom and adds a total."
      >
        <StackedBarDemo />
      </Specimen>

      <Specimen
        id="color-chart-distribution"
        name="Distribution chart"
        importPath={CHART_PARTS}
        description="A histogram with touching bars and ticks from the shared rule on both axes. The stats page's rating distribution adds a cumulative share line on a right-hand percentage axis (components/stats/RatingDistributionChart.tsx), as documented under the Recharts axis props."
      >
        <DistributionDemo />
      </Specimen>

      <Specimen
        id="color-chart-count-bars"
        name="CountBarChart"
        importPath={`${CHARTS}/CountBarChart`}
        description="A count per category: columns on a category axis, or rows with the categories on the left for long names. Rows round their right end, draw vertical gridlines and leave room for the last count label. Bars can bring their own colour, as the verification groups do."
        stacked
      >
        <CountBarDemo />
      </Specimen>

      <Specimen
        id="color-chart-tooltip"
        name="ChartTooltipContent"
        importPath={`${CHARTS}/ChartTooltip`}
        description="The one chart tooltip. Pass ChartTooltipContent as the content of ChartTooltip from @/components/ui/chart; use ChartTooltipBody inside a TapTooltip for charts drawn without Recharts."
      >
        <div className="flex flex-wrap items-start gap-4">
          {/* The stacked bar chart's 2024 bar, listed top to bottom. */}
          <ChartTooltipCard
            title={formatYearTick(MATCHES_2024.year)}
            rows={RULESETS.map((ruleset, index) => ({
              key: ruleset.key,
              label: ruleset.label,
              value: formatCountTick(MATCHES_2024[ruleset.key]),
              color: seriesColor(index),
            })).reverse()}
            footer={`Total ${formatCountTick(
              RULESETS.reduce(
                (sum, ruleset) => sum + MATCHES_2024[ruleset.key],
                0
              )
            )}`}
          />
          <ChartTooltipCard
            title={formatDate(RATING_HISTORY[28].timestamp)}
            rows={[
              {
                key: 'rating',
                label: 'Rating',
                value: formatNumberTick(RATING_HISTORY[28].rating),
                color: seriesColor(0),
                marker: 'line',
              },
            ]}
          />
          <div className={cn('rounded-md px-3 py-1.5', ACCENT_SURFACE_CLASSES)}>
            <ChartTooltipBody
              title="HDHR"
              rows={[
                { key: 'median', label: 'Median', value: '812,455' },
                {
                  key: 'range',
                  label: 'Middle 50%',
                  value: '702,118 – 905,342',
                },
              ]}
              footer="1,204 scores"
            />
          </div>
        </div>
      </Specimen>

      <Specimen
        id="color-chart-legend"
        name="ChartLegend and SeriesMarker"
        importPath={`${CHARTS}/ChartLegend`}
        description="A legend for two or more series, above the plot. The marker matches the mark: squares for bars, lines for lines, dashed for reference lines, dots for points."
      >
        <div className="flex flex-col gap-3">
          <ChartLegend
            items={RULESETS.map((ruleset, index) => ({
              key: ruleset.key,
              label: ruleset.label,
              color: seriesColor(index),
            }))}
          />
          {/* The player rating chart's line and its peak rule. */}
          <ChartLegend
            items={[
              {
                key: 'rating',
                label: 'Rating',
                color: seriesColor(0),
                marker: 'line',
              },
              {
                key: 'peak',
                label: 'Peak',
                color: 'var(--muted-foreground)',
                marker: 'dashed',
              },
            ]}
          />
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(['square', 'line', 'dashed', 'dot'] as const).map((shape) => (
              <li key={shape} className="flex items-center gap-1.5">
                <SeriesMarker color={seriesColor(0)} shape={shape} />
                {shape}
              </li>
            ))}
          </ul>
        </div>
      </Specimen>

      <Specimen
        id="color-chart-ticks"
        name="Tick rule"
        importPath="@/lib/kit/charts/ticks"
        description="Steps of 1, 2, 2.5 or 5 times a power of ten, at most six ticks. A local rule that scales by powers of 5 gives steps like 13 and 125; the first two show it for comparison."
      >
        <TickRuleDemo />
      </Specimen>
    </GallerySection>
  );
}
