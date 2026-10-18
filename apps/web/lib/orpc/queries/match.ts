import { cache } from 'react';

import { orpc } from '@/lib/orpc/orpc';

export const getMatchCached = cache(async (id: number) =>
  orpc.matches.get({ id, keyType: 'otr' })
);

export const getMatchMergeCached = cache(async (id: number) =>
  orpc.matches.getMerge({ id })
);
