'use client';

import { Command as CommandPrimitive } from 'cmdk';
import {
  ArrowRight,
  Loader2,
  Music,
  Search,
  Swords,
  Trophy,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import SectionError from '@/components/error/SectionError';
import { IconButton } from '@/components/kit/controls/IconButton';
import { EmptyState } from '@/components/kit/feedback/EmptyState';
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  getSearchMinimumHint,
  isBelowSearchMinimum,
  MAX_SEARCH_LENGTH,
} from '@/lib/kit/lists/search';
import type { KitIcon } from '@/lib/kit/layout/icon';
import { useDebouncedSearchTerm } from '@/lib/hooks/useDebouncedSearchTerm';
import { useSearch } from '@/lib/hooks/useSearch';
import { SearchRequestSchema } from '@/lib/orpc/schema/search';
import { cn } from '@/lib/utils';

import {
  BeatmapResultContent,
  MatchResultContent,
  PlayerResultContent,
  TournamentResultContent,
} from './results';
import { getSeeAllHref, type SeeAllTarget } from './see-all';

/** The header search accepts what its procedure accepts. */
const MAX_LENGTH =
  SearchRequestSchema.shape.searchKey.maxLength ?? MAX_SEARCH_LENGTH;

/** Results are links; the shared command item tints the one Enter opens. */
const ITEM_CLASSES = 'cursor-pointer';

/** A prompt in the results area: before typing, and below the minimum. */
const PROMPT_CLASSES = 'px-4 py-8 text-center text-sm text-muted-foreground';

const SEE_ALL_LABELS: Record<SeeAllTarget, string> = {
  players: 'See all on the leaderboard',
  tournaments: 'See all tournaments',
  beatmaps: 'See all beatmaps',
};

function GroupHeading({ icon: Icon, label }: { icon: KitIcon; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      {label}
    </span>
  );
}

/**
 * The header search, open to everyone: a search button (and Ctrl/Cmd+K)
 * opens a command menu of players, tournaments, matches and beatmaps. It
 * searches like every list's SearchField: 400ms after the last keystroke (or
 * at once on Enter), from two characters, with a spinner while it waits.
 * Each group ends with a link that opens the matching list already searched.
 */
