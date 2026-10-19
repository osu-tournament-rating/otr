'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  normalizeSearchTerm,
  SEARCH_DEBOUNCE_MS,
} from '@/lib/kit/lists/search';

/**
 * The term to search for while someone types `text`: it follows the typed
 * term once typing pauses for `SEARCH_DEBOUNCE_MS`, and at once when the field
 * is cleared or drops below the minimum length. `waiting` is true while the
 * two differ; `searchNow` skips the wait, as Enter does.
 */
export function useDebouncedSearchTerm(text: string) {
  const [term, setTerm] = useState('');
  const typed = normalizeSearchTerm(text);

  useEffect(() => {
    if (typed === term) return;
    const timer = window.setTimeout(
      () => setTerm(typed),
      typed ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => window.clearTimeout(timer);
  }, [term, typed]);

  const searchNow = useCallback(() => setTerm(typed), [typed]);
  const reset = useCallback(() => setTerm(''), []);

  return { term, typed, waiting: typed !== term, searchNow, reset };
}
