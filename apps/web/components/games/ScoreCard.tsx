'use client';

import { Ruleset, Team, type Mods } from '@otr/core/osu';
import Image from 'next/image';

import ModIconset from '@/components/icons/ModIconset';
import { CountryFlag } from '@/components/kit/country/CountryFlag';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { getTeamTextColor, getTeamTintClass } from '@/lib/kit/color/teams';
import { SCORE_GRADE_LABELS } from '@/lib/kit/format/enum-labels';
import { formatAccuracy, formatCount } from '@/lib/kit/format/number';
import { getRejectionReasonTexts } from '@/lib/kit/status/reasons';
import type { GameScore, MatchPlayer } from '@/lib/orpc/schema/match';
import { cn } from '@/lib/utils';

import ScoreActionsMenu from './ScoreActionsMenu';
import ScoreTeamColorBar from './ScoreTeamColorBar';

type HitJudgment = { label: string; count: number };

function getHitJudgments(score: GameScore): HitJudgment[] {
  switch (score.ruleset) {
    case Ruleset.Taiko:
      return [
        { label: 'Great', count: score.statGreat ?? 0 },
        { label: 'Ok', count: score.statOk ?? 0 },
        { label: 'Miss', count: score.statMiss ?? 0 },
      ];
    case Ruleset.Mania4k:
    case Ruleset.Mania7k:
    case Ruleset.ManiaOther:
      return [
        { label: 'Perfect', count: score.statPerfect ?? 0 },
        { label: 'Great', count: score.statGreat ?? 0 },
        { label: 'Good', count: score.statGood ?? 0 },
        { label: 'Ok', count: score.statOk ?? 0 },
        { label: 'Meh', count: score.statMeh ?? 0 },
        { label: 'Miss', count: score.statMiss ?? 0 },
      ];
    case Ruleset.Catch:
      return [
        { label: 'Great', count: score.statGreat ?? 0 },
        { label: 'Lg. drop', count: score.statLargeTickHit ?? 0 },
        { label: 'Sm. drop miss', count: score.statSmallTickMiss ?? 0 },
        { label: 'Miss', count: score.statMiss ?? 0 },
      ];
    case Ruleset.Osu:
    default:
      return [
        { label: 'Great', count: score.statGreat ?? 0 },
        { label: 'Ok', count: score.statOk ?? 0 },
        { label: 'Meh', count: score.statMeh ?? 0 },
        { label: 'Miss', count: score.statMiss ?? 0 },
      ];
  }
}

/** One figure on the score card: a muted label over its value. */
function PerformanceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start justify-center">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-base tabular-nums">{value}</span>
    </div>
  );
}

/**
 * One player's score in a game: a card on the game frame, tinted with the
 * player's team and edged in its colour.
 */
