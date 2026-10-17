'use client';

import useSWR from 'swr';

import { orpc } from '@/lib/orpc/orpc';
import type { SearchResponse } from '@/lib/orpc/schema/search';

export function useSearch(query: string) {
  return useSWR<SearchResponse | undefined, Error, [string, string]>(
    ['search', query],
    async ([, searchQuery]: [string, string]) => {
      if (!searchQuery || searchQuery.trim().length < 2) {
        return undefined;
      }

      const result = await orpc.search.query({
        searchKey: searchQuery,
      });

      return result;
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 3000,
      shouldRetryOnError: false,
    }
  );
}
