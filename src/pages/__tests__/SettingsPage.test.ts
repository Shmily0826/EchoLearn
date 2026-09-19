import { describe, expect, it } from 'vitest';
import { shouldAutoSyncUser, shouldWarnOnLogout } from '../../utils/authPolicy';

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


describe('shouldWarnOnLogout gating (ECHO_LOGOUT_SAFETY_UX_V1)', () => {
  const verified = { uid: 'u1', emailVerified: true };
  const unverified = { uid: 'u2', emailVerified: false };

  it('warns only for an unverified account with data or a pending sync at risk', () => {
    // C: unverified + data at risk -> confirm before the destructive boundary
    expect(shouldWarnOnLogout(unverified, true, false)).toBe(true);
    expect(shouldWarnOnLogout(unverified, false, true)).toBe(true);
    expect(shouldWarnOnLogout(unverified, true, true)).toBe(true);
    // B: unverified with nothing at risk -> straight logout
    expect(shouldWarnOnLogout(unverified, false, false)).toBe(false);
    // A: verified accounts keep the existing sync-before-logout flow (no dialog)
    expect(shouldWarnOnLogout(verified, true, true)).toBe(false);
    // No user -> no warning (the button is not rendered signed out anyway)
    expect(shouldWarnOnLogout(null, true, true)).toBe(false);
  });
});
