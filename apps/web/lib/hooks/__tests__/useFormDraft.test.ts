import { describe, expect, it } from 'bun:test';

import {
  type DraftStorage,
  isEmptyDraft,
  readDraft,
  restorableDraft,
  writeDraft,
} from '@/lib/hooks/useFormDraft';

const EMPTY = {
  name: '',
  ruleset: undefined as number | undefined,
  isLazer: false,
  ids: [] as string[],
};

function memoryStorage(): DraftStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

describe('restorableDraft', () => {
  it('restores the fields the form has', () => {
    const stored = { name: 'OWC', ruleset: 0, isLazer: true, ids: ['1', '2'] };
    expect(restorableDraft(stored, EMPTY)).toEqual(stored);
  });

  it('drops fields the form no longer has or has retyped', () => {
    expect(
      restorableDraft(
        { name: 7, removed: 'x', isLazer: 'yes', ids: 'a', ruleset: null },
        EMPTY
      )
    ).toEqual({});
  });

  it('restores nothing from a stored value that is not a form', () => {
    for (const stored of [null, 'draft', 3, ['name']]) {
      expect(restorableDraft(stored, EMPTY)).toEqual({});
    }
  });
});

describe('isEmptyDraft', () => {
  it('is empty only when every field holds its empty value', () => {
    expect(isEmptyDraft({ ...EMPTY }, EMPTY)).toBe(true);
    expect(isEmptyDraft({ ...EMPTY, ids: ['1'] }, EMPTY)).toBe(false);
    expect(isEmptyDraft({ ...EMPTY, ruleset: 0 }, EMPTY)).toBe(false);
  });
});

describe('writeDraft and readDraft', () => {
  it('keeps a draft until the form is empty again', () => {
    const storage = memoryStorage();

    writeDraft(storage, 'form', { ...EMPTY, name: 'OWC' }, EMPTY);
    expect(readDraft(storage, 'form')).toEqual({
      name: 'OWC',
      isLazer: false,
      ids: [],
    });

    writeDraft(storage, 'form', { ...EMPTY }, EMPTY);
    expect(storage.items.size).toBe(0);
    expect(readDraft(storage, 'form')).toBeNull();
  });

  it('reads an unreadable draft as none', () => {
    const storage = memoryStorage();
    storage.items.set('otr:form-draft:form', '{not json');
    expect(readDraft(storage, 'form')).toBeNull();
  });

  it('works on without storage that throws', () => {
    const blocked: DraftStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() =>
      writeDraft(blocked, 'form', { ...EMPTY, name: 'OWC' }, EMPTY)
    ).not.toThrow();
    expect(readDraft(blocked, 'form')).toBeNull();
  });
});
