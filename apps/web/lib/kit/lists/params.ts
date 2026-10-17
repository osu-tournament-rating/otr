/**
 * List state in the page address. A page describes every control that changes
 * what its list shows (search, sort, page, filters, ruleset, scope) as one
 * `defineListParams` spec; the server page parses it from `searchParams`, and
 * the client reads and writes it through `useListState`.
 *
 * Rules the codecs follow:
 * - Defaults are never written, so a fresh list has a bare address.
 * - Invalid values are ignored (read as the default), never thrown.
 * - Params the spec does not own, such as a hero tab, are left alone.
 * - Output order follows the spec, so the same state always gives the same URL.
 */

import {
  isSortDirection,
  sortStatesEqual,
  type SortDirection,
  type SortKey,
  type SortState,
} from './sort';
import { MAX_SEARCH_LENGTH, MIN_SEARCH_LENGTH } from './search';

/**
 * What a param does, which decides how the list treats it:
 *
 * - `filter`: behind the Filters button. Counted on the button, shown as an
 *   active-filter chip, and reset by "Clear all".
 * - `scope`: a visible switch such as ruleset chips, All / Friends or a tab.
 *   "Clear all" leaves it alone.
 * - `search`, `sort`: never cleared with filters.
 * - `page`: reset to the first page whenever anything else changes.
 */
export type ListParamRole = 'search' | 'sort' | 'page' | 'filter' | 'scope';

/** A resolved param: the URL keys it owns and how to read and write them. */
export interface ListParam<T> {
  readonly name: string;
  readonly keys: readonly string[];
  readonly role: ListParamRole;
  readonly defaultValue: T;
  parse(params: URLSearchParams): T;
  /** Writes `value`, or nothing when it equals the default. */
  write(value: T, params: URLSearchParams): void;
  equals(a: T, b: T): boolean;
}

/** A param before it knows its name; `defineListParams` resolves it. */
export interface ListParamDefinition<T> {
  resolve(name: string): ListParam<T>;
}

export type ListParams = Readonly<Record<string, ListParam<unknown>>>;

export type ListState<P extends ListParams> = {
  -readonly [K in keyof P]: P[K] extends ListParam<infer T> ? T : never;
};

type ResolvedParams<S extends Record<string, ListParamDefinition<unknown>>> = {
  readonly [K in keyof S]: S[K] extends ListParamDefinition<infer T>
    ? ListParam<T>
    : never;
};

/** Anything a page or hook has: `searchParams`, a query string, or `URLSearchParams`. */
export type SearchParamsInput =
  | URLSearchParams
  | string
  | Readonly<Record<string, string | readonly string[] | undefined>>
  | null
  | undefined;

export function toSearchParams(input: SearchParamsInput): URLSearchParams {
  if (input == null) return new URLSearchParams();
  if (typeof input === 'string') return new URLSearchParams(input);
  if (input instanceof URLSearchParams) return new URLSearchParams(input);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (typeof value === 'string') params.append(key, value);
    else for (const item of value) params.append(key, item);
  }
  return params;
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function firstValue(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value === null ? undefined : value;
}

// Plain decimals only: `Number()` would also accept `1e3`, `0x10` and ` `.
const DECIMAL = /^-?\d+(\.\d+)?$/;

