import { describe, expect, it } from 'bun:test';
import { Ruleset, VerificationStatus } from '@otr/core/osu';

import { RATED_RULESETS } from '@/lib/kit/format/ruleset';

import {
  applyListPatch,
  arrayParam,
  booleanParam,
  clearListFilters,
  countActiveFilters,
  dayRangeParam,
  defineListParams,
  enumParam,
  flagsParam,
  flagsToMask,
  getDefaultListState,
  isIsoDay,
  listStateHref,
  listStatesEqual,
  maskToFlags,
  normalizeDayRange,
  normalizeRange,
  numberParam,
  pageParam,
  parseListState,
  rangeParam,
  searchParam,
  serializeListState,
  sortParam,
  toSearchParams,
} from '../params';

const STATUSES = [
  VerificationStatus.None,
  VerificationStatus.PreRejected,
  VerificationStatus.PreVerified,
  VerificationStatus.Rejected,
  VerificationStatus.Verified,
] as const;

const SORT_KEYS = ['endTime', 'startTime', 'name'] as const;

const params = defineListParams({
  q: searchParam(),
  page: pageParam(),
  sort: sortParam(SORT_KEYS, { key: 'endTime', direction: 'desc' }),
  ruleset: arrayParam(RATED_RULESETS, { role: 'scope' }),
  status: arrayParam(STATUSES),
  verified: booleanParam(),
  rank: rangeParam({ min: 1, max: 1_000_000, integer: true }),
  sr: rangeParam({ min: 0, max: 15 }),
  date: dayRangeParam(),
  report: numberParam({ min: 1, integer: true, role: 'scope' }),
});

const defaults = getDefaultListState(params);

describe('parseListState', () => {
  it('reads defaults from an empty address', () => {
    expect(parseListState(params, '')).toEqual({
      q: '',
      page: 1,
      sort: { key: 'endTime', direction: 'desc' },
      ruleset: [],
      status: [],
      verified: false,
      rank: {},
      sr: {},
      date: {},
      report: undefined,
    });
  });

  it('reads every kind of value', () => {
    const state = parseListState(
      params,
      '?q=corsace&page=3&sort=name&dir=asc&ruleset=1&ruleset=0&status=4' +
        '&verified=true&minRank=1000&maxRank=50000&minSr=5.5' +
        '&dateFrom=2024-07-20&dateTo=2024-08-03&report=12'
    );

    expect(state).toEqual({
      q: 'corsace',
      page: 3,
      sort: { key: 'name', direction: 'asc' },
      ruleset: [Ruleset.Osu, Ruleset.Taiko],
      status: [VerificationStatus.Verified],
      verified: true,
      rank: { min: 1000, max: 50000 },
      sr: { min: 5.5 },
      date: { from: '2024-07-20', to: '2024-08-03' },
      report: 12,
    });
  });

  it('accepts a Next.js searchParams record, with repeated keys as arrays', () => {
    const state = parseListState(params, {
      q: 'nwc',
      ruleset: ['4', '5'],
      status: undefined,
    });
    expect(state.q).toBe('nwc');
    expect(state.ruleset).toEqual([Ruleset.Mania4k, Ruleset.Mania7k]);
    expect(state.status).toEqual([]);
  });

  it('accepts URLSearchParams', () => {
    const state = parseListState(params, new URLSearchParams('page=2'));
    expect(state.page).toBe(2);
  });

  it('ignores invalid values instead of throwing', () => {
    const state = parseListState(
      params,
      '?page=0&sort=rating&dir=up&ruleset=3&ruleset=9&ruleset=osu&status=-1' +
        '&verified=maybe&minRank=1.5&maxRank=abc&minSr=1e1&maxSr=99' +
        '&dateFrom=2024-02-30&dateTo=yesterday&report=0'
    );
    expect(state).toEqual(defaults);
  });

  it('ignores numbers written in forms Number() would accept', () => {
    for (const raw of ['0x10', '1e3', ' ', '', 'Infinity', '5.']) {
      expect(parseListState(params, { minSr: raw }).sr).toEqual({});
    }
  });

  it('rejects pages that are not whole numbers', () => {
    expect(parseListState(params, '?page=2.5').page).toBe(1);
    expect(parseListState(params, '?page=-2').page).toBe(1);
  });

  it('reads the first of a repeated single-value key', () => {
    expect(parseListState(params, '?page=4&page=7').page).toBe(4);
  });

  it('treats a search term below the minimum length as no search', () => {
    expect(parseListState(params, '?q=a').q).toBe('');
    expect(parseListState(params, '?q=%20%20ab%20').q).toBe('ab');
    expect(parseListState(params, `?q=${'x'.repeat(201)}`).q).toBe('');
  });

  it('dedupes arrays and keeps them in option order', () => {
    const state = parseListState(params, '?ruleset=5&ruleset=0&ruleset=5');
    expect(state.ruleset).toEqual([Ruleset.Osu, Ruleset.Mania7k]);
  });

  it('leaves ManiaOther out of a rated-ruleset filter', () => {
    expect(parseListState(params, '?ruleset=3').ruleset).toEqual([]);
  });

  it('keeps a direction with the default sort key', () => {
    expect(parseListState(params, '?dir=asc').sort).toEqual({
      key: 'endTime',
      direction: 'asc',
    });
  });
});

