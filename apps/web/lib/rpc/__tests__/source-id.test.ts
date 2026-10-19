import { describe, expect, it } from 'bun:test';

import { sourceId } from '../source-id';

const SECRET = 'test-secret';
const MORNING = new Date('2026-10-19T01:00:00Z');
const EVENING = new Date('2026-10-19T23:59:00Z');
const NEXT_DAY = new Date('2026-10-20T00:01:00Z');

describe('sourceId', () => {
  it('gives one IP the same ID all UTC day', () => {
    expect(sourceId('203.0.113.7', MORNING, SECRET)).toBe(
      sourceId('203.0.113.7', EVENING, SECRET)
    );
  });

  it('gives the same IP a new ID the next day', () => {
    expect(sourceId('203.0.113.7', NEXT_DAY, SECRET)).not.toBe(
      sourceId('203.0.113.7', EVENING, SECRET)
    );
  });

  it('tells IPs apart without containing them', () => {
    const id = sourceId('203.0.113.7', MORNING, SECRET);

    expect(id).not.toBe(sourceId('203.0.113.8', MORNING, SECRET));
    expect(id).not.toContain('203');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});
