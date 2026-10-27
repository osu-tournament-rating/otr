'use client';

import { type Ruleset } from '@otr/core/osu';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/kit/controls/Button';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { RulesetName } from '@/components/kit/format/RulesetName';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';
import { Textarea } from '@/components/ui/textarea';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import {
  getRejectionReasonTexts,
  getWarningTexts,
} from '@/lib/kit/status/reasons';
import { orpc } from '@/lib/orpc/orpc';
import type { MatchDetail } from '@/lib/orpc/schema/match';
import { resolveErrorMessage } from '@/lib/utils/error';

const MATCH_ID_SEPARATORS = /[,\s\n]+/;
const TEXTAREA_PLACEHOLDER =
  'Enter child match IDs (comma, space, or newline separated)\nExample: 123, 456, 789';

function parseMatchIds(input: string): number[] {
  return input
    .split(MATCH_ID_SEPARATORS)
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

/**
 * Merges other matches into this one, from the match hero's Admin menu: the
 * admin enters child match IDs, checks what they fetched, then confirms in
 * the same dialog.
 */
export default function MergeMatchDialog({
  match,
  open,
  onOpenChange,
}: {
  match: { id: number; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [matchIdsInput, setMatchIdsInput] = useState('');
  const [childMatches, setChildMatches] = useState<MatchDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const reset = () => {
    setConfirming(false);
    setMatchIdsInput('');
    setChildMatches([]);
    setError(null);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const validate = (matchIds: number[]): string | null => {
    if (matchIds.length === 0)
      return 'Child match IDs must be positive whole numbers';
    const uniqueIds = new Set(matchIds);
    if (uniqueIds.size !== matchIds.length)
      return 'Each child match ID can appear only once';
    if (uniqueIds.has(match.id)) return 'A match cannot be merged into itself';
    return null;
  };

  const fetchMatches = async () => {
    const input = matchIdsInput.trim();
    if (!input) {
      setError('Child match IDs are required');
      return;
    }

    const matchIds = parseMatchIds(input);
    const validationError = validate(matchIds);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsFetching(true);
    setError(null);

    try {
      const fetched = await Promise.all(
        Array.from(new Set(matchIds)).map((id) =>
          orpc.matches.get({ id, keyType: 'otr' })
        )
      );
      setChildMatches(fetched);
    } catch (err) {
      const message = resolveErrorMessage(
        err,
        'One or more matches could not be retrieved'
      );
      console.error('Failed to fetch matches for merge', err);
      setError(message);
      toast.error(message);
      setChildMatches([]);
    } finally {
      setIsFetching(false);
    }
  };

  const merge = async () => {
    if (childMatches.length === 0) return;

    setIsMerging(true);
    try {
      const response = await orpc.matches.admin.merge({
        id: match.id,
        childMatchIds: childMatches.map((child) => child.id),
      });

      toast.success(
        `Merged ${formatCountOf(response.mergedMatchCount, 'child match', 'child matches')} into parent match ${match.name}`
      );
      close();
      router.refresh();
    } catch (err) {
      const message = resolveErrorMessage(err, 'Failed to merge matches');
      console.error('Failed to merge matches', err);
      toast.error(message);
    } finally {
      setIsMerging(false);
    }
  };

  const childCount = formatCountOf(
    childMatches.length,
    'child match',
    'child matches'
  );

  return (
    <DialogTemplate
      open={open}
      onOpenChange={(next) => {
        if (isMerging) return;
        if (next) onOpenChange(true);
        else close();
      }}
      title="Merge matches"
      description={
        <>
          Merge child matches into parent match{' '}
          <span className="font-medium text-foreground">{match.name}</span>. All
          games from the child matches will be moved here, and the child matches
          will be deleted.
        </>
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
              {isMerging ? 'Merging…' : 'Merge matches'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              onClick={() => setConfirming(true)}
              disabled={childMatches.length === 0}
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
            {childCount} will be merged into parent match{' '}
            <span className="font-medium">{match.name}</span>.
          </p>
          <p className="text-muted-foreground">This action cannot be undone.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <FormFieldLabel htmlFor="merge-match-ids">
              Child match IDs
            </FormFieldLabel>
            <Textarea
              id="merge-match-ids"
              placeholder={TEXTAREA_PLACEHOLDER}
              value={matchIdsInput}
              onChange={(event) => setMatchIdsInput(event.target.value)}
              className="field-sizing-fixed"
              rows={3}
            />
            <Button
              variant="outline"
              onClick={() => void fetchMatches()}
              pending={isFetching}
              disabled={!matchIdsInput.trim()}
            >
              {isFetching ? 'Fetching…' : 'Fetch matches'}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {error}
              </p>
            ) : null}
          </div>

          {childMatches.length > 0 ? (
            <section aria-label="Child matches" className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {childMatches.length === 1 ? 'Child match' : 'Child matches'}{' '}
                <span className="font-normal text-muted-foreground">
                  {formatCount(childMatches.length)}
                </span>
              </h3>
              <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
                {childMatches.map((child, index) => (
                  <ChildMatchRow key={child.id} match={child} index={index} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </DialogTemplate>
  );
}

function ChildMatchRow({
  match,
  index,
}: {
  match: MatchDetail;
  index: number;
}) {
  const ruleset = (match.games?.[0]?.ruleset ?? 0) as Ruleset;
  // Lazer rooms live at a different address, as in the match hero.
  const mpUrl = !match.osuId
    ? null
    : match.isLazer
      ? `https://osu.ppy.sh/multiplayer/rooms/${match.osuId}`
      : `https://osu.ppy.sh/community/matches/${match.osuId}`;

  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
      <p className="font-medium">
        #{index + 1} {match.name}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        <dt className="text-xs text-muted-foreground">Ruleset</dt>
        <dd>
          <RulesetName ruleset={ruleset} />
        </dd>
        {mpUrl ? (
          <>
            <dt className="text-xs text-muted-foreground">MP link</dt>
            <dd className="min-w-0 truncate">
              <a
                href={mpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm underline underline-offset-2 transition-colors hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {formatId(match.osuId)}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </dd>
          </>
        ) : null}
        <dt className="text-xs text-muted-foreground">Games</dt>
        <dd className="tabular-nums">
          {formatCount(match.games?.length ?? 0)}
        </dd>
        <dt className="text-xs text-muted-foreground">End time</dt>
        <dd>
          <Timestamp date={match.endTime} />
        </dd>
        <dt className="text-xs text-muted-foreground">Status</dt>
        <dd>
          <VerificationStatusBadge
            size="sm"
            status={match.verificationStatus}
            warnings={getWarningTexts('match', match.warningFlags)}
            rejectionReasons={getRejectionReasonTexts(
              'match',
              match.rejectionReason
            )}
            reviewer={match.verifiedByUsername}
            pendingRating={match.pendingRating}
            tooltip="tap"
          />
        </dd>
      </dl>
    </li>
  );
}