describe('ranges', () => {
  const domain = { min: 0, max: 15 };

  it('swaps reversed bounds', () => {
    expect(normalizeRange({ min: 7, max: 5 }, domain)).toEqual({
      min: 5,
      max: 7,
    });
    expect(parseListState(params, '?minSr=7&maxSr=5').sr).toEqual({
      min: 5,
      max: 7,
    });
  });

  it('treats a bound at the edge of the domain as open', () => {
    expect(normalizeRange({ min: 0, max: 15 }, domain)).toEqual({});
    expect(parseListState(params, '?minRank=1&maxRank=1000000').rank).toEqual(
      {}
    );
  });

  it('drops a bound outside the domain and keeps the other', () => {
    expect(normalizeRange({ min: -1, max: 9 }, domain)).toEqual({ max: 9 });
    expect(normalizeRange({ min: 2, max: 16 }, domain)).toEqual({ min: 2 });
  });

  it('drops fractions from an integer domain', () => {
    expect(
      normalizeRange({ min: 10.5 }, { min: 1, max: 100, integer: true })
    ).toEqual({});
  });

  it('allows equal bounds', () => {
    expect(normalizeRange({ min: 5, max: 5 }, domain)).toEqual({
      min: 5,
      max: 5,
    });
  });
});

describe('day ranges', () => {
  it('checks for real calendar days', () => {
    expect(isIsoDay('2024-02-29')).toBe(true);
    expect(isIsoDay('2023-02-29')).toBe(false);
    expect(isIsoDay('2024-13-01')).toBe(false);
    expect(isIsoDay('2024-7-20')).toBe(false);
    expect(isIsoDay('2024-07-20T00:00:00Z')).toBe(false);
    expect(isIsoDay(undefined)).toBe(false);
  });

  it('swaps reversed ends and drops bad ones', () => {
    expect(normalizeDayRange({ from: '2024-08-03', to: '2024-07-20' })).toEqual(
      { from: '2024-07-20', to: '2024-08-03' }
    );
    expect(normalizeDayRange({ from: 'soon', to: '2024-07-20' })).toEqual({
      to: '2024-07-20',
    });
  });
});