export default function ScoreCard({
  score,
  mods,
  player,
  countryName,
  matchId,
  gameNumber,
  highlighted = false,
}: {
  score: GameScore;
  /** The mods to show: the score's own beyond those its game's header shows. */
  mods: Mods;
  player?: MatchPlayer;
  /** The player's country name, from the server, so hydration never differs. */
  countryName?: string;
  matchId: number;
  /** The game's place in the match, which names the status and menu. */
  gameNumber: number;
  highlighted?: boolean;
}) {
  const playerName = player?.username ?? 'Unknown player';
  const hitJudgments = getHitJudgments(score);
  const gradeLabel = SCORE_GRADE_LABELS[score.grade] ?? 'D';
  const scoreStyle = { color: getTeamTextColor(score.team) };

  const status = (
    <VerificationStatusIcon
      status={score.verificationStatus}
      rejectionReasons={getRejectionReasonTexts('score', score.rejectionReason)}
      context={`${playerName}'s score in game ${gameNumber}`}
      tooltip="tap"
    />
  );
  // A score whose player is missing from the match keeps its name as text,
  // rather than an empty link to /players/undefined.
  const playerLink = player ? (
    <EntityLink
      href={`/players/${player.id}?ruleset=${score.ruleset}`}
      data-testid="score-player-link"
    >
      {player.username}
    </EntityLink>
  ) : (
    <span className="truncate text-muted-foreground">{playerName}</span>
  );
  const actions = (
    <ScoreActionsMenu
      score={score}
      playerName={playerName}
      gameNumber={gameNumber}
      matchId={matchId}
    />
  );
  const grade = (size: number) => (
    <Image
      src={`/icons/grades/${gradeLabel}.svg`}
      alt={`Grade ${gradeLabel}`}
      width={size}
      height={size}
      className={size > 24 ? 'size-8' : 'size-5'}
    />
  );

  return (
    <div
      id={`score-${score.id}`}
      data-team={Team[score.team]}
      className={cn(
        'team-flex-row relative flex overflow-clip rounded-lg border bg-score-card transition-all duration-300',
        highlighted && 'ring-2 ring-primary'
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-0', getTeamTintClass(score.team))}
      />

      <ScoreTeamColorBar team={score.team} />

      {/* Phones: two lines, the hit counts joined into one. */}
      <div className="relative flex min-w-0 flex-1 flex-col gap-1 px-2 py-1 sm:hidden">
        {/* A score with mods moves its mods, grade and score under the name
            rather than squeezing the name out; one without truncates it. */}
        <div
          className={cn(
            'flex items-center justify-between gap-1.5',
            mods !== 0 && 'flex-wrap'
          )}
        >
          {/* 8px apart: the status icon and the flag are both tap targets. */}
          <div className="flex min-w-0 items-center gap-2">
            {status}
            <CountryFlag code={player?.country} name={countryName} size="sm" />
            {playerLink}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* A set height: the icons size themselves to it. */}
            <ModIconset className="h-4 shrink-0 justify-end" mods={mods} />
            {grade(24)}
            <span className="tabular-nums" style={scoreStyle}>
              {formatCount(score.score)}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {/* The labels the tablet layout shows, for screen readers; on
                screen the counts read in the game's own order. */}
            <span className="sr-only">
              {[
                ...hitJudgments.map(
                  (item) => `${item.label} ${formatCount(item.count)}`
                ),
                `Combo ${formatCount(score.maxCombo)}x`,
                `Accuracy ${formatAccuracy(score.accuracy)}`,
              ].join(', ')}
            </span>
            <span aria-hidden="true">
              {hitJudgments.map((item) => formatCount(item.count)).join('/')}
              {' · '}
              {formatCount(score.maxCombo)}x{' · '}
              {formatAccuracy(score.accuracy)}
            </span>
          </span>
          {actions}
        </div>
      </div>

      {/* Tablet and up: name, mods, grade and score, then the figures. */}
      <div className="relative hidden min-w-0 flex-1 flex-col gap-2 px-2 sm:flex">
        {/* As on phones, many mods move under the name rather than over it. */}
        <div
          className={cn(
            'team-flex-row flex flex-1 items-center justify-between gap-y-1',
            mods !== 0 && 'flex-wrap'
          )}
        >
          <div className="team-flex-row flex min-w-0 items-center justify-start gap-2">
            {status}
            {actions}
            <CountryFlag code={player?.country} name={countryName} />
            {playerLink}
          </div>
          <div className="team-flex-row flex items-center justify-center gap-2">
            <ModIconset className="h-5" mods={mods} />
            {grade(32)}
            <span className="tabular-nums" style={scoreStyle}>
              {formatCount(score.score)}
            </span>
          </div>
        </div>
        {/* Mania's six judgments plus combo and accuracy are wider than a
            half-width card, so the figures wrap instead of being clipped. */}
        <div className="team-flex-row flex flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1 pb-1">
          <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-1">
            {hitJudgments.map((item) => (
              <PerformanceItem
                key={item.label}
                label={item.label}
                value={`${formatCount(item.count)}x`}
              />
            ))}
          </div>
          <div className="team-flex-row flex items-center justify-start gap-x-3">
            <PerformanceItem
              label="Combo"
              value={`${formatCount(score.maxCombo)}x`}
            />
            <PerformanceItem
              label="Accuracy"
              value={formatAccuracy(score.accuracy)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
