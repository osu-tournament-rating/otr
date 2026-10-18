import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_SORT_DIRECTION,
  flipSortDirection,
  fromDescending,
  getAriaSort,
  isSortDirection,
  sortStatesEqual,
  toDescending,
  toggleSort,
} from '../sort';

describe('toggleSort', () => {
  it('flips the direction when the same key is chosen again', () => {
    expect(toggleSort({ key: 'rating', direction: 'desc' }, 'rating')).toEqual({
      key: 'rating',
      direction: 'asc',
    });
    expect(toggleSort({ key: 'rating', direction: 'asc' }, 'rating')).toEqual({
      key: 'rating',
      direction: 'desc',
    });
  });

  it("starts a new key in that key's own direction", () => {
    expect(
      toggleSort({ key: 'rating', direction: 'asc' }, 'name', 'asc')
    ).toEqual({ key: 'name', direction: 'asc' });
    expect(toggleSort({ key: 'name', direction: 'asc' }, 'rating')).toEqual({
      key: 'rating',
      direction: DEFAULT_SORT_DIRECTION,
    });
  });

  it('works with numeric keys, such as a sort enum', () => {
    expect(toggleSort({ key: 0, direction: 'desc' }, 2)).toEqual({
      key: 2,
      direction: 'desc',
    });
  });
});

describe('sort helpers', () => {
  it('flips directions', () => {
    expect(flipSortDirection('asc')).toBe('desc');
    expect(flipSortDirection('desc')).toBe('asc');
  });

  it('recognises directions', () => {
    expect(isSortDirection('asc')).toBe(true);
    expect(isSortDirection('ASC')).toBe(false);
    expect(isSortDirection(undefined)).toBe(false);
  });

  it('compares states', () => {
    expect(
      sortStatesEqual(
        { key: 'sr', direction: 'asc' },
        { key: 'sr', direction: 'asc' }
      )
    ).toBe(true);
    expect(
      sortStatesEqual(
        { key: 'sr', direction: 'asc' },
        { key: 'sr', direction: 'desc' }
      )
    ).toBe(false);
  });

  it('converts to and from the API descending flag', () => {
    expect(fromDescending('sr', true)).toEqual({
      key: 'sr',
      direction: 'desc',
    });
    expect(fromDescending('sr', false)).toEqual({
      key: 'sr',
      direction: 'asc',
    });
    expect(toDescending({ key: 'sr', direction: 'desc' })).toEqual({
      sort: 'sr',
      descending: true,
    });
  });

  it('gives aria-sort for a column header', () => {
    const sort = { key: 'rating', direction: 'asc' } as const;
    expect(getAriaSort<string>(sort, 'rating')).toBe('ascending');
    expect(getAriaSort<string>({ ...sort, direction: 'desc' }, 'rating')).toBe(
      'descending'
    );
    expect(getAriaSort<string>(sort, 'name')).toBe('none');
  });
});
