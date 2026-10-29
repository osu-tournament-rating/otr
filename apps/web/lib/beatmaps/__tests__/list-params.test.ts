import { describe, expect, test } from 'bun:test';

import { Ruleset } from '@otr/core/osu';

import {
  BEATMAP_LIST_PAGE_SIZE,
  BEATMAP_LIST_PARAMS,
  beatmapListHref,
  clearedBeatmapListHref,
  toBeatmapListRequest,
} from '@/lib/beatmaps/list-params';
import { parseListState } from '@/lib/kit/lists/params';

const parse = (query: string) => parseListState(BEATMAP_LIST_PARAMS, query);

describe('BEATMAP_LIST_PARAMS', () => {
  test('a bare address is the default list', () => {
    const state = parse('');

    expect(state.q).toBe('');
    expect(state.page).toBe(1);
    expect(state.sort).toEqual({ key: 'gameCount', direction: 'desc' });
    expect(state.ruleset).toBeUndefined();
    expect(beatmapListHref(state)).toBe('/beatmaps');
  });

  // A bare address shows the visitor's browsing ruleset, so every ruleset
  // needs a value of its own.
  test('tells no ruleset apart from every ruleset', () => {
    expect(parse('ruleset=all').ruleset).toEqual([]);
    expect(beatmapListHref({ ...parse(''), ruleset: [] })).toBe(
      '/beatmaps?ruleset=all'
    );
    expect(beatmapListHref(parse('ruleset=all&q=medley'))).toBe(
      '/beatmaps?q=medley&ruleset=all'
    );
  });

  test('reads the links the list wrote before', () => {
    const state = parse(
      'q=medley&ruleset=1&minSr=5&maxSr=7&minGameCount=10&sort=sr&descending=false&page=3'
    );

    expect(state.q).toBe('medley');
    expect(state.ruleset).toEqual([Ruleset.Taiko]);
    expect(state.sr).toEqual({ min: 5, max: 7 });
    expect(state.games).toEqual({ min: 10 });
    expect(state.sort).toEqual({ key: 'sr', direction: 'asc' });
    expect(state.page).toBe(3);
  });

  test('takes several rulesets and keeps them in chip order', () => {
    const state = parse('ruleset=5&ruleset=0&ruleset=3');

    expect(state.ruleset).toEqual([Ruleset.Osu, Ruleset.Mania7k]);
    expect(beatmapListHref(state)).toBe('/beatmaps?ruleset=0&ruleset=5');
  });

  test('ignores a search below two characters', () => {
    expect(parse('q=a').q).toBe('');
    expect(parse('q=+ab+').q).toBe('ab');
  });

  test('writes the sort as sort and dir, never descending', () => {
    const href = beatmapListHref({
      ...parse('descending=false'),
      sort: { key: 'bpm', direction: 'asc' },
    });

    expect(href).toBe('/beatmaps?sort=bpm&dir=asc');
  });

  test('a page override keeps every other param', () => {
    const state = parse('q=medley&sort=sr');

    expect(beatmapListHref(state, 4)).toBe('/beatmaps?q=medley&page=4&sort=sr');
  });
});

describe('clearedBeatmapListHref', () => {
  test('drops the filters but keeps search, sort and rulesets', () => {
    const state = parse('q=medley&ruleset=1&minSr=5&maxBpm=200&sort=sr&page=2');

    expect(clearedBeatmapListHref(state)).toBe(
      '/beatmaps?q=medley&sort=sr&ruleset=1'
    );
  });
});

describe('toBeatmapListRequest', () => {
  test('maps the state onto the procedure input', () => {
    const request = toBeatmapListRequest(
      parse(
        'q=medley&ruleset=0&ruleset=4&minSr=5&maxLength=120&maxTournamentCount=20&sort=bpm&dir=asc&page=2'
      ),
      [Ruleset.Catch]
    );

    expect(request).toMatchObject({
      page: 2,
      pageSize: BEATMAP_LIST_PAGE_SIZE,
      searchQuery: 'medley',
      rulesets: [Ruleset.Osu, Ruleset.Mania4k],
      minSr: 5,
      maxLength: 120,
      maxTournamentCount: 20,
      sort: 'bpm',
      descending: false,
    });
    expect(request.maxSr).toBeUndefined();
    expect(request.ruleset).toBeUndefined();
  });

  test('sends no rulesets or search for the default list', () => {
    const request = toBeatmapListRequest(parse(''), []);

    expect(request.rulesets).toBeUndefined();
    expect(request.searchQuery).toBeUndefined();
    expect(request).toMatchObject({ sort: 'gameCount', descending: true });
  });

  test('fills an address without a ruleset with the visitor’s', () => {
    expect(toBeatmapListRequest(parse(''), [Ruleset.Taiko]).rulesets).toEqual([
      Ruleset.Taiko,
    ]);
    expect(
      toBeatmapListRequest(parse('ruleset=all'), [Ruleset.Taiko]).rulesets
    ).toBeUndefined();
  });
});