describe('serializeListState', () => {
  it('writes nothing for the default state', () => {
    expect(serializeListState(params, defaults).toString()).toBe('');
    expect(listStateHref('/tournaments', params, defaults)).toBe(
      '/tournaments'
    );
  });

  it('writes only what differs from the defaults, in spec order', () => {
    const state = {
      ...defaults,
      page: 2,
      sort: { key: 'name' as const, direction: 'desc' as const },
      ruleset: [Ruleset.Taiko],
      status: [VerificationStatus.Verified, VerificationStatus.None],
      sr: { max: 7.5 },
      date: { from: '2024-07-20' },
    };
    expect(serializeListState(params, state).toString()).toBe(
      'page=2&sort=name&ruleset=1&status=0&status=4&maxSr=7.5&dateFrom=2024-07-20'
    );
  });

  it('writes the direction alone when only the direction changed', () => {
    const state = {
      ...defaults,
      sort: { key: 'endTime' as const, direction: 'asc' as const },
    };
    expect(serializeListState(params, state).toString()).toBe('dir=asc');
  });

  it('round-trips through the address', () => {
    const state = {
      ...defaults,
      q: 'corsace open',
      page: 4,
      sort: { key: 'startTime' as const, direction: 'asc' as const },
      ruleset: [Ruleset.Osu, Ruleset.Catch],
      status: [VerificationStatus.PreVerified],
      verified: true,
      rank: { min: 500, max: 10_000 },
      sr: { min: 4.25 },
      date: { from: '2023-12-28', to: '2024-01-04' },
      report: 42,
    };
    const href = listStateHref('/tournaments', params, state);
    expect(parseListState(params, href.split('?')[1])).toEqual(state);
  });

  it('normalises before writing: short terms, edges and reversed ranges', () => {
    const state = {
      ...defaults,
      q: ' a ',
      rank: { min: 1 },
      sr: { min: 9, max: 3 },
    };
    expect(serializeListState(params, state).toString()).toBe(
      'minSr=3&maxSr=9'
    );
  });

  it('keeps params the spec does not own, ahead of its own', () => {
    const base = '?tab=matches&page=9&utm_source=discord';
    const state = { ...defaults, page: 2 };
    expect(serializeListState(params, state, base).toString()).toBe(
      'tab=matches&utm_source=discord&page=2'
    );
  });

  it('drops owned keys from the base, even ones it does not write', () => {
    const state = { ...defaults };
    expect(
      serializeListState(params, state, '?minSr=5&q=x&tab=stats').toString()
    ).toBe('tab=stats');
  });
});

describe('applyListPatch', () => {
  const onPage3 = { ...defaults, page: 3 };

  it('returns to the first page when something else changes', () => {
    const next = applyListPatch(params, onPage3, { verified: true });
    expect(next.page).toBe(1);
    expect(next.verified).toBe(true);
  });

  it('keeps the page when only the page changes', () => {
    expect(applyListPatch(params, onPage3, { page: 5 }).page).toBe(5);
  });

  it('keeps the page when the patch changes nothing', () => {
    expect(applyListPatch(params, onPage3, { verified: false }).page).toBe(3);
    expect(applyListPatch(params, onPage3, { q: 'a' }).page).toBe(3);
  });

  it('keeps an explicit page alongside other changes', () => {
    const next = applyListPatch(params, onPage3, { q: 'nwc', page: 2 });
    expect(next.page).toBe(2);
  });

  it('reads undefined as the default instead of throwing', () => {
    const busy = {
      ...onPage3,
      sort: { key: 'name' as const, direction: 'asc' as const },
      status: [VerificationStatus.Verified],
      rank: { min: 1000 },
      date: { from: '2024-07-20' },
    };
    const next = applyListPatch(params, busy, {
      sort: undefined,
      status: undefined,
      rank: undefined,
      date: undefined,
    });
    expect(next.sort).toEqual(defaults.sort);
    expect(next.status).toEqual([]);
    expect(next.rank).toEqual({});
    expect(next.date).toEqual({});
    expect(next.page).toBe(1);
    expect(listStateHref('/t', params, next)).toBe('/t');
  });
});

describe('filters', () => {
  const busy = {
    ...defaults,
    q: 'corsace',
    page: 3,
    sort: { key: 'name' as const, direction: 'asc' as const },
    ruleset: [Ruleset.Taiko],
    report: 12,
    status: [VerificationStatus.Verified],
    verified: true,
    rank: { min: 1000 },
    date: { to: '2024-08-03' },
  };

  it('counts filter-role params only', () => {
    expect(countActiveFilters(params, defaults)).toBe(0);
    expect(countActiveFilters(params, busy)).toBe(4);
  });

  it('clears filters, never search, sort, scope or the tab', () => {
    const cleared = clearListFilters(params, busy);
    expect(cleared).toEqual({
      ...defaults,
      q: 'corsace',
      sort: { key: 'name', direction: 'asc' },
      ruleset: [Ruleset.Taiko],
      report: 12,
    });
    expect(listStateHref('/t', params, cleared, '?tab=stats')).toBe(
      '/t?tab=stats&q=corsace&sort=name&dir=asc&ruleset=1&report=12'
    );
  });

  it('compares states by value', () => {
    expect(
      listStatesEqual(params, busy, {
        ...busy,
        status: [VerificationStatus.Verified],
        rank: { min: 1000 },
      })
    ).toBe(true);
    expect(listStatesEqual(params, busy, defaults)).toBe(false);
  });
});

