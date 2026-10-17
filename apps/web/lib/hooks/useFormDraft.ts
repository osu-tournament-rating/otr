'use client';

import { useEffect } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

const KEY_PREFIX = 'otr:form-draft:';

type Values = Record<string, unknown>;

/** The subset of the Storage API a draft needs. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isPrimitive = (value: unknown) =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

/** Whether a stored value can fill a field whose empty value is `empty`. */
function fitsField(value: unknown, empty: unknown): boolean {
  if (empty === undefined || empty === null) {
    return isPrimitive(value);
  }
  if (Array.isArray(empty)) {
    return Array.isArray(value) && value.every(isPrimitive);
  }
  return typeof value === typeof empty;
}

/**
 * The fields of a stored draft that still fit the form. A draft saved by an
 * earlier release can name a field the form has since dropped or retyped;
 * those fields keep their empty value.
 */
export function restorableDraft<T extends Values>(
  stored: unknown,
  empty: T
): Partial<T> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }

  const draft: Partial<T> = {};
  for (const [field, value] of Object.entries(stored)) {
    if (field in empty && fitsField(value, empty[field])) {
      draft[field as keyof T] = value as T[keyof T];
    }
  }
  return draft;
}

/** Whether every field holds its empty value. */
export function isEmptyDraft(values: Values, empty: Values): boolean {
  return Object.keys(empty).every(
    (field) => JSON.stringify(values[field]) === JSON.stringify(empty[field])
  );
}

export function readDraft(storage: DraftStorage, name: string): unknown {
  try {
    const stored = storage.getItem(KEY_PREFIX + name);
    return stored === null ? null : JSON.parse(stored);
  } catch {
    return null;
  }
}

/** Saves the values, or forgets the draft once the form is empty again. */
export function writeDraft(
  storage: DraftStorage,
  name: string,
  values: Values,
  empty: Values
) {
  try {
    if (isEmptyDraft(values, empty)) {
      storage.removeItem(KEY_PREFIX + name);
    } else {
      storage.setItem(KEY_PREFIX + name, JSON.stringify(values));
    }
  } catch {
    // Storage can be full or blocked; the form works without a draft.
  }
}

function sessionDraftStorage(): DraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps a form's input in the tab's session storage, so a reload, such as the
 * one that picks up a new release, gives it back. The draft is forgotten when
 * the form returns to `empty`, such as when a successful submit resets it.
 *
 * `empty` must be the form's default values and stable across renders.
 */
export function useFormDraft<
  T extends FieldValues,
  TContext,
  TTransformed extends FieldValues,
>(
  form: UseFormReturn<T, TContext, TTransformed>,
  name: string,
  empty: Partial<T>
) {
  useEffect(() => {
    const storage = sessionDraftStorage();
    if (!storage) {
      return;
    }

    const draft = restorableDraft(readDraft(storage, name), empty as Values);
    const subscription = form.watch((values) =>
      writeDraft(storage, name, values as Values, empty as Values)
    );

    // A Radix Select mirrors its value into a hidden native select, whose
    // options only register in the renders that follow mount. A value set
    // before then has no option to match, and the Select reports it as ''.
    const restore = window.setTimeout(() => {
      if (Object.keys(draft).length > 0) {
        form.reset({ ...empty, ...draft } as T, { keepDefaultValues: true });
      }
    });

    return () => {
      window.clearTimeout(restore);
      subscription.unsubscribe();
    };
  }, [form, name, empty]);
}
