import { formatSecondsToMinutesSeconds } from '@otr/core/utils/time';
import { Activity, Clock3, ExternalLink } from 'lucide-react';

import RulesetPill from '@/components/beatmaps/RulesetPill';
import StarRatingPill from '@/components/beatmaps/StarRatingPill';
import { IconButton } from '@/components/kit/controls/IconButton';
import { HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { formatCount } from '@/lib/kit/format/number';
import type { BeatmapWithDetails } from '@/lib/orpc/schema/beatmapStats';

/** The essentials row under the beatmap hero's art. */
export default function BeatmapBannerData({
  beatmap,
}: {
  beatmap: BeatmapWithDetails;
}) {
  return (
    <div
      data-testid="beatmap-data-matte"
      role="group"
      aria-label="Beatmap essentials"
      className="flex flex-wrap items-center gap-2 p-4 sm:gap-2.5"
    >
      <RulesetPill
        ruleset={beatmap.ruleset}
        diffName={beatmap.diffName}
        size="md"
      />
      <StarRatingPill
        starRating={beatmap.sr}
        size="md"
        valueClassName="font-bold"
      />
      <HeroMetaItem
        icon={Activity}
        className="h-8 px-1 text-sm font-semibold tabular-nums [&>svg]:text-muted-foreground"
      >
        {`${formatCount(Math.round(beatmap.bpm))} BPM`}
      </HeroMetaItem>
      <HeroMetaItem
        icon={Clock3}
        className="h-8 px-1 text-sm font-semibold tabular-nums [&>svg]:text-muted-foreground"
      >
        {formatSecondsToMinutesSeconds(beatmap.totalLength)}
      </HeroMetaItem>

      <IconButton
        asChild
        variant="outline"
        icon={ExternalLink}
        label="View on osu!"
        className="ml-auto"
      >
        <a
          data-testid="beatmap-external-link"
          href={`https://osu.ppy.sh/beatmaps/${beatmap.osuId}`}
          target="_blank"
          rel="noopener noreferrer"
        />
      </IconButton>
    </div>
  );
}
