'use client';

import { AuditEntityType, Ruleset } from '@otr/core/osu';
import { History, Music2, PencilLine, UserRound } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useEffect, useRef } from 'react';

import AudioPreviewButton from '@/components/audio/AudioPreviewButton';
import BeatmapAdminView, {
  canEditBeatmapByHand,
} from '@/components/beatmap/BeatmapAdminView';
import BeatmapBannerData from '@/components/beatmap/BeatmapBannerData';
import BeatmapCover from '@/components/beatmaps/BeatmapCover';
import StarRatingPill from '@/components/beatmaps/StarRatingPill';
import RulesetIcon from '@/components/icons/RulesetIcon';
import { IconButton } from '@/components/kit/controls/IconButton';
import { InfoButton } from '@/components/kit/layout/InfoButton';
import { DetailHero, HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { Eyebrow } from '@/components/kit/layout/Typography';
import SimpleTooltip from '@/components/simple-tooltip';
import { Separator } from '@/components/ui/separator';
import { entityTypeToSlug } from '@/lib/audit-entity-types';
import {
  getBeatmapArtist,
  getBeatmapDisplayRuleset,
  getBeatmapTitle,
} from '@/lib/beatmaps/presentation';
import { getStarRatingMarkColor } from '@/lib/kit/color/star-rating';
import { formatCountOf } from '@/lib/kit/format/number';
import { getRulesetLabel } from '@/lib/kit/format/ruleset';
import type {
  BeatmapWithDetails,
  RelatedBeatmapDifficulty,
} from '@/lib/orpc/schema/beatmapStats';

interface BeatmapHeaderProps {
  beatmap: BeatmapWithDetails;
  relatedDifficulties: RelatedBeatmapDifficulty[];
}

export default function BeatmapHeader({
  beatmap,
  relatedDifficulties,
}: BeatmapHeaderProps) {
  const setOwner = beatmap.setOwnerOverride ?? beatmap.beatmapset?.creator;
  const creators = Array.from(
    new Map(
      [...(setOwner ? [setOwner] : []), ...beatmap.creators].map(
        (creator) => [creator.id, creator] as const
      )
    ).values()
  );
  const artist = getBeatmapArtist(beatmap) ?? 'Unknown artist';
  const title = getBeatmapTitle(beatmap) ?? 'Unknown title';
  // Without a beatmapset there is no cover, so the hero is a plain panel.
  const beatmapsetOsuId = beatmap.beatmapset?.osuId;
  const onArt = beatmapsetOsuId !== undefined;

  return (
    <DetailHero
      data-testid="beatmap-header"
      art={
        onArt ? (
          <BeatmapCover
            beatmapsetOsuId={beatmapsetOsuId}
            alt={`${artist} - ${title} cover`}
            sizes="(max-width: 1050px) 100vw, 1050px"
            priority
            className="absolute inset-0"
            imageClassName="scale-[1.01] saturate-75 transition-transform duration-700 group-hover:scale-[1.0225]"
          />
        ) : undefined
      }
      title={title}
      titleSuffix={beatmap.diffName ? `[${beatmap.diffName}]` : undefined}
      meta={
        <>
          <HeroMetaItem icon={Music2}>{artist}</HeroMetaItem>
          {beatmap.manualOverride ? (
            <span className="inline-flex items-center gap-1.5">
              <PencilLine className="size-4 shrink-0" aria-hidden />
              Manually configured
              <InfoButton label="About manually configured" onArt={onArt}>
                No longer available in the osu! API
              </InfoButton>
            </span>
          ) : null}
          <HeroMetaItem icon={UserRound}>
            {creators.length > 0 ? (
              <>
                Mapped by{' '}
                {creators.map((creator, index) => (
                  <Fragment key={creator.id}>
                    {index > 0 ? ', ' : null}
                    <Link
                      href={`/players/${creator.id}`}
                      prefetch={false}
                      className={
                        onArt
                          ? 'rounded-sm font-medium text-white hover:underline focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none'
                          : 'rounded-sm font-medium text-foreground transition-colors hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
                      }
                    >
                      {creator.username}
                    </Link>
                  </Fragment>
                ))}
              </>
            ) : (
              'Unknown mapper'
            )}
          </HeroMetaItem>
        </>
      }
      // Left out entirely, not just empty, so the hero keeps no room for it.
      adminActions={
        canEditBeatmapByHand(beatmap) ? (
          <BeatmapAdminView beatmap={beatmap} onArt={onArt} />
        ) : undefined
      }
      actions={
        // Stacked on the art, so both fit the column the hero keeps clear
        // beside the title.
        <div
          className={
            onArt ? 'flex flex-col items-end gap-2' : 'flex items-center gap-2'
          }
        >
          {/* Audit pages are public, so the link is for everyone. */}
          <IconButton
            asChild
            variant={onArt ? 'overlay' : 'outline'}
            icon={History}
            label="View audit history"
          >
            <Link
              href={`/audit/${entityTypeToSlug(AuditEntityType.Beatmap)}/${beatmap.id}`}
              prefetch={false}
            />
          </IconButton>
          <AudioPreviewButton
            beatmapsetOsuId={beatmapsetOsuId}
            artist={artist}
            title={title}
            difficulty={beatmap.diffName}
          />
        </div>
      }
    >
      <BeatmapBannerData beatmap={beatmap} />
      <DifficultyNavigator
        currentOsuId={beatmap.osuId}
        difficulties={relatedDifficulties}
      />
    </DetailHero>
  );
}

function DifficultyNavigator({
  currentOsuId,
  difficulties,
}: {
  currentOsuId: number;
  difficulties: RelatedBeatmapDifficulty[];
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let cancelled = false;
    const centerActiveDifficulty = () => {
      const activeDifficulty = scroller.querySelector<HTMLElement>(
        '[aria-current="page"]'
      );
      if (cancelled || !activeDifficulty) return;

      const scrollerBounds = scroller.getBoundingClientRect();
      const activeBounds = activeDifficulty.getBoundingClientRect();
      const activeStart =
        scroller.scrollLeft + activeBounds.left - scrollerBounds.left;

      scroller.scrollLeft =
        activeStart + activeBounds.width <= scroller.clientWidth
          ? 0
          : activeStart - (scroller.clientWidth - activeBounds.width) / 2;
    };

    // Wait for real font metrics before centring.
    void document.fonts.ready.then(centerActiveDifficulty);

    return () => {
      cancelled = true;
    };
  }, [currentOsuId, difficulties.length]);

  if (difficulties.length < 2) return null;

  const difficultyGroups = Array.from(
    difficulties
      .reduce((groups, difficulty) => {
        const ruleset = getBeatmapDisplayRuleset(
          difficulty.ruleset,
          difficulty.diffName
        );
        const group = groups.get(ruleset) ?? [];
        group.push(difficulty);
        return groups.set(ruleset, group);
      }, new Map<Ruleset, RelatedBeatmapDifficulty[]>())
      .entries()
  ).sort(([rulesetA], [rulesetB]) => rulesetA - rulesetB);

  const showGroupLabels = difficultyGroups.length > 1;

  const renderDifficulty = (difficulty: RelatedBeatmapDifficulty) => {
    const isCurrent = difficulty.osuId === currentOsuId;
    const ruleset = getBeatmapDisplayRuleset(
      difficulty.ruleset,
      difficulty.diffName
    );
    const formattedRating = difficulty.sr.toFixed(2);
    const accessibleLabel = `${difficulty.diffName}, ${formattedRating} star rating`;
    const difficultyIcon = (
      <RulesetIcon
        ruleset={ruleset}
        className="size-5 shrink-0 fill-current [&_path]:fill-current"
        style={{ color: getStarRatingMarkColor(difficulty.sr) }}
        aria-hidden="true"
      />
    );

    if (isCurrent) {
      return (
        <Link
          key={difficulty.osuId}
          data-testid={`related-difficulty-${difficulty.osuId}`}
          href={`/beatmaps/${difficulty.osuId}`}
          prefetch={false}
          aria-current="page"
          aria-label={accessibleLabel}
          className="flex min-h-10 max-w-72 shrink-0 snap-start items-center gap-2 rounded-lg border bg-muted px-3 py-2 text-sm shadow-xs transition-colors hover:bg-muted/80 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-secondary/60 dark:hover:bg-secondary/80"
        >
          {difficultyIcon}
          <span className="min-w-0 flex-1 truncate font-medium">
            {difficulty.diffName}
          </span>
        </Link>
      );
    }

    return (
      <SimpleTooltip
        key={difficulty.osuId}
        content={
          <div className="max-w-64 space-y-1.5 py-0.5">
            <div className="flex items-start gap-2">
              {difficultyIcon}
              <StarRatingPill
                starRating={difficulty.sr}
                size="sm"
                className="shrink-0 sm:text-xs"
                testId={`difficulty-tooltip-star-rating-${difficulty.osuId}`}
              />
              <span className="text-sm leading-tight font-medium">
                {difficulty.diffName}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDifficultyUsage(difficulty)}
            </p>
          </div>
        }
      >
        <Link
          data-testid={`related-difficulty-${difficulty.osuId}`}
          href={`/beatmaps/${difficulty.osuId}`}
          prefetch={false}
          aria-label={accessibleLabel}
          // Icon-only from sm for a mouse, whose hover shows the tooltip. A
          // tap opens the link instead, so touch screens keep the name.
          className="flex min-h-10 max-w-64 shrink-0 snap-start items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-input/40 dark:hover:bg-secondary/60 pointer-fine:sm:size-10 pointer-fine:sm:max-w-none pointer-fine:sm:justify-center pointer-fine:sm:gap-0 pointer-fine:sm:px-0 pointer-fine:sm:py-0"
        >
          {difficultyIcon}
          <span className="min-w-0 truncate font-medium pointer-fine:sm:hidden">
            {difficulty.diffName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums pointer-fine:sm:hidden">
            {formattedRating} SR
          </span>
        </Link>
      </SimpleTooltip>
    );
  };

  return (
    <nav aria-label="Beatmapset difficulties">
      <div
        ref={scrollerRef}
        className="flex snap-x scroll-pl-4 gap-2 overflow-x-auto p-4 pt-3"
      >
        {difficultyGroups.map(([ruleset, groupDifficulties], groupIndex) => (
          <Fragment key={ruleset}>
            {groupIndex > 0 && (
              <Separator
                orientation="vertical"
                // Separator's `h-full` resolves to 0 in this self-centred flex row.
                className="mx-1 self-center data-[orientation=vertical]:h-6"
              />
            )}
            {showGroupLabels && (
              <Eyebrow className="snap-start self-center whitespace-nowrap">
                {getRulesetGroupLabel(ruleset)}
              </Eyebrow>
            )}
            {groupDifficulties.map(renderDifficulty)}
          </Fragment>
        ))}
      </div>
    </nav>
  );
}

/** Group headers drop the "(other)" mania qualifier. */
function getRulesetGroupLabel(ruleset: Ruleset): string {
  return ruleset === Ruleset.ManiaOther ? 'mania' : getRulesetLabel(ruleset);
}

function formatDifficultyUsage({
  pooledTournamentCount,
  verifiedGameCount,
}: RelatedBeatmapDifficulty): string {
  if (pooledTournamentCount === 0 && verifiedGameCount === 0) {
    return 'Not used in a tournament';
  }

  return `${formatCountOf(pooledTournamentCount, 'mappool')} · ${formatCountOf(verifiedGameCount, 'game')}`;
}
