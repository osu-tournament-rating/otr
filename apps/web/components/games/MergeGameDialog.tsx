'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { Callout } from '@/components/kit/feedback/Callout';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { Textarea } from '@/components/ui/textarea';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import { orpc } from '@/lib/orpc/orpc';
import type { Game, GameAdminPreview } from '@/lib/orpc/schema/match';
import { resolveErrorMessage } from '@/lib/utils/error';

const GAME_ID_SEPARATORS = /[,\s\n]+/;
const TEXTAREA_PLACEHOLDER =
  'Enter child game IDs (comma, space, or newline separated)\nExample: 123, 456, 789';

function parseGameIds(input: string): number[] {
  return input
    .split(GAME_ID_SEPARATORS)
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * Merges the scores of other games into this one, from the game card's
 * actions menu: the admin enters child game IDs, checks what they fetched,
 * then confirms in the same dialog.
 */
export default function MergeGameDialog({
  game,
  open,
  onOpenChange,
}: {
  game: Game;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [gameIdsInput, setGameIdsInput] = useState('');
  const [childGames, setChildGames] = useState<GameAdminPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [beatmapMismatch, setBeatmapMismatch] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const gameLabel = `game ${formatId(game.id)}`;

  const reset = () => {
    setConfirming(false);
    setGameIdsInput('');
    setChildGames([]);
    setError(null);
    setBeatmapMismatch(null);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const validate = (gameIds: number[]): string | null => {
    if (gameIds.length === 0)
      return 'Child game IDs must be positive whole numbers';
    const uniqueIds = new Set(gameIds);
    if (uniqueIds.size !== gameIds.length)
      return 'Each child game ID can appear only once';
    if (uniqueIds.has(game.id)) return 'A game cannot be merged into itself';
    return null;
  };

  const fetchGames = async () => {
    const input = gameIdsInput.trim();
    if (!input) {
      setError('Child game IDs are required');
      return;
    }

    const gameIds = parseGameIds(input);
    const validationError = validate(gameIds);
    if (validationError) {
      setError(validationError);
      return;
    }

    const uniqueIds = Array.from(new Set(gameIds));
    setIsFetching(true);
    setError(null);
    setBeatmapMismatch(null);

    try {
      const previews = await orpc.games.admin.lookup({ ids: uniqueIds });
      const previewMap = new Map(
        previews.map((preview) => [preview.id, preview])
      );
      const ordered = uniqueIds.map((id) => previewMap.get(id));

      if (ordered.some((preview) => !preview)) {
        throw new Error('Some games could not be resolved');
      }

      const resolved = ordered as GameAdminPreview[];
      setChildGames(resolved);

      const parentBeatmapId = game.beatmap?.osuId ?? null;
      const mismatched = resolved.find(
        (preview) => preview.beatmapOsuId !== parentBeatmapId
      );
      setBeatmapMismatch(
        mismatched
          ? `Game ${formatId(mismatched.id)} features a different beatmap than the parent game.`
          : null
      );
    } catch (err) {
      const message = resolveErrorMessage(
        err,
        'One or more games could not be retrieved'
      );
      console.error('Failed to fetch games for merge', err);
      setError(message);
      toast.error(message);
      setChildGames([]);
      setBeatmapMismatch(null);
    } finally {
      setIsFetching(false);
    }
  };

  const merge = async () => {
    if (childGames.length === 0 || beatmapMismatch) return;

    setIsMerging(true);
    try {
      const response = await orpc.games.admin.merge({
        id: game.id,
        childGameIds: childGames.map((child) => child.id),
      });

      toast.success('Games merged successfully', {
        description: `Moved ${formatCountOf(response.movedScoreCount, 'score')} from ${formatCountOf(response.mergedGameCount, 'child game')} into ${gameLabel}`,
      });
      close();
      router.refresh();
    } catch (err) {
      const message = resolveErrorMessage(err, 'Failed to merge games');
      console.error('Failed to merge games', err);
      toast.error(message);
    } finally {
      setIsMerging(false);
    }
  };

  const movedScores = childGames.reduce(
    (sum, child) => sum + child.scoresCount,
    0
  );

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(next) => {
        if (isMerging) return;
        if (next) onOpenChange(true);
        else close();
      }}
      title="Merge games"
      description={
        <>
          Merge scores from child games into{' '}
          <span className="font-medium text-foreground">{gameLabel}</span>.
        </>
      }
      notice={
        !confirming && beatmapMismatch ? (
          <Callout tone="danger">{beatmapMismatch}</Callout>
        ) : undefined
      }
      footer={
        confirming ? (
          <>
            <Button
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={isMerging}
            >
              Back
            </Button>
            <Button
              variant="destructive-confirm"
              onClick={() => void merge()}
              pending={isMerging}
            >
              {isMerging ? 'Merging…' : 'Merge games'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => setConfirming(true)}
              disabled={childGames.length === 0 || Boolean(beatmapMismatch)}
            >
              Continue
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            {formatCountOf(movedScores, 'score')} will move to {gameLabel}, and{' '}
            {formatCountOf(childGames.length, 'child game')} will be permanently
            deleted.
          </p>
          <p className="text-muted-foreground">This action cannot be undone.</p>
        </div>
      ) : (
        <>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            <li>All scores will be moved to this game</li>
            <li>Child games will be permanently deleted</li>
            <li>Games must have the same beatmap</li>
            <li>Players cannot have scores in multiple games</li>
          </ul>

          <div className="flex flex-col gap-2">
            <FormFieldLabel htmlFor={`merge-game-ids-${game.id}`}>
              Child game IDs
            </FormFieldLabel>
            <Textarea
              id={`merge-game-ids-${game.id}`}
              placeholder={TEXTAREA_PLACEHOLDER}
              value={gameIdsInput}
              onChange={(event) => setGameIdsInput(event.target.value)}
              rows={3}
            />
            <Button
              variant="outline"
              onClick={() => void fetchGames()}
              pending={isFetching}
              disabled={!gameIdsInput.trim()}
            >
              {isFetching ? 'Fetching…' : 'Fetch games'}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          {childGames.length > 0 ? (
            <section aria-label="Child games" className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {childGames.length === 1 ? 'Child game' : 'Child games'}{' '}
                <span className="font-normal text-muted-foreground">
                  {formatCount(childGames.length)}
                </span>
              </h3>
              <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
                {childGames.map((child) => (
                  <ChildGameRow key={child.id} game={child} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </DialogTemplate>
  );
}

function ChildGameRow({ game }: { game: GameAdminPreview }) {
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
      <p className="font-medium">Game {formatId(game.id)}</p>
      <p className="text-xs break-words text-muted-foreground">
        {game.beatmapTitle ?? 'Unknown beatmap'} [
        {game.beatmapDifficulty ?? 'Unknown difficulty'}]
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-xs text-muted-foreground">Beatmap ID</dt>
        <dd>
          {game.beatmapOsuId === null ? (
            <MissingValue />
          ) : (
            formatId(game.beatmapOsuId)
          )}
        </dd>
        <dt className="text-xs text-muted-foreground">Players</dt>
        <dd
          className={
            game.scoresCount === 0
              ? 'text-destructive tabular-nums'
              : 'tabular-nums'
          }
        >
          {formatCountOf(game.scoresCount, 'player')}
        </dd>
        <dt className="text-xs text-muted-foreground">Played</dt>
        <dd>
          <Timestamp date={game.startTime} />
        </dd>
      </dl>
    </li>
  );
}
