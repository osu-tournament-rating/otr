'use client';

import { Gavel, KeyRound, ListRestart, UserSearch } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import useSWR, { useSWRConfig } from 'swr';

import SectionError from '@/components/error/SectionError';
import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import {
  FormActions,
  FormGrid,
  FormPanel,
  FormSection,
} from '@/components/kit/controls/FormPanel';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import {
  PhoneRowListSkeleton,
  TableSkeleton,
} from '@/components/kit/feedback/Skeletons';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { Badge } from '@/components/kit/status/Badge';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { Label } from '@/components/ui/label';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatTimestamp } from '@/lib/kit/format/date';
import { formatCount, formatCountOf, formatId } from '@/lib/kit/format/number';
import type { AdminMassEnqueueResponse } from '@/lib/orpc/schema/admin';
import { orpc } from '@/lib/orpc/orpc';
import {
  ADMIN_BAN_REASONS,
  type AdminBanReason,
  type AdminPlayerSearchResult,
} from '@/lib/orpc/schema/user';
import { getApiKeyPreview } from '@/lib/utils/apiKey';
import { cn } from '@/lib/utils';

import {
  ADMIN_USER_SEARCH_KEY,
  UserLookupCombobox,
} from './UserLookupCombobox';

const PRIORITIES = ['Low', 'Normal', 'High'] as const;
type Priority = (typeof PRIORITIES)[number];

const PHASE_LABELS = {
  beatmaps: 'Beatmaps',
  matches: 'Matches',
  players: 'Players',
} as const;

/** Unique positive IDs from text separated by commas, spaces or newlines. */
function parseIds(input: string): number[] {
  if (!input.trim()) {
    return [];
  }

  const sanitized = input.replace(/[^\d\s,\n]+/g, ' ');

  const ids = sanitized
    .split(/[\s,\n]+/)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed || trimmed.length > 10) return null;
      const num = Number.parseInt(trimmed, 10);
      return Number.isSafeInteger(num) && num > 0 ? num : null;
    })
    .filter((id): id is number => id !== null);

  return Array.from(new Set(ids));
}

/** The admin home: user lookup with bans and API keys, and mass enqueue. */
export default function AdminDashboardClient() {
  return (
    <>
      <UserLookup />
      <MassEnqueue />
    </>
  );
}