function parseDecimal(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!DECIMAL.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function createParam<T>(options: {
  name: string;
  keys: readonly string[];
  role: ListParamRole;
  defaultValue: T;
  parse: (params: URLSearchParams) => T;
  write: (value: T, params: URLSearchParams) => void;
  equals?: (a: T, b: T) => boolean;
}): ListParam<T> {
  const equals = options.equals ?? Object.is;
  return {
    name: options.name,
    keys: options.keys,
    role: options.role,
    defaultValue: options.defaultValue,
    parse: options.parse,
    equals,
    write(value, params) {
      if (!equals(value, options.defaultValue)) options.write(value, params);
    },
  };
}

// --- Builders -------------------------------------------------------------

interface BaseOptions {
  /** The URL key. Defaults to the param's name in the spec. */
  key?: string;
  role?: ListParamRole;
}

/**
 * The list's search term, trimmed. A term shorter than `minLength` is not a
 * search, so it reads as empty and is never written.
 */
export function searchParam(
  options: BaseOptions & { minLength?: number; maxLength?: number } = {}
): ListParamDefinition<string> {
  const minLength = options.minLength ?? MIN_SEARCH_LENGTH;
  const maxLength = options.maxLength ?? MAX_SEARCH_LENGTH;
  const normalize = (raw: string | undefined) => {
    const trimmed = raw?.trim() ?? '';
    return trimmed.length >= minLength && trimmed.length <= maxLength
      ? trimmed
      : '';
  };

  return {
    resolve: (name) => {
      const key = options.key ?? name;
      return createParam({
        name,
        keys: [key],
        role: options.role ?? 'search',
        defaultValue: '',
        parse: (params) => normalize(firstValue(params, key)),
        write: (value, params) => {
          const term = normalize(value);
          if (term) params.set(key, term);
        },
        equals: (a, b) => normalize(a) === normalize(b),
      });
    },
  };
}

/** The 1-based page. Reset to 1 by `useListState` whenever anything else changes. */
export function pageParam(
  options: Omit<BaseOptions, 'role'> = {}
): ListParamDefinition<number> {
  return {
    resolve: (name) => {
      const key = options.key ?? name;
      return createParam({
        name,
        keys: [key],
        role: 'page',
        defaultValue: 1,
        parse: (params) => {
          const value = parseDecimal(firstValue(params, key));
          return value !== undefined && Number.isInteger(value) && value >= 1
            ? value
            : 1;
        },
        write: (value, params) => {
          if (Number.isInteger(value) && value > 1) {
            params.set(key, String(value));
          }
        },
      });
    },
  };
}

/** An on/off filter such as "Verified only". Written as `true` or `false`. */
export function booleanParam(
  options: BaseOptions & { default?: boolean } = {}
): ListParamDefinition<boolean> {
  const defaultValue = options.default ?? false;
  return {
    resolve: (name) => {
      const key = options.key ?? name;
      return createParam({
        name,
        keys: [key],
        role: options.role ?? 'filter',
        defaultValue,
        parse: (params) => {
          const raw = firstValue(params, key)?.trim().toLowerCase();
          if (raw === 'true' || raw === '1') return true;
          if (raw === 'false' || raw === '0') return false;
          return defaultValue;
        },
        write: (value, params) => params.set(key, String(value)),
      });
    },
  };
}

type EnumValue = string | number;

function matchOption<T extends EnumValue>(
  options: readonly T[],
  raw: string | undefined
): T | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return options.find((option) => String(option) === trimmed);
}

/**
 * One value from a fixed set, such as a ruleset or a report status. Values
 * outside the set are ignored. Without a `default` the param is optional.
 */
export function enumParam<T extends EnumValue>(
  options: readonly T[],
  config: BaseOptions & { default: T }
): ListParamDefinition<T>;
export function enumParam<T extends EnumValue>(
  options: readonly T[],
  config?: BaseOptions & { default?: undefined }
): ListParamDefinition<T | undefined>;
export function enumParam<T extends EnumValue>(
  options: readonly T[],
  config: BaseOptions & { default?: T } = {}
): ListParamDefinition<T | undefined> {
  return {
    resolve: (name) => {
      const key = config.key ?? name;
      return createParam<T | undefined>({
        name,
        keys: [key],
        role: config.role ?? 'filter',
        defaultValue: config.default,
        parse: (params) =>
          matchOption(options, firstValue(params, key)) ?? config.default,
        write: (value, params) => {
          if (value !== undefined && options.includes(value)) {
            params.set(key, String(value));
          }
        },
      });
    },
  };
}

