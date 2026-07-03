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
  GoogleAuthProvider,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { auth, googleProvider } from '../lib/firebase';
import { isCapacitor } from '../utils/platform';

// ── Types ──────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
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
    },
    [],
  );

  const logOut = useCallback(async () => {
    if (isCapacitor()) {
      try { await FirebaseAuthentication.signOut(); } catch { /* ignore */ }
    }
    await signOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, logOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
