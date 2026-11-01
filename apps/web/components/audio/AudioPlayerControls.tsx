'use client';

import {
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import BeatmapCover from '@/components/beatmaps/BeatmapCover';
import { IconButton } from '@/components/kit/controls/IconButton';
import { Slider } from '@/components/ui/slider';
import {
  DEFAULT_PREVIEW_VOLUME,
  formatPreviewTime,
  sliderPercentToVolume,
  volumeToSliderPercent,
} from '@/lib/audio/preview';
import { useAudioPlayer, useAudioPlayerTime } from '@/lib/hooks/useAudioPlayer';
import { cn } from '@/lib/utils';

const TRACK_CLASS = '[&_[data-slot=slider-track]]:bg-foreground/15';

export default function AudioPlayerControls() {
  const { state, play, pause, close, setVolume, seek, getAudioElement } =
    useAudioPlayer();
  const reportedTime = useAudioPlayerTime();
  const lastAudibleVolume = useRef(
    state.volume > 0 ? state.volume : DEFAULT_PREVIEW_VOLUME
  );

  useEffect(() => {
    if (state.volume > 0) lastAudibleVolume.current = state.volume;
  }, [state.volume]);

  const track = state.currentTrack;
  if (!track || state.currentlyPlaying === null) return null;

  const isMuted = state.volume === 0;
  const title = track.title?.trim() || `Beatmapset #${track.beatmapsetOsuId}`;
  const identity = [track.artist?.trim(), track.difficulty?.trim()]
    .filter(Boolean)
    .join(' · ');
  const playerState = state.error
    ? 'error'
    : state.isLoading
      ? 'loading'
      : state.isPlaying
        ? 'playing'
        : 'paused';
  const playLabel = state.isLoading
    ? 'Loading beatmap preview'
    : state.isPlaying
      ? 'Pause beatmap preview'
      : state.error
        ? 'Try again to play beatmap preview'
        : 'Play beatmap preview';
  const volumePercent = volumeToSliderPercent(state.volume);
  const VolumeIcon = isMuted ? VolumeX : volumePercent < 50 ? Volume1 : Volume2;

  const toggleMute = () => {
    setVolume(isMuted ? lastAudibleVolume.current : 0);
  };

  return (
    <>
      {/* Spacer for the fixed transport */}
      <div
        data-testid="audio-transport-spacer"
        aria-hidden
        className="h-32 sm:h-22"
      />
      <aside
        data-testid="audio-preview-transport"
        data-player-state={playerState}
        aria-label="Beatmap preview player"
        className="fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-50 mx-auto max-w-[1050px] motion-safe:duration-300 motion-safe:ease-out motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6"
      >
        <div className="relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg dark:bg-muted">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 py-3 pr-11 pl-3 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,1.4fr)_auto] sm:items-center sm:gap-5 sm:py-3 sm:pr-12">
            <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
              <div className="relative isolate shrink-0">
                <BeatmapCover
                  beatmapsetOsuId={track.beatmapsetOsuId}
                  alt=""
                  sizes="80px"
                  className="h-12 w-20 rounded-lg border"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-lg bg-black/30"
                />
                <IconButton
                  data-testid="audio-transport-play-pause"
                  variant="overlay"
                  size="default"
                  label={playLabel}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  onClick={() =>
                    state.isPlaying || state.isLoading ? pause() : play(track)
                  }
                >
                  {state.isLoading ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : state.isPlaying ? (
                    <Pause aria-hidden="true" />
                  ) : state.error ? (
                    <RefreshCw aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                </IconButton>
              </div>

              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Preview
                </p>
                <p className="truncate text-sm leading-tight font-semibold">
                  {title}
                </p>
                <p
                  className={cn(
                    'mt-0.5 truncate text-xs text-muted-foreground',
                    state.error && 'text-destructive'
                  )}
                  role={state.error ? 'status' : undefined}
                >
                  {state.error || identity || 'osu! beatmap preview'}
                </p>
              </div>
            </div>

            <PreviewTimeline
              duration={state.duration}
              isPlaying={state.isPlaying}
              disabled={!state.duration || Boolean(state.error)}
              reportedTime={reportedTime}
              onSeek={seek}
              getAudioElement={getAudioElement}
            />

            <div className="flex min-w-0 items-center justify-end gap-1.5">
              <IconButton
                label={isMuted ? 'Unmute preview' : 'Mute preview'}
                icon={VolumeIcon}
                onClick={toggleMute}
              />
              <Slider
                data-testid="audio-transport-volume"
                className={cn('w-16 flex-none sm:w-24', TRACK_CLASS)}
                value={[volumePercent]}
                max={100}
                step={1}
                onValueChange={(value) =>
                  setVolume(sliderPercentToVolume(value[0]))
                }
                getThumbProps={() => ({
                  'aria-label': 'Preview volume',
                  'aria-valuetext': `${volumePercent} percent`,
                })}
              />
            </div>
          </div>

          <IconButton
            data-testid="audio-transport-close"
            label="Close audio preview"
            icon={X}
            tooltip={false}
            className="absolute top-2 right-2 sm:top-1/2 sm:-translate-y-1/2"
            onClick={close}
          />

          <span className="sr-only" aria-live="polite">
            {state.error ||
              (state.isLoading
                ? `Loading ${title}`
                : state.isPlaying
                  ? `Playing ${title}`
                  : `${title} paused`)}
          </span>
        </div>
      </aside>
    </>
  );
}

function PreviewTimeline({
  duration,
  isPlaying,
  disabled,
  reportedTime,
  onSeek,
  getAudioElement,
}: {
  duration: number;
  isPlaying: boolean;
  disabled: boolean;
  reportedTime: number;
  onSeek: (time: number) => void;
  getAudioElement: () => HTMLAudioElement | null;
}) {
  const [sampledTime, setSampledTime] = useState<number | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      setSampledTime(null);
      return;
    }

    let frame = 0;
    const sample = () => {
      const audio = getAudioElement();
      if (audio) setSampledTime(audio.currentTime);
      frame = requestAnimationFrame(sample);
    };

    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, getAudioElement]);

  const position = Math.min(
    isPlaying && sampledTime !== null ? sampledTime : reportedTime,
    duration || 0
  );

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        data-testid="audio-transport-current-time"
        className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
      >
        {formatPreviewTime(position)}
      </span>
      <Slider
        data-testid="audio-transport-progress"
        className={cn('min-w-0 flex-1', TRACK_CLASS)}
        value={[position]}
        max={duration || 1}
        step={0.1}
        disabled={disabled}
        onValueChange={(value) => onSeek(value[0])}
        getThumbProps={() => ({
          'aria-label': 'Preview progress',
          'aria-valuetext': `${formatPreviewTime(position)} of ${formatPreviewTime(duration)}`,
        })}
      />
      <span
        data-testid="audio-transport-duration"
        className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums"
      >
        {formatPreviewTime(duration)}
      </span>
    </div>
  );
}
