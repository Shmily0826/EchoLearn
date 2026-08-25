// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'user-a', emailVerified: true } as { uid: string; emailVerified: boolean } | null },
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
  syncWithCloud: vi.fn(),
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
}));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../utils/platform', () => ({ isCapacitor: () => false }));

function LogoutButton() {
  const { logOut } = useAuth();
  return <button onClick={() => void logOut()}>Log out</button>;
}

describe('AuthProvider account boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.auth.currentUser = { uid: 'user-a', emailVerified: true };
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
  });

  it('starts cloud merge from the authenticated state boundary', async () => {
    render(
      <AuthProvider>
        <div>ready</div>
      </AuthProvider>,
    );

    await vi.waitFor(() => expect(mocks.syncWithCloud).toHaveBeenCalledWith('user-a'));
  });
});
