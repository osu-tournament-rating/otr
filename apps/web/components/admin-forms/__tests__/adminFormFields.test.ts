import { describe, expect, it } from 'bun:test';

import { editedValues } from '@/components/admin-forms/adminFormFields';

describe('editedValues', () => {
  it('keeps only the fields that differ from the loaded values', () => {
    const loaded = {
      name: 'Old',
      status: 4,
      reason: null as number | null,
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-02T00:00:00Z'),
    };

    expect(
      editedValues(
        {
          name: 'New',
          status: 4,
          reason: 0,
          // A copy of the loaded date is not an edit.
          startTime: new Date('2026-01-01T00:00:00Z'),
          endTime: new Date('2026-01-03T00:00:00Z'),
        },
        loaded
      )
    ).toEqual({
      name: 'New',
      reason: 0,
      endTime: new Date('2026-01-03T00:00:00Z'),
    });
  });
});
