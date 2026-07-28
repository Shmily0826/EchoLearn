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
  sendEmailVerification,
  deleteUser,
  GoogleAuthProvider,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, googleProvider } from '../lib/firebase';
import { isCapacitor } from '../utils/platform';
import { deleteUserData } from '../services/firestoreSync';
import { clearAllLocalData } from '../utils/storage';

// ── Types ──────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  /** Re-send the email verification link to the currently signed-in user. */
  resendVerificationEmail: () => Promise<void>;
  /** Permanently delete the account + its cloud data, then clear local data. */
  deleteAccount: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
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
    },
    [],
  );

  const resendVerificationEmail = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) throw new Error('No authenticated user');
    await sendEmailVerification(u);
  }, []);

  const deleteAccount = useCallback(async () => {
    const u = auth.currentUser;
    if (!u) throw new Error('No authenticated user');
    // Best-effort: wipe the user's cloud data before destroying the account.
    // (Orphaned docs would otherwise linger, since rules require the uid.)
    try {
      await deleteUserData(u.uid);
    } catch (err) {
      console.error('[Auth] deleteUserData failed (continuing):', err);
    }
    // Wipe local study data on this device too.
    clearAllLocalData();
    try {
      await deleteUser(u);
    } catch (err) {
      // deleteUser requires a recent sign-in. For Google users we can silently
      // re-authenticate; for others we surface the error so the UI can ask for
      // a re-login.
      if (err instanceof Error && err.message.includes('requires-recent-login')) {
        if (u.providerData.some((p) => p.providerId === 'google.com')) {
          await signInWithPopup(auth, googleProvider);
          await deleteUser(auth.currentUser!);
        } else {
          throw new Error('auth/requires-recent-login');
        }
      } else {
        throw err;
      }
    }
  }, []);

  const logOut = useCallback(async () => {
    if (isCapacitor()) {
      try { await FirebaseAuthentication.signOut(); } catch { /* ignore */ }
    }
    await signOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, resendVerificationEmail, deleteAccount, logOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