/**
 * Any number of values from a fixed set, written as repeated keys
 * (`status=1&status=4`). Empty means no filter. Unknown values are dropped,
 * duplicates collapse, and the order always follows `options`.
 *
 * With `allValue`, the param has a third state for a list whose default
 * depends on the visitor, such as a signed-in player's ruleset: absent reads
 * as `undefined` (the page's own default), `allValue` (`ruleset=all`) reads
 * as `[]` (every option), and values read as those values. `[]` is then
 * written as `allValue`, and `undefined` as nothing.
 */
export function arrayParam<T extends EnumValue>(
  options: readonly T[],
  config: BaseOptions & { allValue: string }
): ListParamDefinition<T[] | undefined>;
export function arrayParam<T extends EnumValue>(
  options: readonly T[],
  config?: BaseOptions & { allValue?: undefined }
): ListParamDefinition<T[]>;
export function arrayParam<T extends EnumValue>(
  options: readonly T[],
  config: BaseOptions & { allValue?: string } = {}
): ListParamDefinition<T[] | undefined> {
  const { allValue } = config;
  const canonical = (values: readonly T[]) =>
    options.filter((option) => values.includes(option));
  const listsEqual = (a: readonly T[], b: readonly T[]) => {
    const left = canonical(a);
    const right = canonical(b);
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  };

  return {
    resolve: (name) => {
      const key = config.key ?? name;
      return createParam<T[] | undefined>({
        name,
        keys: [key],
        role: config.role ?? 'filter',
        defaultValue: allValue === undefined ? [] : undefined,
        parse: (params) => {
          const raw = params.getAll(key).map((value) => value.trim());
          const values = options.filter((option) =>
            raw.includes(String(option))
          );
          if (allValue === undefined || values.length > 0) return values;
          return raw.includes(allValue) ? [] : undefined;
        },
        write: (value, params) => {
          if (value === undefined) return;
          const values = canonical(value);
          if (values.length === 0 && allValue !== undefined) {
            params.append(key, allValue);
          }
          for (const option of values) {
            params.append(key, String(option));
          }
        },
        equals: (a, b) =>
          a === undefined || b === undefined ? a === b : listsEqual(a, b),
      });
    },
  };
}

/** The flags set in `mask`, in the order of `flags`. Zero and unknown bits are dropped. */
export function maskToFlags<T extends number>(
  mask: number,
  flags: readonly T[]
): T[] {
  return flags.filter((flag) => flag !== 0 && (mask & flag) === flag);
}

/** The bitmask of `values`, ORed together. */
export function flagsToMask(values: readonly number[]): number {
  return values.reduce((mask, flag) => mask | flag, 0);
}

/**
 * Any number of flags from a bitflag enum, held in state as a list (for
 * `ChoiceFilter`) and written to the address as one bitmask
 * (`mods=24` for Hidden and Hard Rock), the way the API takes it. Empty
 * means no filter. Each of `flags` must be a single bit or a fixed
 * combination; zero, unknown bits and invalid numbers are dropped, and the
 * order always follows `flags`.
 */
export function flagsParam<T extends number>(
  flags: readonly T[],
  config: BaseOptions = {}
): ListParamDefinition<T[]> {
  const known = flags.filter((flag) => Number.isInteger(flag) && flag > 0);
  const canonical = (values: readonly T[]) =>
    maskToFlags(flagsToMask(values), known);

  return {
    resolve: (name) => {
      const key = config.key ?? name;
      return createParam<T[]>({
        name,
        keys: [key],
        role: config.role ?? 'filter',
        defaultValue: [],
        parse: (params) => {
          const mask = parseDecimal(firstValue(params, key));
          return mask !== undefined && Number.isSafeInteger(mask) && mask > 0
            ? maskToFlags(mask, known)
            : [];
        },
        write: (value, params) => {
          const mask = flagsToMask(canonical(value));
          if (mask > 0) params.set(key, String(mask));
        },
        equals: (a, b) =>
          flagsToMask(canonical(a)) === flagsToMask(canonical(b)),
      });
    },
  };
}

