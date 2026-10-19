'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Loader2, Search, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import SectionError from '@/components/error/SectionError';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { IconButton } from '@/components/kit/controls/IconButton';
import { Badge } from '@/components/kit/status/Badge';
import {
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { OsuAvatar } from '@/components/ui/osu-avatar';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { useDebouncedSearchTerm } from '@/lib/hooks/useDebouncedSearchTerm';
import { formatId } from '@/lib/kit/format/number';
import {
  getSearchMinimumHint,
  isBelowSearchMinimum,
} from '@/lib/kit/lists/search';
import { orpc } from '@/lib/orpc/orpc';
import {
  AdminPlayerSearchInputSchema,
  type AdminPlayerSearchResult,
} from '@/lib/orpc/schema/user';
import { highlightMatch } from '@/lib/utils/search';

/** The SWR key prefix of the suggestions, for refreshing them after a ban. */
export const ADMIN_USER_SEARCH_KEY = 'admin-user-search';

const MAX_LENGTH = AdminPlayerSearchInputSchema.shape.query.maxLength ?? 100;

const PROMPT_CLASSES = 'px-4 py-6 text-center text-sm text-muted-foreground';

/**
 * The user lookup's field: suggestions open under it as you type and narrow
 * with each pause, searched like the header search but only among players
 * who have signed in, plus an exact osu! ID. Arrow keys move through them,
 * and Enter or a click picks one.
 */
export function UserLookupCombobox({
  onSelect,
}: {
  onSelect: (player: AdminPlayerSearchResult) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  // The name a pick filled in, which needs no search of its own.
  const [picked, setPicked] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // cmdk sets the input's id itself; the visible label reads it back.
  const [inputId, setInputId] = useState<string>();
  const hintId = useId();
  const { term, typed, waiting, searchNow } = useDebouncedSearchTerm(
    text === picked ? '' : text
  );

  useLayoutEffect(() => setInputId(inputRef.current?.id), []);

  const { data, error, isLoading, isValidating, mutate } = useSWR(
    term ? [ADMIN_USER_SEARCH_KEY, term] : null,
    ([, query]) => orpc.users.admin.search({ query }),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateIfStale: false,
      shouldRetryOnError: false,
    }
  );

  const belowMinimum = isBelowSearchMinimum(text);
  const busy = (waiting && typed !== '') || (term !== '' && isLoading);
  const failed = term !== '' && Boolean(error) && !isLoading;
  // SWR keeps the last suggestions while the next term loads, so they narrow
  // in place rather than flashing empty.
  const results = term === '' || failed ? undefined : data;
  // Opens once there is something to show, so no empty box flashes first.
  const showList = open && (belowMinimum || failed || results !== undefined);

  const choose = (player: AdminPlayerSearchResult) => {
    onSelect(player);
    setText(player.username);
    setPicked(player.username);
    setOpen(false);
  };

  const clear = () => {
    setText('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <FormFieldLabel htmlFor={inputId ?? ''}>Username</FormFieldLabel>
      <Popover open={showList} onOpenChange={setOpen}>
        <CommandPrimitive
          shouldFilter={false}
          loop
          label="Username"
          data-testid="admin-user-lookup-form"
        >
          <PopoverAnchor asChild>
            <div
              ref={anchorRef}
              className="flex h-10 items-center gap-2 rounded-lg border border-input bg-transparent pr-1 pl-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
            >
              {busy ? (
                <Loader2
                  aria-hidden
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                />
              ) : (
                <Search
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
              )}
              <CommandPrimitive.Input
                ref={inputRef}
                value={text}
                maxLength={MAX_LENGTH}
                placeholder="osu! username or ID"
                autoComplete="off"
                aria-describedby={belowMinimum ? hintId : undefined}
                aria-busy={busy || undefined}
                onValueChange={(value) => {
                  setText(value.trimStart());
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                onKeyDown={(event) => {
                  // Enter searches at once; once suggestions are in, it
                  // picks the highlighted one.
                  if (event.key === 'Enter' && waiting) {
                    event.preventDefault();
                    searchNow();
                  }
                }}
                className="h-full min-w-0 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground md:text-sm"
              />
              {text ? (
                <IconButton
                  label="Clear search"
                  icon={X}
                  size="sm"
                  tooltip={false}
                  onClick={clear}
                />
              ) : null}
            </div>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) overflow-hidden rounded-lg p-0"
            // Focus stays in the field, and clicking the field never counts
            // as clicking outside.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              if (
                event.target instanceof Node &&
                anchorRef.current?.contains(event.target)
              ) {
                event.preventDefault();
              }
            }}
          >
            <CommandList className="max-h-[min(360px,50svh)]">
              <p
                id={hintId}
                aria-live="polite"
                className={belowMinimum ? PROMPT_CLASSES : 'sr-only'}
              >
                {belowMinimum ? getSearchMinimumHint() : null}
              </p>

              {!belowMinimum && failed ? (
                <SectionError
                  size="compact"
                  title="Search results could not load"
                  retrying={isValidating}
                  onRetry={() => void mutate()}
                />
              ) : null}

              {!belowMinimum && results?.length === 0 ? (
                <p className={PROMPT_CLASSES}>
                  No signed-in players match that name or ID.
                </p>
              ) : null}

              {!belowMinimum && results && results.length > 0 ? (
                <CommandGroup>
                  {results.map((player) => (
                    <CommandItem
                      key={player.playerId}
                      value={String(player.playerId)}
                      onSelect={() => choose(player)}
                      // The list sits in a portal, outside the focus the
                      // shared item's highlight waits for; it only shows
                      // while the field has focus anyway.
                      className="h-auto cursor-pointer gap-3 py-2 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                    >
                      <OsuAvatar
                        osuId={player.osuId}
                        username={player.username}
                        size={32}
                        className="shrink-0 border"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">
                          {highlightMatch(player.username, term)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          osu! ID {formatId(player.osuId)}
                          {player.matchedPreviousUsername ? (
                            <>
                              {' · formerly '}
                              {highlightMatch(
                                player.matchedPreviousUsername,
                                term
                              )}
                            </>
                          ) : null}
                        </span>
                      </span>
                      {player.banned ? (
                        <Badge size="sm" tone="destructive">
                          Banned
                        </Badge>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </PopoverContent>
        </CommandPrimitive>
      </Popover>
    </div>
  );
}