function UserLookup() {
  const [result, setResult] = useState<AdminPlayerSearchResult | null>(null);
  const [keysShownFor, setKeysShownFor] = useState<number | null>(null);

  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [pendingPlayer, setPendingPlayer] =
    useState<AdminPlayerSearchResult | null>(null);
  const [banReason, setBanReason] = useState<AdminBanReason | null>(null);
  const [banError, setBanError] = useState<string | null>(null);

  const showKeys = result !== null && keysShownFor === result.playerId;
  const { mutate } = useSWRConfig();

  const openBanDialog = useCallback((player: AdminPlayerSearchResult) => {
    setPendingPlayer(player);
    setBanReason(
      ADMIN_BAN_REASONS.find((reason) => reason === player.banReason) ?? null
    );
    setBanError(null);
    setBanDialogOpen(true);
  }, []);

  const confirmBan = useCallback(async () => {
    if (!pendingPlayer || !banReason) {
      return;
    }

    try {
      await orpc.users.admin.ban({
        playerId: pendingPlayer.playerId,
        reason: banReason,
      });
    } catch (error) {
      console.error('[admin] ban failed', error);
      setBanError(
        error instanceof Error && error.message
          ? error.message
          : 'Unable to ban this account right now.'
      );
      throw error;
    }

    setResult((previous) =>
      previous && previous.playerId === pendingPlayer.playerId
        ? { ...previous, banned: true, banReason }
        : previous
    );
    // Suggestions carry ban status too.
    void mutate(
      (key) => Array.isArray(key) && key[0] === ADMIN_USER_SEARCH_KEY
    );
    toast.success(
      `${pendingPlayer.username} banned for ${banReason.toLowerCase()}.`
    );
  }, [banReason, mutate, pendingPlayer]);

  return (
    <Panel data-testid="admin-tool-user-lookup">
      <SectionHeader icon={UserSearch} title="User lookup" />
      <PanelBody className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Search for users by username or osu! ID to review ban status and API
          access.
        </p>
        <UserLookupCombobox onSelect={setResult} />
      </PanelBody>

      {result ? (
        <>
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <OsuAvatar
                osuId={result.osuId}
                username={result.username}
                size={40}
                className="shrink-0 border"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <EntityLink href={`/players/${result.playerId}`}>
                  {result.username}
                </EntityLink>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>osu! ID {formatId(result.osuId)}</span>
                  <span aria-hidden="true">·</span>
                  <Badge
                    size="sm"
                    tone={result.banned ? 'destructive' : 'neutral'}
                  >
                    {result.banned ? 'Banned' : 'Active'}
                  </Badge>
                  {result.banned && result.banReason ? (
                    <span>Reason: {result.banReason}</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={KeyRound}
                aria-expanded={showKeys}
                onClick={() =>
                  setKeysShownFor(showKeys ? null : result.playerId)
                }
              >
                {showKeys ? 'Hide API keys' : 'View API keys'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                icon={Gavel}
                onClick={() => openBanDialog(result)}
              >
                {result.banned ? 'Update ban reason' : 'Ban user'}
              </Button>
            </div>
          </div>
          {showKeys ? <UserApiKeys playerId={result.playerId} /> : null}
        </>
      ) : null}

      <ConfirmDialog
        open={banDialogOpen}
        onOpenChange={setBanDialogOpen}
        title="Ban this user?"
        description={
          <p>
            Select a reason to ban{' '}
            <span className="font-medium text-foreground">
              {pendingPlayer?.username ?? 'this player'}
            </span>
            . Their API keys and sessions will be disabled immediately.
          </p>
        }
        confirmLabel="Ban user"
        pendingLabel="Banning…"
        confirmDisabled={!banReason}
        errorText={banError ?? 'Unable to ban this account right now.'}
        onConfirm={confirmBan}
      >
        <BanReasonPicker value={banReason} onValueChange={setBanReason} />
      </ConfirmDialog>
    </Panel>
  );
}

function BanReasonPicker({
  value,
  onValueChange,
}: {
  value: AdminBanReason | null;
  onValueChange: (reason: AdminBanReason | null) => void;
}) {
  const labelId = useId();

  return (
    <div className="flex flex-col gap-2">
      <FormFieldLabel groupId={labelId}>Ban reason</FormFieldLabel>
      <RadioGroup
        aria-labelledby={labelId}
        value={value ?? ''}
        onValueChange={(next) =>
          onValueChange(
            ADMIN_BAN_REASONS.find((reason) => reason === next) ?? null
          )
        }
        className="gap-2"
      >
        {ADMIN_BAN_REASONS.map((reason) => (
          <label
            key={reason}
            htmlFor={`ban-reason-${reason}`}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50',
              value === reason &&
                'border-primary bg-primary/10 hover:bg-primary/10'
            )}
          >
            <RadioGroupItem value={reason} id={`ban-reason-${reason}`} />
            {reason}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** A user's active API keys, under the lookup result. */
function UserApiKeys({ playerId }: { playerId: number }) {
  const { data, error, isValidating, mutate } = useSWR(
    ['admin-user-api-keys', playerId],
    () => orpc.users.admin.apiKeys({ playerId }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const keys = data ?? [];

  return (
    <section aria-label="API keys" className="border-t">
      <SectionHeader
        level={3}
        icon={KeyRound}
        title="API keys"
        meta={
          keys.length > 0 ? formatCountOf(keys.length, 'active key') : undefined
        }
      />
      {!data && error ? (
        <SectionError
          size="compact"
          title="API keys could not load"
          retrying={isValidating}
          onRetry={() => void mutate()}
        />
      ) : !data ? (
        <div role="status" aria-label="Loading API keys">
          <TableSkeleton
            rows={2}
            cellHeight="h-5"
            columns={API_KEY_SKELETON_COLUMNS}
            phoneRows={<PhoneRowListSkeleton rows={2} />}
          />
        </div>
      ) : keys.length === 0 ? (
        <EmptyState size="compact" icon={KeyRound} title="No active API keys" />
      ) : (
        <DataTable
          fixed
          aria-label="API keys"
          phoneRows={
            <PhoneRowList aria-label="API keys">
              {keys.map((key) => (
                <PhoneRow
                  key={key.id}
                  title={<span className="truncate">{getKeyName(key)}</span>}
                  description={[
                    getApiKeyPreview(key),
                    key.lastRequest
                      ? `Last used ${formatTimestamp(key.lastRequest)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={formatCountOf(key.requestCount, 'request')}
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Name</DataTableHead>
              <DataTableHead className="w-36">Key</DataTableHead>
              <DataTableHead className="w-52" showFrom="lg">
                Last used
              </DataTableHead>
              <DataTableHead className="w-52" showFrom="lg">
                Created
              </DataTableHead>
              <DataTableHead className="w-24" numeric>
                Requests
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {keys.map((key) => (
              <DataTableRow key={key.id}>
                <DataTableCell className="truncate font-medium">
                  {getKeyName(key)}
                </DataTableCell>
                <DataTableCell className="truncate">
                  {getApiKeyPreview(key)}
                </DataTableCell>
                <DataTableCell muted showFrom="lg">
                  {key.lastRequest ? (
                    <Timestamp date={key.lastRequest} />
                  ) : null}
                </DataTableCell>
                <DataTableCell muted showFrom="lg">
                  <Timestamp date={key.createdAt} />
                </DataTableCell>
                <DataTableCell numeric>
                  {formatCount(key.requestCount)}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </section>
  );
}

const API_KEY_SKELETON_COLUMNS = [
  { label: 'Name' },
  { label: 'Key', width: 'w-36' },
  { label: 'Last used', width: 'w-52', showFrom: 'lg' },
  { label: 'Created', width: 'w-52', showFrom: 'lg' },
  { label: 'Requests', width: 'w-24', align: 'end' },
] as const;

function getKeyName(key: { name: string | null }) {
  return key.name && key.name.trim().length > 0 ? key.name.trim() : 'API key';
}

function MassEnqueue() {
  const [beatmapIdsInput, setBeatmapIdsInput] = useState('');
  const [matchIdsInput, setMatchIdsInput] = useState('');
  const [playerIdsInput, setPlayerIdsInput] = useState('');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [massEnqueueing, setMassEnqueueing] = useState(false);
  const [completion, setCompletion] = useState<AdminMassEnqueueResponse | null>(
    null
  );

  const [progressPhase, setProgressPhase] = useState<
    keyof typeof PHASE_LABELS | null
  >(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [showProgress, setShowProgress] = useState(false);
  const priorityLabelId = useId();

  const parsedBeatmapIds = useMemo(
    () => parseIds(beatmapIdsInput),
    [beatmapIdsInput]
  );
  const parsedMatchIds = useMemo(
    () => parseIds(matchIdsInput),
    [matchIdsInput]
  );
  const parsedPlayerIds = useMemo(
    () => parseIds(playerIdsInput),
    [playerIdsInput]
  );

  const handleMassEnqueue = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const beatmapIds = parsedBeatmapIds.filter(
        (id) => id >= 1 && id <= 20_000_000
      );
      const matchIds = parsedMatchIds.filter((id) => id >= 1);
      // parseIds keeps only positive IDs, the one rule player IDs have.
      const playerIds = parsedPlayerIds;

      const filteredBeatmaps = parsedBeatmapIds.length - beatmapIds.length;
      const filteredMatches = parsedMatchIds.length - matchIds.length;

      if (filteredBeatmaps > 0) {
        toast.warning(
          `Filtered out ${formatCountOf(filteredBeatmaps, 'invalid beatmap ID')} (must be between 1 and 20,000,000).`
        );
      }

      if (filteredMatches > 0) {
        toast.warning(
          `Filtered out ${formatCountOf(filteredMatches, 'invalid match ID')} (must be positive).`
        );
      }

      if (
        beatmapIds.length === 0 &&
        matchIds.length === 0 &&
        playerIds.length === 0
      ) {
        toast.error('No valid IDs to enqueue after filtering.');
        return;
      }

      setMassEnqueueing(true);
      setCompletion(null);
      setShowProgress(false);
      setProgressPhase(null);
      setProgressPercent(0);
      setCurrentBatch(0);
      setTotalBatches(0);
      setProgressMessage('');

      try {
        const iterator = await orpc.admin.massEnqueue({
          beatmapIds,
          matchIds,
          playerIds,
          priority,
        });

        for await (const update of iterator) {
          if (update.type === 'progress') {
            setShowProgress(true);
            setProgressPhase(update.phase);
            setCurrentBatch(update.currentBatch);
            setTotalBatches(update.totalBatches);
            setProgressMessage(update.message);

            const percent = (update.itemsProcessed / update.totalItems) * 100;
            setProgressPercent(Math.min(percent, 100));
          } else if (update.type === 'complete') {
            setCompletion({
              beatmapsUpdated: update.beatmapsUpdated,
              beatmapsSkipped: update.beatmapsSkipped,
              matchesUpdated: update.matchesUpdated,
              matchesSkipped: update.matchesSkipped,
              playersUpdated: update.playersUpdated,
              playersSkipped: update.playersSkipped,
              warnings: update.warnings,
            });

            const totalUpdated =
              update.beatmapsUpdated +
              update.matchesUpdated +
              update.playersUpdated;
            const totalSkipped =
              update.beatmapsSkipped +
              update.matchesSkipped +
              update.playersSkipped;

            if (totalUpdated > 0) {
              toast.success(
                `Successfully enqueued ${formatCountOf(totalUpdated, 'item')} for refetch.`
              );
            }

            if (totalSkipped > 0) {
              toast.info(
                `Skipped ${formatCountOf(totalSkipped, 'item')} (not found or already marked as 404).`
              );
            }

            update.warnings?.forEach((warning) => toast.warning(warning));
          }
        }
      } catch (error) {
        console.error('[admin] mass enqueue failed', error);

        let message = 'Mass enqueue failed. Please try again.';

        if (error && typeof error === 'object' && 'message' in error) {
          const errorMessage = String(error.message);

          if (
            errorMessage.toLowerCase().includes('validation') ||
            errorMessage.toLowerCase().includes('invalid')
          ) {
            if (errorMessage.includes('beatmap')) {
              message = `Beatmap validation error: ${errorMessage}`;
            } else if (errorMessage.includes('match')) {
              message = `Match validation error: ${errorMessage}`;
            } else {
              message = errorMessage;
            }
          } else if (errorMessage.length > 0 && errorMessage !== 'Error') {
            message = errorMessage;
          }
        }

        toast.error(message);
      } finally {
        setMassEnqueueing(false);
        setShowProgress(false);
      }
    },
    [parsedBeatmapIds, parsedMatchIds, parsedPlayerIds, priority]
  );

  return (
    <FormPanel
      onSubmit={handleMassEnqueue}
      data-testid="admin-tool-mass-enqueue"
    >
      <FormSection
        icon={ListRestart}
        title="Mass enqueue"
        description="Mass enqueue beatmaps, matches, and players for refetch. Enter IDs separated by commas, spaces, or newlines. Only IDs that exist in the database will be enqueued."
      >
        <FormGrid columns={3}>
          <IdField
            id="beatmap-ids"
            label="Beatmap IDs"
            placeholder="1234567, 2345678, 3456789…"
            value={beatmapIdsInput}
            onValueChange={setBeatmapIdsInput}
            parsed={
              beatmapIdsInput.trim()
                ? `${formatCountOf(parsedBeatmapIds.length, 'unique beatmap')} parsed`
                : undefined
            }
            disabled={massEnqueueing}
          />
          <IdField
            id="match-ids"
            label="Match IDs"
            placeholder="12345678, 23456789, 34567890…"
            value={matchIdsInput}
            onValueChange={setMatchIdsInput}
            parsed={
              matchIdsInput.trim()
                ? `${formatCountOf(parsedMatchIds.length, 'unique match', 'unique matches')} parsed`
                : undefined
            }
            disabled={massEnqueueing}
          />
          <IdField
            id="player-ids"
            label="Player osu! IDs"
            placeholder="1234567, 2345678, 3456789…"
            value={playerIdsInput}
            onValueChange={setPlayerIdsInput}
            parsed={
              playerIdsInput.trim()
                ? `${formatCountOf(parsedPlayerIds.length, 'unique player')} parsed`
                : undefined
            }
            disabled={massEnqueueing}
          />
        </FormGrid>

        <div className="flex flex-col gap-2">
          <FormFieldLabel groupId={priorityLabelId}>Priority</FormFieldLabel>
          <RadioGroup
            aria-labelledby={priorityLabelId}
            value={priority}
            onValueChange={(value) =>
              setPriority(
                PRIORITIES.find((option) => option === value) ?? 'Normal'
              )
            }
            disabled={massEnqueueing}
            className="flex flex-wrap gap-4"
          >
            {PRIORITIES.map((option) => (
              <div key={option} className="flex items-center gap-2">
                <RadioGroupItem value={option} id={`priority-${option}`} />
                <Label
                  htmlFor={`priority-${option}`}
                  className="cursor-pointer font-normal"
                >
                  {option}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {showProgress && massEnqueueing ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col gap-2 border-t pt-4"
          >
            <p className="text-sm font-medium">{progressMessage}</p>
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{progressPhase ? PHASE_LABELS[progressPhase] : null}</span>
              <span className="tabular-nums">
                Batch {formatCount(currentBatch)} of {formatCount(totalBatches)}
              </span>
            </div>
            <Progress
              value={progressPercent}
              className="h-2 w-full"
              aria-label="Mass enqueue progress"
            />
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {Math.round(progressPercent)}% complete
            </p>
          </div>
        ) : null}

        {completion ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <h3 className="text-sm font-medium">Results</h3>
            <StatTileGrid columns={3}>
              <StatTile
                label="Beatmaps"
                value={`${formatCount(completion.beatmapsUpdated)} enqueued`}
                sub={
                  completion.beatmapsSkipped > 0
                    ? `${formatCount(completion.beatmapsSkipped)} skipped`
                    : undefined
                }
              />
              <StatTile
                label="Matches"
                value={`${formatCount(completion.matchesUpdated)} enqueued`}
                sub={
                  completion.matchesSkipped > 0
                    ? `${formatCount(completion.matchesSkipped)} skipped`
                    : undefined
                }
              />
              <StatTile
                label="Players"
                value={`${formatCount(completion.playersUpdated)} enqueued`}
                sub={
                  completion.playersSkipped > 0
                    ? `${formatCount(completion.playersSkipped)} skipped`
                    : undefined
                }
              />
            </StatTileGrid>
          </div>
        ) : null}
      </FormSection>
      <FormActions>
        <Button type="submit" pending={massEnqueueing}>
          {massEnqueueing ? 'Enqueueing…' : 'Enqueue refetch'}
        </Button>
      </FormActions>
    </FormPanel>
  );
}

function IdField({
  id,
  label,
  placeholder,
  value,
  onValueChange,
  parsed,
  disabled,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onValueChange: (value: string) => void;
  parsed?: string;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <FormFieldLabel htmlFor={id}>{label}</FormFieldLabel>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={8}
        aria-describedby={parsed ? `${id}-parsed` : undefined}
      />
      {parsed ? (
        <p
          id={`${id}-parsed`}
          className="text-xs text-muted-foreground tabular-nums"
        >
          {parsed}
        </p>
      ) : null}
    </div>
  );
}