/** An optional number such as a report ID. Values outside the bounds are ignored. */
export function numberParam(
  options: BaseOptions & { min?: number; max?: number; integer?: boolean } = {}
): ListParamDefinition<number | undefined> {
  const isValid = (value: number) =>
    (options.min === undefined || value >= options.min) &&
    (options.max === undefined || value <= options.max) &&
    (!options.integer || Number.isInteger(value));

  return {
    resolve: (name) => {
      const key = options.key ?? name;
      return createParam<number | undefined>({
        name,
        keys: [key],
        role: options.role ?? 'filter',
        defaultValue: undefined,
        parse: (params) => {
          const value = parseDecimal(firstValue(params, key));
          return value !== undefined && isValid(value) ? value : undefined;
        },
        write: (value, params) => {
          if (value !== undefined && isValid(value)) {
            params.set(key, String(value));
          }
        },
      });
    },
  };
}

/** Either end may be open. */
export interface NumberRange {
  min?: number;
  max?: number;
}

export function rangesEqual(a: NumberRange, b: NumberRange): boolean {
  return a.min === b.min && a.max === b.max;
}

/** Drops bounds outside the domain or at its edge, and swaps reversed bounds. */
export function normalizeRange(
  range: NumberRange,
  domain: { min: number; max: number; integer?: boolean }
): NumberRange {
  const keep = (value: number | undefined) =>
    value !== undefined &&
    Number.isFinite(value) &&
    value >= domain.min &&
    value <= domain.max &&
    (!domain.integer || Number.isInteger(value))
      ? value
      : undefined;

  let min = keep(range.min);
  let max = keep(range.max);
  if (min !== undefined && max !== undefined && min > max) {
    [min, max] = [max, min];
  }
  // A bound at the edge of the domain filters nothing, the same as no bound.
  if (min === domain.min) min = undefined;
  if (max === domain.max) max = undefined;

  const result: NumberRange = {};
  if (min !== undefined) result.min = min;
  if (max !== undefined) result.max = max;
  return result;
}

/**
 * A numeric range filter over `[min, max]`, written as two keys:
 * `minSr` and `maxSr` for a param named `sr`. A bound at the domain's edge
 * means "no limit" and is not written.
 */
export function rangeParam(
  options: Omit<BaseOptions, 'key'> & {
    min: number;
    max: number;
    integer?: boolean;
    /** `[minKey, maxKey]`. Defaults to `min<Name>` and `max<Name>`. */
    keys?: readonly [string, string];
  }
): ListParamDefinition<NumberRange> {
  const domain = {
    min: options.min,
    max: options.max,
    integer: options.integer,
  };

  return {
    resolve: (name) => {
      const [minKey, maxKey] = options.keys ?? [
        `min${capitalize(name)}`,
        `max${capitalize(name)}`,
      ];
      return createParam<NumberRange>({
        name,
        keys: [minKey, maxKey],
        role: options.role ?? 'filter',
        defaultValue: {},
        parse: (params) =>
          normalizeRange(
            {
              min: parseDecimal(firstValue(params, minKey)),
              max: parseDecimal(firstValue(params, maxKey)),
            },
            domain
          ),
        write: (value, params) => {
          const range = normalizeRange(value, domain);
          if (range.min !== undefined) params.set(minKey, String(range.min));
          if (range.max !== undefined) params.set(maxKey, String(range.max));
        },
        equals: (a, b) =>
          rangesEqual(normalizeRange(a, domain), normalizeRange(b, domain)),
      });
    },
  };
}