export default function SearchCommandDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const router = useRouter();
  const { term, typed, waiting, searchNow, reset } =
    useDebouncedSearchTerm(text);
  const { data, error, isLoading, isValidating, mutate } = useSearch(term);

  const changeOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        setText('');
        reset();
      }
    },
    [reset]
  );

  useHotkeys(
    'mod+k',
    (e) => {
      e.preventDefault();
      changeOpen(!open);
    },
    { enableOnFormTags: true },
    [open, changeOpen]
  );

  const handleSelect = useCallback(
    (href: string) => {
      router.push(href);
      changeOpen(false);
    },
    [router, changeOpen]
  );

  const clear = () => {
    setText('');
    inputRef.current?.focus();
  };

  const belowMinimum = isBelowSearchMinimum(text);
  const busy = (waiting && typed !== '') || (term !== '' && isLoading);
  const failed = term !== '' && Boolean(error) && !isLoading;
  // SWR keeps the last results while a new term loads, but they belong to an
  // earlier query once the field is cleared or a search fails.
  const results = term === '' || failed ? undefined : data;
  const hasResults =
    results !== undefined &&
    (results.players.length > 0 ||
      results.tournaments.length > 0 ||
      results.matches.length > 0 ||
      results.beatmaps.length > 0);
  const empty =
    term !== '' &&
    !isLoading &&
    !failed &&
    results !== undefined &&
    !hasResults;

  const seeAll = (target: SeeAllTarget) => (
    <CommandItem
      value={`see-all-${target}`}
      data-testid={`search-see-all-${target}`}
      onSelect={() => handleSelect(getSeeAllHref(target, term))}
      className={cn(ITEM_CLASSES, 'py-2.5 font-medium')}
    >
      <span className="flex-1">{SEE_ALL_LABELS[target]}</span>
      <ArrowRight aria-hidden className="text-muted-foreground" />
    </CommandItem>
  );

  return (
    <>
      <IconButton
        data-testid="search-trigger-button"
        label="Search"
        tooltipSide="bottom"
        size="default"
        icon={Search}
        onClick={() => changeOpen(true)}
      />

      <CommandDialog
        open={open}
        onOpenChange={changeOpen}
        title="Search"
        description="Search players, tournaments, matches and beatmaps"
        // Pinned near the top rather than centred, so the field stays put
        // while results grow the list under it; 12px corners like every
        // dialog.
        contentClassName="top-4 translate-y-0 rounded-xl sm:top-[10vh] md:max-w-[612px] [&>button:last-child]:hidden"
      >
        <Command
          data-testid="search-dialog"
          label="Search players, tournaments, matches and beatmaps"
          shouldFilter={false}
          loop
        >
          <div className="flex items-center gap-2 border-b pr-2 pl-4">
            {busy ? (
              <Loader2
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin text-muted-foreground"
              />
            ) : (
              <Search
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
            <CommandPrimitive.Input
              ref={inputRef}
              data-testid="search-input"
              aria-label="Search players, tournaments, matches and beatmaps"
              aria-describedby={belowMinimum ? hintId : undefined}
              aria-busy={busy || undefined}
              placeholder="Search players, tournaments…"
              value={text}
              maxLength={MAX_LENGTH}
              onValueChange={(value) => setText(value.trimStart())}
              onKeyDown={(event) => {
                // Enter searches at once; once results are in, it opens the
                // highlighted one.
                if (event.key === 'Enter' && waiting) {
                  event.preventDefault();
                  searchNow();
                }
              }}
              className="h-12 min-w-0 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground sm:text-sm"
            />
            {text ? (
              <IconButton
                label="Clear search"
                icon={X}
                tooltip={false}
                onClick={clear}
              />
            ) : null}
          </div>

          <CommandList
            data-testid="search-results-list"
            className="max-h-[min(400px,calc(100svh-10rem))] md:max-h-[min(800px,calc(100svh-10rem))]"
          >
            {!text.trim() ? (
              <p className={PROMPT_CLASSES}>Start typing to search</p>
            ) : null}

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
                description="Try again in a moment."
                retrying={isValidating}
                onRetry={() => void mutate()}
              />
            ) : null}

            {!belowMinimum && empty ? (
              <EmptyState
                size="compact"
                title="No results found"
                description="Try adjusting your search terms."
                data-testid="search-empty"
              />
            ) : null}

            {!belowMinimum && hasResults && results ? (
              <>
                {results.players.length > 0 ? (
                  <CommandGroup
                    data-testid="search-group-players"
                    heading={<GroupHeading icon={User} label="Players" />}
                  >
                    {results.players.map((player) => (
                      <CommandItem
                        key={`player-${player.id}`}
                        value={`player-${player.id}`}
                        onSelect={() =>
                          handleSelect(
                            player.ruleset != null
                              ? `/players/${player.id}?ruleset=${player.ruleset}`
                              : `/players/${player.id}`
                          )
                        }
                        className={cn(ITEM_CLASSES, 'h-auto py-3')}
                      >
                        <PlayerResultContent data={player} query={term} />
                      </CommandItem>
                    ))}
                    {seeAll('players')}
                  </CommandGroup>
                ) : null}

                {results.tournaments.length > 0 ? (
                  <CommandGroup
                    data-testid="search-group-tournaments"
                    heading={<GroupHeading icon={Trophy} label="Tournaments" />}
                  >
                    {results.tournaments.map((tournament) => (
                      <CommandItem
                        key={`tournament-${tournament.id}`}
                        value={`tournament-${tournament.id}`}
                        onSelect={() =>
                          handleSelect(`/tournaments/${tournament.id}`)
                        }
                        className={cn(ITEM_CLASSES, 'h-auto py-3')}
                      >
                        <TournamentResultContent
                          data={tournament}
                          query={term}
                        />
                      </CommandItem>
                    ))}
                    {seeAll('tournaments')}
                  </CommandGroup>
                ) : null}

                {results.matches.length > 0 ? (
                  <CommandGroup
                    data-testid="search-group-matches"
                    heading={<GroupHeading icon={Swords} label="Matches" />}
                  >
                    {results.matches.map((match) => (
                      <CommandItem
                        key={`match-${match.id}`}
                        value={`match-${match.id}`}
                        onSelect={() => handleSelect(`/matches/${match.id}`)}
                        className={cn(ITEM_CLASSES, 'h-auto py-3')}
                      >
                        <MatchResultContent data={match} query={term} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}

                {results.beatmaps.length > 0 ? (
                  <CommandGroup
                    data-testid="search-group-beatmaps"
                    heading={<GroupHeading icon={Music} label="Beatmaps" />}
                  >
                    {results.beatmaps.map((beatmap) => (
                      <CommandItem
                        key={`beatmap-${beatmap.osuId}`}
                        value={`beatmap-${beatmap.osuId}`}
                        onSelect={() =>
                          handleSelect(`/beatmaps/${beatmap.osuId}`)
                        }
                        className={cn(ITEM_CLASSES, 'h-auto py-3')}
                      >
                        <BeatmapResultContent data={beatmap} query={term} />
                      </CommandItem>
                    ))}
                    {seeAll('beatmaps')}
                  </CommandGroup>
                ) : null}
              </>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
