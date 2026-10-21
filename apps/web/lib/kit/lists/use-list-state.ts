'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from 'react';

import {
  applyListPatch,
  clearListFilters,
  countActiveFilters,
  listStateHref,
  listStatesEqual,
  parseListState,
  type ListParams,
  type ListState,
} from './params';
import {
  landShallowAddress,
  shallowSearchKey,
  syncShallowState,
  writeShallowAddress,
} from './shallow';

export interface ListStateUpdateOptions {
  /**
   * `push` (default) makes the change a step the back button undoes;
   * `replace` overwrites the current entry.
   */
  history?: 'push' | 'replace';
}

export interface UseListStateOptions {
  /**
   * For a list whose rows are all on the client already (fetched once, or
   * passed down whole): writes the address with `history.pushState` or
   * `replaceState` and skips the server render, so a change shows at once
   * and the page does not refetch. Back and forward still work, and a reload
   * or a shared link still opens the same list. Leave it off for a list the
   * server filters or pages.
   */
  shallow?: boolean;
}

export interface UseListStateResult<P extends ListParams> {
  /** The state to render: the address, plus any change still navigating. */
  state: ListState<P>;
  /**
   * Merges `patch` into the state and navigates. Changing anything but the
   * page sends the list back to page 1.
   */
  setState: (
    patch:
      | Partial<ListState<P>>
      | ((current: ListState<P>) => Partial<ListState<P>>),
    options?: ListStateUpdateOptions
  ) => void;
  /** "Clear all": resets filter-role params only. */
  clearFilters: () => void;
  /** The number for the Filters button. */
  activeFilterCount: number;
  /** True while the server renders the new state. Always false when shallow. */
  isPending: boolean;
  /**
   * A link to this list with `patch` applied, such as a pagination link. A
   * link into another list ("See all") uses `listStateHref` with that
   * list's spec instead. Following it renders on the server, so a shallow
   * list changes state with `setState` (`onPageChange`, `onSortChange`)
   * rather than links.
   */
  hrefFor: (patch: Partial<ListState<P>>) => string;
}

/** The address the browser shows now, which a shallow change has already updated. */
function currentSearch(): string | null {
  return typeof window === 'undefined' ? null : window.location.search;
}

/**
 * The list's state, read from and written to the page address, so a reload
 * or a shared link shows the same list. `params` must be a module-level
 * `defineListParams` spec, the same one the server page parses.
 *
 * Changes render optimistically: controls show the new value at once while
 * the server renders the page for it. With `shallow`, nothing goes to the
 * server: the address changes in place and the state follows it. The page
 * must render dynamically (it reads `searchParams`), or wrap this component
 * in `<Suspense>`.
 */
export function useListState<P extends ListParams>(
  params: P,
  { shallow = false }: UseListStateOptions = {}
): UseListStateResult<P> {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const addressState = useMemo(
    () => parseListState(params, searchParams),
    [params, searchParams]
  );
  const [optimisticState, setOptimisticState] = useOptimistic(addressState);
  const [isPending, startTransition] = useTransition();

  // Shallow lists hold their state here, ahead of the address: Next.js
  // follows `pushState` into `useSearchParams` a render later. `pending`
  // holds the searches this list wrote that have not landed yet. When one
  // lands, the state stays, so an older change landing late never undoes a
  // newer one; any other change (back and forward, a link, `router.push`)
  // is followed. The browser's own address can't decide this: during a
  // router navigation's render it still shows the old one.
  const [shallowState, setShallowState] = useState(addressState);
  const [shallowSource, setShallowSource] = useState(addressState);
  const [pending, setPending] = useState<readonly string[]>([]);
  if (shallow && shallowSource !== addressState) {
    setShallowSource(addressState);
    const landing = landShallowAddress(pending, searchParams.toString());
    setPending(landing.pending);
    if (!landing.own || landing.pending.length === 0) {
      setShallowState(syncShallowState(params, shallowState, searchParams));
    }
  }

  // Back and forward follow the address the browser moved to. Next.js passes
  // them to `useSearchParams` too, but a Back right after a shallow change can
  // reach it in the same render as the change itself, so the search it reports
  // never changes and the list would keep the state Back undid.
  useEffect(() => {
    if (!shallow) return;
    const followHistory = () => {
      setPending([]);
      setShallowState((held) =>
        syncShallowState(params, held, window.location.search)
      );
    };
    window.addEventListener('popstate', followHistory);
    return () => window.removeEventListener('popstate', followHistory);
  }, [params, shallow]);

  const state = shallow ? shallowState : optimisticState;

  // Rapid changes build on each other, not on the last render's state.
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);

  const navigate = useCallback(
    (next: ListState<P>, history: 'push' | 'replace') => {
      if (listStatesEqual(params, latest.current, next)) return;
      const href = listStateHref(
        pathname,
        params,
        next,
        shallow ? (currentSearch() ?? searchParams) : searchParams
      );
      latest.current = next;
      if (shallow) {
        setShallowState(next);
        setPending((current) => [...current, shallowSearchKey(href)]);
        writeShallowAddress(href, history);
        return;
      }
      startTransition(() => {
        setOptimisticState(next);
        router[history](href, { scroll: false });
      });
    },
    [params, pathname, router, searchParams, setOptimisticState, shallow]
  );

  const setState = useCallback<UseListStateResult<P>['setState']>(
    (patch, { history = 'push' } = {}) => {
      const current = latest.current;
      const resolved = typeof patch === 'function' ? patch(current) : patch;
      navigate(applyListPatch(params, current, resolved), history);
    },
    [navigate, params]
  );

  const clearFilters = useCallback(() => {
    navigate(clearListFilters(params, latest.current), 'push');
  }, [navigate, params]);

  const hrefState = shallow ? shallowState : addressState;
  const hrefFor = useCallback(
    (patch: Partial<ListState<P>>) =>
      listStateHref(
        pathname,
        params,
        applyListPatch(params, hrefState, patch),
        searchParams
      ),
    [hrefState, params, pathname, searchParams]
  );

  return {
    state,
    setState,
    clearFilters,
    activeFilterCount: countActiveFilters(params, state),
    isPending: shallow ? false : isPending,
    hrefFor,
  };
}