describe('param builders', () => {
  it('derives keys from the param name, and accepts overrides', () => {
    const spec = defineListParams({
      gameCount: rangeParam({ min: 0, max: 600 }),
      dates: dayRangeParam({ keys: ['dateMin', 'dateMax'] }),
      matchSort: sortParam(['date', 'name'], { key: 'date', direction: 'asc' }),
      search: searchParam({ key: 'searchQuery' }),
    });
    expect(spec.gameCount.keys).toEqual(['minGameCount', 'maxGameCount']);
    expect(spec.dates.keys).toEqual(['dateMin', 'dateMax']);
    expect(spec.matchSort.keys).toEqual(['matchSort', 'matchSortDir']);
    expect(spec.search.keys).toEqual(['searchQuery']);
  });

  it('refuses two params sharing a URL key', () => {
    expect(() =>
      defineListParams({
        sr: rangeParam({ min: 0, max: 15 }),
        minSr: numberParam(),
      })
    ).toThrow('both use the URL key "minSr"');
  });

  it('reads an enum with and without a default', () => {
    const spec = defineListParams({
      ruleset: enumParam(RATED_RULESETS, {
        default: Ruleset.Osu,
        role: 'scope',
      }),
      status: enumParam(['pending', 'confirmed', 'dismissed'] as const),
    });
    expect(parseListState(spec, '?ruleset=2&status=dismissed')).toEqual({
      ruleset: Ruleset.Catch,
      status: 'dismissed',
    });
    expect(parseListState(spec, '?ruleset=3&status=Dismissed')).toEqual({
      ruleset: Ruleset.Osu,
      status: undefined,
    });
    expect(
      serializeListState(spec, {
        ruleset: Ruleset.Osu,
        status: 'pending',
      }).toString()
    ).toBe('status=pending');
  });

  it('writes a boolean that defaults to true only when false', () => {
    const spec = defineListParams({ grouped: booleanParam({ default: true }) });
    expect(serializeListState(spec, { grouped: true }).toString()).toBe('');
    expect(serializeListState(spec, { grouped: false }).toString()).toBe(
      'grouped=false'
    );
    expect(parseListState(spec, '?grouped=0').grouped).toBe(false);
  });

  it('reads old descending=true|false links and drops them on write', () => {
    const spec = defineListParams({
      sort: sortParam(
        ['gameCount', 'sr'],
        {
          key: 'gameCount',
          direction: 'desc',
        },
        { legacyDescendingKey: 'descending' }
      ),
    });
    const old = parseListState(spec, '?sort=sr&descending=false');
    expect(old.sort).toEqual({ key: 'sr', direction: 'asc' });
    expect(serializeListState(spec, old, '?descending=false').toString()).toBe(
      'sort=sr&dir=asc'
    );
    // `dir` wins when both are present.
    expect(parseListState(spec, '?dir=desc&descending=false').sort).toEqual({
      key: 'gameCount',
      direction: 'desc',
    });
  });

  it('supports numeric sort keys, such as a sort enum', () => {
    const spec = defineListParams({
      sort: sortParam([0, 1, 2], { key: 0, direction: 'desc' }),
    });
    expect(parseListState(spec, '?sort=2').sort).toEqual({
      key: 2,
      direction: 'desc',
    });
    expect(parseListState(spec, '?sort=3').sort.key).toBe(0);
  });
});

