import { describe, expect, it } from 'vitest';
import { shouldAutoSyncUser } from '../../utils/authPolicy';

describe('Settings auto-sync eligibility', () => {
  it('does not auto-sync an unverified account', () => {
    expect(shouldAutoSyncUser({ uid: 'user-b', emailVerified: false })).toBe(false);
  });

  it('auto-syncs only a verified authenticated account', () => {
    expect(shouldAutoSyncUser(null)).toBe(false);
    expect(shouldAutoSyncUser({ uid: '', emailVerified: true })).toBe(false);
    expect(shouldAutoSyncUser({ uid: 'user-a', emailVerified: true })).toBe(true);
  });
});
