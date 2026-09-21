// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { AccountDeletionError } from '../../services/accountDeletion';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'user-a', emailVerified: true, getIdToken: vi.fn() } as { uid: string; emailVerified: boolean; getIdToken: ReturnType<typeof vi.fn> } | null },
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
  syncWithCloud: vi.fn(),
  hasLocalSyncableData: vi.fn(() => true),
  isSyncPending: vi.fn(() => false),
  clearSyncMetadata: vi.fn(),
  deleteUser: vi.fn(),
  reauthenticateWithPopup: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  emailCredential: vi.fn(() => ({ kind: 'email-credential' })),
  deleteUserData: vi.fn(),
  purgeDeviceData: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
  signOut: mocks.signOut,
  signInWithPopup: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendEmailVerification: vi.fn(),
  deleteUser: mocks.deleteUser,
  reauthenticateWithPopup: mocks.reauthenticateWithPopup,
  reauthenticateWithCredential: mocks.reauthenticateWithCredential,
  EmailAuthProvider: { credential: mocks.emailCredential },
  GoogleAuthProvider: class { static credential() { return {}; } },
}));
vi.mock('../../lib/firebase', () => ({ auth: mocks.auth, googleProvider: {} }));
vi.mock('../../services/firestoreSync', () => ({
  deleteUserData: mocks.deleteUserData,
  syncWithCloud: mocks.syncWithCloud,
  hasLocalSyncableData: mocks.hasLocalSyncableData,
  isSyncPending: mocks.isSyncPending,
  clearSyncMetadata: mocks.clearSyncMetadata,
}));
vi.mock('../../services/deviceDataPurge', () => ({ purgeDeviceData: mocks.purgeDeviceData }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../utils/platform', () => ({ isCapacitor: () => false }));

function LogoutButton({ onError }: { onError?: (error: unknown) => void }) {
  const { logOut } = useAuth();
  return <button onClick={() => void logOut().catch(onError)}>Log out</button>;
}

describe('AuthProvider account boundary', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.currentUser = { uid: 'user-a', emailVerified: true, getIdToken: vi.fn().mockResolvedValue('fresh-token') };
    mocks.hasLocalSyncableData.mockReturnValue(true);
    mocks.isSyncPending.mockReturnValue(false);
    mocks.signOut.mockImplementation(async () => {
      mocks.auth.currentUser = null;
    });
    mocks.onAuthStateChanged.mockImplementation((_auth: unknown, next: (user: unknown) => void) => {
      next(mocks.auth.currentUser);
      return vi.fn();
    });
    mocks.syncWithCloud.mockResolvedValue({ ok: true });
  });

  it('clears device-scoped learning data after logout so another account cannot inherit it', async () => {
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a-only' }]));
    localStorage.setItem('echolearn_sentences', JSON.stringify([{ id: 'a-sentence' }]));
    localStorage.setItem('echolearn_session', JSON.stringify({ id: 'a-session' }));
    localStorage.setItem('echolearn_firebase_last_sync', '123');
    localStorage.setItem('echolearn_firebase_sync_pending', 'true');
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn_vocabulary_tombstones', JSON.stringify({ 'deleted-a': 123 }));
    localStorage.setItem('echolearn_sentence_tombstones', JSON.stringify({ 'deleted-s': 123 }));
    localStorage.setItem('echolearn_session_tombstones', JSON.stringify({ 'deleted-session': 123 }));

    render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>,
    );
    screen.getByRole('button', { name: 'Log out' }).click();

    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('echolearn_vocabulary')).toBeNull();
    expect(localStorage.getItem('echolearn_sentences')).toBeNull();
    expect(localStorage.getItem('echolearn_session')).toBeNull();
    expect(mocks.clearSyncMetadata).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('echolearn_lang')).toBe('en');
    expect(localStorage.getItem('echolearn_vocabulary_tombstones')).toBeNull();
    expect(localStorage.getItem('echolearn_sentence_tombstones')).toBeNull();
    expect(localStorage.getItem('echolearn_session_tombstones')).toBeNull();
  });

  it.each([
    { ok: false, error: 'offline' },
    { ok: true, error: 'sessions: partial failure' },
  ])('blocks logout when cloud sync is incomplete: $error', async (syncResult) => {
    mocks.syncWithCloud.mockResolvedValue(syncResult);
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a-only' }]));
    const onError = vi.fn();
    render(<AuthProvider><LogoutButton onError={onError} /></AuthProvider>);
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'auth/logout-sync-incomplete' })));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.auth.currentUser?.uid).toBe('user-a');
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();
  });

  it('blocks logout when the existing sync-pending marker remains set', async () => {
    mocks.isSyncPending.mockReturnValue(true);
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a-only' }]));
    const onError = vi.fn();
    render(<AuthProvider><LogoutButton onError={onError} /></AuthProvider>);
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'auth/logout-sync-incomplete' })));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();
  });

  it('skips sync and completes logout when no cloud-syncable local data exists', async () => {
    mocks.hasLocalSyncableData.mockReturnValue(false);
    mocks.syncWithCloud.mockRejectedValue(new Error('offline'));
    localStorage.setItem('echolearn_daily_plan', JSON.stringify([{ id: 'local-only' }]));
    const onError = vi.fn();
    render(<AuthProvider><LogoutButton onError={onError} /></AuthProvider>);
    await vi.waitFor(() => expect(mocks.syncWithCloud).toHaveBeenCalledTimes(1));
    mocks.syncWithCloud.mockClear();
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.syncWithCloud).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(localStorage.getItem('echolearn_daily_plan')).toBeNull();
    expect(mocks.clearSyncMetadata).toHaveBeenCalledTimes(1);
  });


  it('A1: unverified account with local data logs out without cloud sync (no deadlock)', async () => {
    // The production deadlock: an unverified account can never sync
    // (assertVerified gates every cloud write), so requiring the
    // sync-before-logout guard would block sign-out forever.
    mocks.auth.currentUser = { uid: 'user-u', emailVerified: false, getIdToken: vi.fn() };
    mocks.syncWithCloud.mockResolvedValue({ ok: false, error: 'auth/email-not-verified' });
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'u-only' }]));
    const onError = vi.fn();
    render(
      <AuthProvider>
        <LogoutButton onError={onError} />
      </AuthProvider>,
    );
    screen.getByRole('button', { name: 'Log out' }).click();

    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.syncWithCloud).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('A2: unverified account data is cleared at logout so the next verified login cannot merge it', async () => {
    // Cross-account isolation invariant (C-class): unverified Account A saves
    // local data, logs out; Verified Account B then signs in and the post-login
    // auto-sync reads localStorage. If A's data survived the boundary, B's sync
    // would merge a stranger's items into B's cloud. FALSIFIED under the
    // earlier keep-data variant of the fix.
    mocks.auth.currentUser = { uid: 'user-a-unverified', emailVerified: false, getIdToken: vi.fn() };
    mocks.syncWithCloud.mockResolvedValue({ ok: false, error: 'auth/email-not-verified' });
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a-secret-item' }]));
    localStorage.setItem('echolearn_sentences', JSON.stringify([{ id: 'a-secret-sentence' }]));
    render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>,
    );
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));

    // The boundary must leave nothing for the next account's auto-sync.
    expect(localStorage.getItem('echolearn_vocabulary')).toBeNull();
    expect(localStorage.getItem('echolearn_sentences')).toBeNull();

    // Verified Account B signs in on the same device.
    mocks.auth.currentUser = { uid: 'user-b-verified', emailVerified: true, getIdToken: vi.fn().mockResolvedValue('b-token') };
    mocks.hasLocalSyncableData.mockReturnValue(false);
    const { rerender } = render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>,
    );
    rerender(<AuthProvider><LogoutButton /></AuthProvider>);
    await vi.waitFor(() => expect(mocks.syncWithCloud).toHaveBeenCalledWith('user-b-verified'));
    // syncWithCloud reads localStorage at call time; it is empty, so nothing
    // of Account A's could reach B's cloud.
    expect(localStorage.getItem('echolearn_vocabulary')).toBeNull();
  });

  it('A5 (unverified): a failed sign-out keeps local data and propagates the error', async () => {
    mocks.auth.currentUser = { uid: 'user-u', emailVerified: false, getIdToken: vi.fn() };
    mocks.signOut.mockRejectedValue(new Error('network unavailable'));
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'u-only' }]));
    const onError = vi.fn();
    render(
      <AuthProvider>
        <LogoutButton onError={onError} />
      </AuthProvider>,
    );
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network unavailable' })));
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();
  });


  it('A7 (R7): logout awaits the in-flight sync; the boundary clears only after it completes', async () => {
    // Serialization proof for the logout-during-pending-sync scenario: the
    // device wipe must not land while a cloud sync for the same account is
    // still writing, and sign-out must not complete before the sync does.
    let releaseSync: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseSync = resolve; });
    mocks.syncWithCloud.mockReturnValue(gate.then(() => ({ ok: true })));
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a1' }]));
    render(
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>,
    );
    screen.getByRole('button', { name: 'Log out' }).click();

    // while the sync is in flight: no sign-out, no wipe
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();

    releaseSync();
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(localStorage.getItem('echolearn_vocabulary')).toBeNull());
    expect(mocks.clearSyncMetadata).toHaveBeenCalledTimes(1);
  });

  it('preserves local data and propagates a failed sign-out while auth remains active', async () => {
    mocks.signOut.mockRejectedValue(new Error('network unavailable'));
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a-only' }]));
    const onError = vi.fn();
    render(<AuthProvider><LogoutButton onError={onError} /></AuthProvider>);
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network unavailable' })));
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();
    expect(mocks.clearSyncMetadata).not.toHaveBeenCalled();
  });

  it('does not clear local data when sign-out resolves without ending auth', async () => {
    mocks.signOut.mockResolvedValue(undefined);
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a-only' }]));
    const onError = vi.fn();
    render(<AuthProvider><LogoutButton onError={onError} /></AuthProvider>);
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'auth/sign-out-incomplete' })));
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();
    expect(mocks.clearSyncMetadata).not.toHaveBeenCalled();
  });

  it('starts cloud merge from the authenticated state boundary', async () => {
    render(
      <AuthProvider>
        <div>ready</div>
      </AuthProvider>,
    );

    await vi.waitFor(() => expect(mocks.syncWithCloud).toHaveBeenCalledWith('user-a'));
    expect(mocks.auth.currentUser?.getIdToken).toHaveBeenCalledWith(true);
  });

  it('does not start cloud merge when the verified token refresh fails', async () => {
    const getIdToken = vi.fn().mockRejectedValue(new Error('token refresh failed'));
    mocks.auth.currentUser = { uid: 'user-a', emailVerified: true, getIdToken };

    render(
      <AuthProvider>
        <div>ready</div>
      </AuthProvider>,
    );

    await vi.waitFor(() => expect(getIdToken).toHaveBeenCalledWith(true));
    expect(mocks.syncWithCloud).not.toHaveBeenCalled();
  });
});

