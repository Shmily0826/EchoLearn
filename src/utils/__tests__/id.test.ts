import { describe, it, expect } from 'vitest';
import { createItemId, currentTimeMs } from '../id';

describe('createItemId', () => {
  it('prefixes the id with the given prefix', () => {
    expect(createItemId('vocab').startsWith('vocab_')).toBe(true);
    expect(createItemId('sent').startsWith('sent_')).toBe(true);
  });

  it('produces unique ids even in a tight loop', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      ids.add(createItemId('x'));
    }
    expect(ids.size).toBe(5000);
  });

  it('handles an empty prefix without throwing', () => {
    expect(createItemId('').startsWith('_')).toBe(true);
  });
});

describe('currentTimeMs', () => {
  it('returns a timestamp consistent with Date.now()', () => {
    const before = Date.now();
    const t = currentTimeMs();
    const after = Date.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});
