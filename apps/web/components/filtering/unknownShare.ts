import { formatCount } from '@/lib/kit/format/number';

/**
 * The share of a filter request's players o!TR does not have, to one
 * decimal, so a request just over the 30% that holds it never reads as 30%.
 */
export function unknownPercent(unknown: number, total: number): string {
  return String(total > 0 ? Math.round((unknown * 1000) / total) / 10 : 0);
}

/** "4 of 10 (40%)": players o!TR does not have yet, of all in the request. */
export function formatUnknownShare(unknown: number, total: number): string {
  return `${formatCount(unknown)} of ${formatCount(total)} (${unknownPercent(unknown, total)}%)`;
}