function DeleteButton({ password, onError }: { password?: string; onError?: (error: unknown) => void }) {
  const { deleteAccount } = useAuth();
  return <button onClick={() => void deleteAccount(password).catch(onError)}>Delete account</button>;
}

/**
 * M1: the account-deletion boundary as the learner actually reaches it, through
 * the provider — not just the pure sequencer. The invariant under test is that
 * nothing is destroyed before identity is proven, and nothing device-local is
 * destroyed before the account itself is gone.
 */
describe('AuthProvider account deletion', () => {
  const emailUser = {
    uid: 'user-a', email: 'owner@example.test', emailVerified: true,
    providerData: [{ providerId: 'password' }], getIdToken: vi.fn().mockResolvedValue('t'),
  };
  const googleUser = {
    uid: 'user-g', email: 'owner@gmail.test', emailVerified: true,
    providerData: [{ providerId: 'google.com' }], getIdToken: vi.fn().mockResolvedValue('t'),
  };

  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // clearAllMocks drops call history but keeps implementations, so a rejected
    // mock from an earlier case would otherwise leak into the next one.
    for (const fn of [mocks.reauthenticateWithPopup, mocks.reauthenticateWithCredential, mocks.deleteUserData, mocks.deleteUser, mocks.purgeDeviceData]) {
      fn.mockResolvedValue(undefined);
    }
    mocks.onAuthStateChanged.mockImplementation((_a: unknown, next: (u: unknown) => void) => {
      next(mocks.auth.currentUser);
      return vi.fn();
    });
    mocks.hasLocalSyncableData.mockReturnValue(false);
    mocks.isSyncPending.mockReturnValue(false);
  });

  /** Clicks delete and returns the captured rejection, so each case waits on what it asserts. */
  async function clickDelete(password?: string) {
    const onError = vi.fn();
    render(<AuthProvider><DeleteButton password={password} onError={onError} /></AuthProvider>);
    screen.getByRole('button', { name: 'Delete account' }).click();
    return onError;
  }

  const failureOf = async (onError: ReturnType<typeof vi.fn>) => {
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const error = onError.mock.calls[0][0];
    return error instanceof AccountDeletionError ? error.failure : 'no-error';
  };

  it('asks an email account for its password before touching any data', async () => {
    mocks.auth.currentUser = emailUser;
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'keep-me' }]));
    expect(await failureOf(await clickDelete(undefined))).toBe('reauth-required');
    expect(mocks.reauthenticateWithPopup).not.toHaveBeenCalled();
    expect(mocks.deleteUserData).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.purgeDeviceData).not.toHaveBeenCalled();
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();
  });

  it('reauthenticates, then deletes cloud data, the account, and only then the device', async () => {
    mocks.auth.currentUser = emailUser;
    await clickDelete('correct horse battery staple');
    await vi.waitFor(() => expect(mocks.purgeDeviceData).toHaveBeenCalledTimes(1));
    expect(mocks.emailCredential).toHaveBeenCalledWith('owner@example.test', 'correct horse battery staple');
    expect(mocks.reauthenticateWithCredential).toHaveBeenCalled();
    expect(mocks.deleteUserData).toHaveBeenCalledWith('user-a');
    expect(mocks.deleteUser).toHaveBeenCalled();
    // Order: identity → cloud → account → device.
    const order = [
      mocks.reauthenticateWithCredential.mock.invocationCallOrder[0],
      mocks.deleteUserData.mock.invocationCallOrder[0],
      mocks.deleteUser.mock.invocationCallOrder[0],
      mocks.purgeDeviceData.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('AD1: a stale session (requires-recent-login) no longer destroys local data first', async () => {
    mocks.auth.currentUser = emailUser;
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'keep-me' }]));
    mocks.deleteUser.mockRejectedValue(new Error('auth/requires-recent-login'));
    await clickDelete('hunter2');
    await vi.waitFor(() => expect(mocks.deleteUser).toHaveBeenCalledTimes(1));
    // The old flow had already run clearAllLocalData() before reaching here.
    expect(mocks.purgeDeviceData).not.toHaveBeenCalled();
    expect(localStorage.getItem('echolearn_vocabulary')).not.toBeNull();
  });

  it('A3: a failed cloud cleanup stops the deletion instead of proceeding', async () => {
    mocks.auth.currentUser = emailUser;
    mocks.deleteUserData.mockRejectedValue(new Error('permission-denied'));
    await clickDelete('hunter2');
    await vi.waitFor(() => expect(mocks.deleteUserData).toHaveBeenCalledTimes(1));
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.purgeDeviceData).not.toHaveBeenCalled();
  });

  it('reauthenticates a Google account through the popup, with no password prompt', async () => {
    mocks.auth.currentUser = googleUser;
    await clickDelete(undefined);
    await vi.waitFor(() => expect(mocks.purgeDeviceData).toHaveBeenCalledTimes(1));
    expect(mocks.reauthenticateWithPopup).toHaveBeenCalled();
    expect(mocks.reauthenticateWithCredential).not.toHaveBeenCalled();
    expect(mocks.emailCredential).not.toHaveBeenCalled();
  });

  it('AD5: deleting is not logging out — ordinary logout still only clears the account boundary', async () => {
    mocks.auth.currentUser = { ...emailUser };
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a' }]));
    render(<AuthProvider><LogoutButton /></AuthProvider>);
    screen.getByRole('button', { name: 'Log out' }).click();
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.deleteUserData).not.toHaveBeenCalled();
    expect(mocks.purgeDeviceData).not.toHaveBeenCalled();
  });
});
