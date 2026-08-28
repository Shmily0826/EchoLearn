// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'user-a', emailVerified: true, getIdToken: vi.fn() } as { uid: string; emailVerified: boolean; getIdToken: ReturnType<typeof vi.fn> } | null },
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
  syncWithCloud: vi.fn(),
  clearSyncMetadata: vi.fn(),
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
  deleteUser: vi.fn(),
  GoogleAuthProvider: class { static credential() { return {}; } },
}));
vi.mock('../../lib/firebase', () => ({ auth: mocks.auth, googleProvider: {} }));
vi.mock('../../services/firestoreSync', () => ({
  deleteUserData: vi.fn(),
  syncWithCloud: mocks.syncWithCloud,
  clearSyncMetadata: mocks.clearSyncMetadata,
}));
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
