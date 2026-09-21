import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  deleteUser,
  GoogleAuthProvider,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, googleProvider } from '../lib/firebase';
import { isCapacitor } from '../utils/platform';
import { clearSyncMetadata, deleteUserData, hasLocalSyncableData, isSyncPending, syncWithCloud } from '../services/firestoreSync';
import { clearAllLocalData } from '../utils/storage';
import { deleteAccountSafely, AccountDeletionError } from '../services/accountDeletion';
import { purgeDeviceData } from '../services/deviceDataPurge';
import { trackEvent } from '../services/analytics';

// ── Types ──────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  /** Re-send the email verification link to the currently signed-in user. */
  resendVerificationEmail: () => Promise<void>;
  /**
   * Delete the account under the failure-safe order: prove identity, remove
   * cloud data, delete the account, then purge this device. An email/password
   * account surfaces `reauth-required` until its password is supplied.
   */
  deleteAccount: (emailPassword?: string) => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Context hooks must be exported beside their provider; this is safe because
// the module owns the context and does not hold component-local state.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Listen for auth state changes
  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setUser(firebaseUser);
        setLoading(false);
      },
      (error) => {
        console.error('[Auth] state change error:', error);
        setUser(null);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  // Keep the Guest -> account merge at the auth boundary. A user can sign in
  // while already on Vocabulary or another route, so page mount must not be
  // required before local data reaches the account.
  useEffect(() => {
    if (!user?.uid || !user.emailVerified) return;
    let cancelled = false;
    // Email verification can happen in another tab. Firebase may update the
    // User object before the cached ID token receives the email_verified claim
    // required by Firestore rules, so refresh the token before syncing.
    user.getIdToken(true).then(() => {
      if (cancelled) return;
      return syncWithCloud(user.uid).then((result) => {
        if (!result.ok) console.error('[Auth] post-login sync failed:', result.error);
      });
    }).catch((error) => {
      console.error('[Auth] auth token refresh/sync error:', error);
    });
    return () => { cancelled = true; };
  }, [user?.uid, user?.emailVerified]);

  const signInWithGoogle = useCallback(async () => {
    if (isCapacitor()) {
      // skipNativeAuth: true — native plugin only shows the Google account
      // picker and returns an ID token.  We manually bridge it to web
      // Firebase Auth via signInWithCredential.
      const result = await FirebaseAuthentication.signInWithGoogle({
        useCredentialManager: false,
      });
      if (result?.credential?.idToken) {
        const credential = GoogleAuthProvider.credential(result.credential.idToken);
        await signInWithCredential(auth, credential);
      } else {
        throw new Error('Google Sign-In returned no ID token');
      }
    } else {
      await signInWithPopup(auth, googleProvider);
    }
    // Report sign-in (and sign_up if this is a brand-new Google account).
    const u = auth.currentUser;
    if (u) {
      const { creationTime, lastSignInTime } = u.metadata;
      const isNew = !!creationTime && creationTime === lastSignInTime;
      trackEvent('login', { method: 'google' });
      if (isNew) trackEvent('sign_up', { method: 'google' });
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    trackEvent('login', { method: 'email' });
  }, []);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
      // Send a verification email so we can prove ownership of the address.
      // Failure to send must NOT block signup — the account is still created
      // (unverified) and the user can resend later from Settings.
      try {
        await sendEmailVerification(cred.user);
      } catch (err) {
        console.error('[Auth] sendEmailVerification failed:', err);
      }
      // Acquisition + first session start.
      trackEvent('sign_up', { method: 'email' });
      trackEvent('login', { method: 'email' });
    },
    [],
  );

  const resendVerificationEmail = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) throw new Error('No authenticated user');
    await sendEmailVerification(u);
  }, []);

  const deleteAccount = useCallback(async (emailPassword?: string) => {
    const u = auth.currentUser;
    if (!u) throw new Error('No authenticated user');
    const usesGoogle = u.providerData.some((p) => p.providerId === 'google.com');

    await deleteAccountSafely({
      user: u,
      reauthenticate: async (user) => {
        if (usesGoogle) {
          // Same bridge as sign-in: the native picker yields an ID token that
          // web Firebase Auth consumes as a credential.
          if (isCapacitor()) {
            const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
            const idToken = result?.credential?.idToken;
            if (!idToken) throw new Error('Google re-authentication returned no ID token');
            await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken));
          } else {
            await reauthenticateWithPopup(user, googleProvider);
          }
          return;
        }
        if (!u.email || !emailPassword) {
          // Ask the UI for the password and retry. Throwing here is the point:
          // Firebase only reports requires-recent-login by attempting a
          // sensitive operation, so identity is proven before anything is
          // destroyed rather than discovered halfway through a wipe.
          throw new AccountDeletionError('reauth-required');
        }
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(u.email, emailPassword));
      },
      deleteCloudData: deleteUserData,
      removeAccount: (user) => deleteUser(user),
      purgeDeviceData,
    });
  }, []);

  const logOut = useCallback(async () => {
    // Cloud sync only exists for email-verified accounts: assertVerified gates
    // every cloud write, so an unverified account has nothing in the cloud and
    // can never satisfy the sync-before-logout guard. Requiring it would trap
    // the user forever behind "Reconnect and try again."
    const currentUser = auth.currentUser;
    const canSyncToCloud = !!currentUser?.emailVerified;
    if (canSyncToCloud && (hasLocalSyncableData() || isSyncPending())) {
      const syncResult = await syncWithCloud(currentUser!.uid);
      if (!syncResult.ok || syncResult.error || isSyncPending()) {
        throw new Error('auth/logout-sync-incomplete');
      }
    }
    if (isCapacitor()) {
      try { await FirebaseAuthentication.signOut(); } catch { /* ignore */ }
    }
    let signOutError: unknown = null;
    try {
      await signOut(auth);
    } catch (error) {
      signOutError = error;
    }
    // Firebase auth state is authoritative. A rejected sign-out may still have
    // completed the boundary, but a resolved sign-out that leaves a user
    // active is also inconsistent and must not clear that user's data.
    if (auth.currentUser !== null) {
      if (signOutError) throw signOutError;
      throw new Error('auth/sign-out-incomplete');
    }
    // Local storage is device-scoped, not account-scoped. Clear it at the
    // account boundary so Account A data cannot be shown or synced as Account
    // B. This must hold for unverified accounts too: keeping their data would
    // let the next verified login's auto-sync merge it into a stranger's
    // cloud, and no cloud copy of an unverified account exists to protect.
    clearAllLocalData();
    clearSyncMetadata();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, resendVerificationEmail, deleteAccount, logOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