/** Calendar days as `YYYY-MM-DD` in UTC. Either end may be open. */
export interface DayRange {
  from?: string;
  to?: string;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written as `YYYY-MM-DD`. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Drops days that are not real dates and swaps reversed ends. */
export function normalizeDayRange(range: DayRange): DayRange {
  let from = isIsoDay(range.from) ? range.from : undefined;
  let to = isIsoDay(range.to) ? range.to : undefined;
  if (from && to && from > to) [from, to] = [to, from];

  const result: DayRange = {};
  if (from) result.from = from;
  if (to) result.to = to;
  return result;
}

export function dayRangesEqual(a: DayRange, b: DayRange): boolean {
  const left = normalizeDayRange(a);
  const right = normalizeDayRange(b);
  return left.from === right.from && left.to === right.to;
}

/**
 * A range of days, written as `dateFrom=2024-07-20&dateTo=2024-08-03` for a
 * param named `date`. Both ends are inclusive.
 */
export function dayRangeParam(
  options: Omit<BaseOptions, 'key'> & {
    /** `[fromKey, toKey]`. Defaults to `<name>From` and `<name>To`. */
    keys?: readonly [string, string];
  } = {}
): ListParamDefinition<DayRange> {
  return {
    resolve: (name) => {
      const [fromKey, toKey] = options.keys ?? [`${name}From`, `${name}To`];
      return createParam<DayRange>({
        name,
        keys: [fromKey, toKey],
        role: options.role ?? 'filter',
        defaultValue: {},
        parse: (params) =>
          normalizeDayRange({
            from: firstValue(params, fromKey)?.trim(),
            to: firstValue(params, toKey)?.trim(),
          }),
        write: (value, params) => {
          const range = normalizeDayRange(value);
          if (range.from) params.set(fromKey, range.from);
          if (range.to) params.set(toKey, range.to);
        },
        equals: dayRangesEqual,
      });
    },
  };
}

/**
 * The sort, written as `sort=rating&dir=asc`. Each half is left out when it
 * matches the default. `legacyDescendingKey` also reads old links that used
 * `descending=true|false`; it is never written.
 */
export function sortParam<K extends SortKey>(
  keys: readonly K[],
  defaultSort: SortState<NoInfer<K>>,
  options: {
    key?: string;
    directionKey?: string;
    legacyDescendingKey?: string;
  } = {}
): ListParamDefinition<SortState<K>> {
  return {
    resolve: (name) => {
      const key = options.key ?? name;
      const directionKey =
        options.directionKey ?? (key === 'sort' ? 'dir' : `${key}Dir`);
      const legacyKey = options.legacyDescendingKey;

      const readDirection = (params: URLSearchParams): SortDirection => {
        const raw = firstValue(params, directionKey)?.trim().toLowerCase();
        if (isSortDirection(raw)) return raw;
        if (legacyKey) {
          const legacy = firstValue(params, legacyKey)?.trim().toLowerCase();
          if (legacy === 'true') return 'desc';
          if (legacy === 'false') return 'asc';
        }
        return defaultSort.direction;
      };

      return createParam<SortState<K>>({
        name,
        keys: legacyKey ? [key, directionKey, legacyKey] : [key, directionKey],
        role: 'sort',
        defaultValue: defaultSort,
        parse: (params) => ({
          key: matchOption(keys, firstValue(params, key)) ?? defaultSort.key,
          direction: readDirection(params),
        }),
        write: (value, params) => {
          if (value.key !== defaultSort.key && keys.includes(value.key)) {
            params.set(key, String(value.key));
          }
          if (
            value.direction !== defaultSort.direction &&
            isSortDirection(value.direction)
          ) {
            params.set(directionKey, value.direction);
          }
        },
        equals: sortStatesEqual,
      });
    },
  };
}

// --- Specs ------------------------------------------------------------------

/**
 * Resolves a page's params. Define it once at module level so the server
 * page and the client hook share it. Throws when two params claim one URL key.
 */
export function defineListParams<
  S extends Record<string, ListParamDefinition<unknown>>,
>(definitions: S): ResolvedParams<S> {
  const resolved: Record<string, ListParam<unknown>> = {};
  const owners = new Map<string, string>();

  for (const [name, definition] of Object.entries(definitions)) {
    const param = definition.resolve(name);
    for (const key of param.keys) {
      const owner = owners.get(key);
      if (owner !== undefined) {
        throw new Error(
          `List params "${owner}" and "${name}" both use the URL key "${key}".`
        );
      }
      owners.set(key, name);
    }
    resolved[name] = param;
  }

  return resolved as ResolvedParams<S>;
}

function entries<P extends ListParams>(params: P) {
  return Object.entries(params) as [keyof P & string, ListParam<unknown>][];
}

export function getDefaultListState<P extends ListParams>(
  params: P
): ListState<P> {
  const state: Record<string, unknown> = {};
  for (const [name, param] of entries(params)) {
    state[name] = param.defaultValue;
  }
  return state as ListState<P>;
}

/** Reads every param; anything missing or invalid takes its default. */
export function parseListState<P extends ListParams>(
  params: P,
  input: SearchParamsInput
): ListState<P> {
  const search = toSearchParams(input);
  const state: Record<string, unknown> = {};
  for (const [name, param] of entries(params)) {
    state[name] = param.parse(search);
  }
  return state as ListState<P>;
}

/**
 * Writes `state`, leaving out defaults. Keys in `base` that the spec does
 * not own (a hero tab, a tracking param) are kept, ahead of the list's own.
 */
export function serializeListState<P extends ListParams>(
  params: P,
  state: ListState<P>,
  base?: SearchParamsInput
): URLSearchParams {
  const owned = new Set(entries(params).flatMap(([, param]) => param.keys));
  const output = new URLSearchParams();

  for (const [key, value] of toSearchParams(base)) {
    if (!owned.has(key)) output.append(key, value);
  }
  for (const [name, param] of entries(params)) {
    param.write(state[name], output);
  }
  return output;
}

/** `pathname` plus the serialized state, with no `?` when nothing is set. */
export function listStateHref<P extends ListParams>(
  pathname: string,
  params: P,
  state: ListState<P>,
  base?: SearchParamsInput
): string {
  const query = serializeListState(params, state, base).toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function listStatesEqual<P extends ListParams>(
  params: P,
  a: ListState<P>,
  b: ListState<P>
): boolean {
  return entries(params).every(([name, param]) =>
    param.equals(a[name], b[name])
  );
}

/**
 * Applies `patch`. `undefined` resets a param to its default, so
 * `{ rank: undefined }` clears a range like `{ rank: {} }` does. When
 * anything other than the page changes, the page goes back to the first, so
 * a new filter never lands on an empty page 12.
 */
export function applyListPatch<P extends ListParams>(
  params: P,
  state: ListState<P>,
  patch: Partial<ListState<P>>
): ListState<P> {
  const next: Record<string, unknown> = { ...state };
  for (const [name, param] of entries(params)) {
    if (!(name in patch)) continue;
    const value = patch[name];
    // Ranges, arrays and sorts cannot hold `undefined`; their codecs would throw.
    next[name] = value === undefined ? param.defaultValue : value;
  }
  const changed = entries(params).some(
    ([name, param]) =>
      param.role !== 'page' &&
      name in patch &&
      !param.equals(state[name], next[name])
  );

  if (changed) {
    for (const [name, param] of entries(params)) {
      if (param.role === 'page' && !(name in patch)) {
        next[name] = param.defaultValue;
      }
    }
  }
  return next as ListState<P>;
}

/** True when a filter-role param is set, for the Filters button and empty states. */
export function isFilterActive<P extends ListParams>(
  params: P,
  state: ListState<P>,
  name: keyof P & string
): boolean {
  const param = params[name];
  return !param.equals(state[name], param.defaultValue);
}

/** How many filter-role params are set: the number on the Filters button. */
export function countActiveFilters<P extends ListParams>(
  params: P,
  state: ListState<P>
): number {
  return entries(params).filter(
    ([name, param]) =>
      param.role === 'filter' && !param.equals(state[name], param.defaultValue)
  ).length;
}

/**
 * "Clear all": resets every filter-role param and nothing else, so search,
 * sort, ruleset, scope and tab survive. The page resets too.
 */
export function clearListFilters<P extends ListParams>(
  params: P,
  state: ListState<P>
): ListState<P> {
  const patch: Record<string, unknown> = {};
  for (const [name, param] of entries(params)) {
    if (param.role === 'filter') patch[name] = param.defaultValue;
  }
  return applyListPatch(params, state, patch as Partial<ListState<P>>);
}