describe('arrayParam with allValue', () => {
  const spec = defineListParams({
    ruleset: arrayParam(RATED_RULESETS, { role: 'scope', allValue: 'all' }),
  });

  it('reads absent as undefined, all as every option, and values as given', () => {
    expect(parseListState(spec, '').ruleset).toBeUndefined();
    expect(parseListState(spec, '?ruleset=all').ruleset).toEqual([]);
    expect(parseListState(spec, '?ruleset=4&ruleset=1').ruleset).toEqual([
      Ruleset.Taiko,
      Ruleset.Mania4k,
    ]);
  });

  it('lets values win over all, and reads only unknown values as absent', () => {
    expect(parseListState(spec, '?ruleset=all&ruleset=2').ruleset).toEqual([
      Ruleset.Catch,
    ]);
    expect(parseListState(spec, '?ruleset=3').ruleset).toBeUndefined();
    expect(parseListState(spec, '?ruleset=All').ruleset).toBeUndefined();
  });

  it('writes all for an empty list and nothing for undefined', () => {
    expect(serializeListState(spec, { ruleset: undefined }).toString()).toBe(
      ''
    );
    expect(serializeListState(spec, { ruleset: [] }).toString()).toBe(
      'ruleset=all'
    );
    expect(
      serializeListState(spec, {
        ruleset: [Ruleset.Mania4k, Ruleset.Osu],
      }).toString()
    ).toBe('ruleset=0&ruleset=4');
  });

  it('tells undefined apart from every option', () => {
    expect(spec.ruleset.equals(undefined, undefined)).toBe(true);
    expect(spec.ruleset.equals(undefined, [])).toBe(false);
    expect(spec.ruleset.equals([], [])).toBe(true);
    expect(spec.ruleset.equals([Ruleset.Osu, Ruleset.Taiko], [1, 0])).toBe(
      true
    );
  });

  it('resets to undefined through a patch, and survives Clear all', () => {
    const state = parseListState(spec, '?ruleset=1');
    expect(
      applyListPatch(spec, state, { ruleset: undefined }).ruleset
    ).toBeUndefined();
    expect(clearListFilters(spec, state).ruleset).toEqual([Ruleset.Taiko]);
    expect(countActiveFilters(spec, state)).toBe(0);
  });

  it('keeps the two-state behaviour without allValue', () => {
    expect(parseListState(params, '').ruleset).toEqual([]);
    expect(parseListState(params, '?ruleset=all').ruleset).toEqual([]);
    expect(
      serializeListState(params, { ...defaults, ruleset: [] }).toString()
    ).toBe('');
  });
});

describe('flagsParam', () => {
  // Mods as bitflags: NF 1, EZ 2, HD 8, HR 16, DT 64, NC 512 (with DT, 576).
  const MODS = [1, 2, 8, 16, 64, 576] as const;
  const spec = defineListParams({ mods: flagsParam(MODS) });

  it('reads a bitmask from the address as a list of flags', () => {
    expect(parseListState(spec, '?mods=24').mods).toEqual([8, 16]);
    expect(parseListState(spec, '?mods=1').mods).toEqual([1]);
    // NC carries DT's bit, so both read as set.
    expect(parseListState(spec, '?mods=576').mods).toEqual([64, 576]);
  });

  it('drops unknown bits, zero and anything that is not a whole number', () => {
    expect(parseListState(spec, '?mods=28').mods).toEqual([8, 16]);
    expect(parseListState(spec, '?mods=0').mods).toEqual([]);
    expect(parseListState(spec, '?mods=-8').mods).toEqual([]);
    expect(parseListState(spec, '?mods=8.5').mods).toEqual([]);
    expect(parseListState(spec, '?mods=hd').mods).toEqual([]);
    expect(parseListState(spec, '').mods).toEqual([]);
  });

  it('writes one bitmask, and nothing when empty', () => {
    expect(serializeListState(spec, { mods: [16, 8] }).toString()).toBe(
      'mods=24'
    );
    expect(serializeListState(spec, { mods: [] }).toString()).toBe('');
    expect(listStateHref('/beatmaps', spec, { mods: [64] })).toBe(
      '/beatmaps?mods=64'
    );
  });

  it('compares by the flags set, not their order', () => {
    expect(spec.mods.equals([8, 16], [16, 8])).toBe(true);
    expect(spec.mods.equals([8], [16])).toBe(false);
  });

  it('is a filter: counted, and reset by Clear all', () => {
    const state = parseListState(spec, '?mods=24');
    expect(countActiveFilters(spec, state)).toBe(1);
    expect(clearListFilters(spec, state).mods).toEqual([]);
  });

  it('converts between masks and flags', () => {
    expect(flagsToMask([8, 16])).toBe(24);
    expect(flagsToMask([])).toBe(0);
    expect(maskToFlags(24, MODS)).toEqual([8, 16]);
    expect(maskToFlags(0, [0, 1])).toEqual([]);
  });
});

describe('toSearchParams', () => {
  it('copies URLSearchParams instead of sharing them', () => {
    const source = new URLSearchParams('a=1');
    const copy = toSearchParams(source);
    copy.set('a', '2');
    expect(source.get('a')).toBe('1');
  });

  it('treats null and undefined as empty', () => {
    expect(toSearchParams(null).toString()).toBe('');
    expect(toSearchParams(undefined).toString()).toBe('');
  });
});
