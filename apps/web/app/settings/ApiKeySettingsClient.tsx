'use client';

import { Copy, KeyRound, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { SETTINGS_COPY } from '@/app/settings/settings-copy';
import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { IconButton } from '@/components/kit/controls/IconButton';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import { Timestamp } from '@/components/kit/format/Timestamp';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import { PhoneRow, PhoneRowList } from '@/components/kit/tables/PhoneRow';
import { Input } from '@/components/ui/input';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import type { ApiKeyMetadataWithKey } from '@/lib/orpc/schema/apiKey';
import { orpc } from '@/lib/orpc/orpc';
import { getApiKeyPreview } from '@/lib/utils/apiKey';

interface ApiKeySettingsClientProps {
  initialKeys: ApiKeyMetadataWithKey[];
  rateLimit: {
    maxRequests: number;
    timeWindowMs: number;
  };
}

const MAX_API_KEYS = 3;
const FALLBACK_KEY_NAME = 'API key';
const KEY_NAME_REQUIRED_MESSAGE = 'Key name is required';

const getKeyName = (metadata: ApiKeyMetadataWithKey) =>
  metadata.name && metadata.name.trim().length > 0
    ? metadata.name.trim()
    : FALLBACK_KEY_NAME;

const calculateRequestsPerMinute = (
  maxRequests: number | null,
  timeWindowMs: number | null,
  fallbackMax: number,
  fallbackWindowMs: number
) => {
  const effectiveMax = maxRequests ?? fallbackMax;
  const effectiveWindow = timeWindowMs ?? fallbackWindowMs;

  if (!effectiveMax || !effectiveWindow) {
    return null;
  }

  const perMinute = Math.round((effectiveMax * 60000) / effectiveWindow);
  return perMinute > 0 ? perMinute : 1;
};

const formatRateLimit = (requestsPerMinute: number | null) =>
  requestsPerMinute
    ? `${formatCountOf(requestsPerMinute, 'request')} per minute`
    : 'Not rate limited';

export default function ApiKeySettingsClient({
  initialKeys,
  rateLimit,
}: ApiKeySettingsClientProps) {
  const [keys, setKeys] = useState<ApiKeyMetadataWithKey[]>(initialKeys);
  const [pendingName, setPendingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  // Kept after the confirm closes, so its title does not empty as it fades.
  const [keyToDelete, setKeyToDelete] = useState<ApiKeyMetadataWithKey | null>(
    null
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const sortedKeys = useMemo(
    () =>
      [...keys].sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return bTime - aTime;
      }),
    [keys]
  );

  const remainingSlots = Math.max(MAX_API_KEYS - keys.length, 0);

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (keys.length >= MAX_API_KEYS) {
      const message = `You can create up to ${MAX_API_KEYS} API keys. Remove an existing key before creating another.`;
      setError(message);
      toast.error(message);
      return;
    }

    const trimmedName = pendingName.trim();
    if (trimmedName.length === 0) {
      setError(KEY_NAME_REQUIRED_MESSAGE);
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      const metadata = await orpc.apiClients.generateKey({
        name: trimmedName,
      });

      setKeys((previous) => {
        const withoutDuplicate = previous.filter(
          (existing) => existing.id !== metadata.id
        );
        return [...withoutDuplicate, metadata];
      });

      setPendingName('');
      toast.success('API key generated successfully');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to generate an API key. Please try again.';
      setError(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopySecret = (value: string | null | undefined) => {
    const secret = value?.trim();
    if (!secret) {
      toast.error(
        'Secret is unavailable. Generate a new key to continue using the API.'
      );
      return;
    }

    navigator.clipboard
      .writeText(secret)
      .then(() => toast.success('API key copied to clipboard'))
      .catch(() => toast.error('Failed to copy API key.'));
  };

  const askToDelete = (key: ApiKeyMetadataWithKey) => {
    setKeyToDelete(key);
    setConfirmingDelete(true);
  };

  const deleteKey = async () => {
    if (!keyToDelete) return;

    await orpc.apiClients.deleteKey({ keyId: keyToDelete.id });
    setKeys((previous) => previous.filter((key) => key.id !== keyToDelete.id));
    toast.success('API key deleted');
  };

  const renderActions = (keyMetadata: ApiKeyMetadataWithKey) => (
    <span className="flex justify-end gap-1">
      <IconButton
        label="Copy API key"
        icon={Copy}
        onClick={() => handleCopySecret(keyMetadata.key)}
      />
      <IconButton
        label="Delete API key"
        icon={Trash2}
        destructive
        onClick={() => askToDelete(keyMetadata)}
      />
    </span>
  );

  const rows = sortedKeys.map((keyMetadata) => ({
    keyMetadata,
    name: getKeyName(keyMetadata),
    preview: getApiKeyPreview(keyMetadata),
    rateLimit: formatRateLimit(
      calculateRequestsPerMinute(
        keyMetadata.rateLimitMax,
        keyMetadata.rateLimitTimeWindow,
        rateLimit.maxRequests,
        rateLimit.timeWindowMs
      )
    ),
  }));

  return (
    <Panel data-testid="settings-api-keys-section">
      <SectionHeader
        icon={KeyRound}
        title="API keys"
        meta={`${formatCount(remainingSlots)} of ${formatCount(MAX_API_KEYS)} slots available`}
      />
      <PanelBody className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{SETTINGS_COPY.apiKeys}</p>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={handleGenerate}
          noValidate
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <FormFieldLabel
              htmlFor="api-key-name"
              invalid={error === KEY_NAME_REQUIRED_MESSAGE}
            >
              Key name
            </FormFieldLabel>
            <Input
              id="api-key-name"
              placeholder='e.g. "My spreadsheet"'
              value={pendingName}
              onChange={(event) => {
                setPendingName(event.target.value);
                if (error === KEY_NAME_REQUIRED_MESSAGE) setError(null);
              }}
              maxLength={100}
              disabled={isGenerating}
              aria-required="true"
              aria-invalid={error === KEY_NAME_REQUIRED_MESSAGE || undefined}
              aria-describedby={error ? 'api-key-error' : undefined}
            />
          </div>
          <Button
            type="submit"
            pending={isGenerating}
            data-testid="settings-create-api-key-button"
          >
            {isGenerating ? 'Generating…' : 'Generate API key'}
          </Button>
        </form>
        {error ? (
          <p
            id="api-key-error"
            role="alert"
            className="-mt-2 text-sm text-destructive-foreground"
          >
            {error}
          </p>
        ) : null}
      </PanelBody>

      {rows.length > 0 ? (
        <DataTable
          fixed
          aria-label="API keys"
          containerClassName="border-t"
          phoneRows={
            <PhoneRowList aria-label="API keys" className="border-t">
              {rows.map((row) => (
                <PhoneRow
                  key={row.keyMetadata.id}
                  title={<span className="truncate">{row.name}</span>}
                  description={[
                    row.preview === '—' ? null : row.preview,
                    row.rateLimit,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  value={renderActions(row.keyMetadata)}
                />
              ))}
            </PhoneRowList>
          }
        >
          <DataTableHeader>
            <DataTableRow>
              <DataTableHead>Key</DataTableHead>
              <DataTableHead className="w-48">Rate limit</DataTableHead>
              <DataTableHead className="w-52" showFrom="lg">
                Created
              </DataTableHead>
              <DataTableHead className="w-24" align="end">
                <span className="sr-only">Actions</span>
              </DataTableHead>
            </DataTableRow>
          </DataTableHeader>
          <DataTableBody>
            {rows.map((row) => (
              <DataTableRow key={row.keyMetadata.id}>
                <DataTableCell>
                  <span className="block truncate font-medium">{row.name}</span>
                  {row.preview !== '—' ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.preview}
                    </span>
                  ) : null}
                </DataTableCell>
                <DataTableCell>{row.rateLimit}</DataTableCell>
                <DataTableCell muted showFrom="lg">
                  <Timestamp date={row.keyMetadata.createdAt} />
                </DataTableCell>
                <DataTableCell align="end" empty={false}>
                  {renderActions(row.keyMetadata)}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      ) : (
        <EmptyState
          size="compact"
          icon={KeyRound}
          title="No API keys yet"
          className="border-t"
        />
      )}

      <div className="flex flex-col gap-1 border-t px-4 py-3 text-xs text-muted-foreground">
        {rows.length > 0 ? (
          <p>
            Include your key via{' '}
            <code className="font-sans font-medium text-foreground">
              Authorization: Bearer &lt;key&gt;
            </code>{' '}
            or{' '}
            <code className="font-sans font-medium text-foreground">
              x-api-key: &lt;key&gt;
            </code>{' '}
            when making API calls.
          </p>
        ) : null}
        <p>{SETTINGS_COPY.apiKeysReminder}</p>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete "${keyToDelete ? getKeyName(keyToDelete) : FALLBACK_KEY_NAME}"?`}
        description="This will immediately revoke access for any integration using this key."
        confirmLabel="Delete key"
        pendingLabel="Deleting…"
        errorText="Failed to delete API key. Try again."
        onConfirm={deleteKey}
      />
    </Panel>
  );
}
