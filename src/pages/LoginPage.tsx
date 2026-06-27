import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../i18n/I18nContext';

type AuthMode = 'login' | 'signup';

const LoginPage: React.FC = () => {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        if (password.length < 6) {
          setError(t('login.errWeakPw'));
          setLoading(false);
          return;
        }
        await signUpWithEmail(email, password, displayName);
      }
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 notranslate"
      style={{ backgroundColor: 'var(--color-bg)' }}
      translate="no"
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-lg border"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950 mb-4">
            <svg
              className="w-7 h-7 text-indigo-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-indigo-500 tracking-tight">EchoLearn</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('login.subtitle')}
          </p>
        </div>

        {/* Google Sign-In */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer disabled:opacity-50"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text)',
          }}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          {t('login.google')}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('login.or')}
          </span>
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--color-border)' }} />
        </div>

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('login.displayName')}
                className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors focus:ring-2 focus:ring-indigo-500/30"
                style={{
                  backgroundColor: 'var(--color-input-bg)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
            </div>
          )}

          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder={t('login.email')}
              required
              className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors focus:ring-2 focus:ring-indigo-500/30"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                borderColor: error ? '#ef4444' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
          </div>

          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder={t('login.password')}
              required
              className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors focus:ring-2 focus:ring-indigo-500/30"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                borderColor: error ? '#ef4444' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
          </div>

          {error && (
            <p className="text-red-500 dark:text-red-400 text-xs flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading
              ? t('login.waiting')
              : mode === 'login'
                ? t('login.signIn')
                : t('login.signUp')}
          </button>
        </form>

        {/* Toggle mode */}
        <p className="text-center text-sm mt-6" style={{ color: 'var(--color-text-muted)' }}>
          {mode === 'login' ? t('login.noAccount') : t('login.hasAccount')}
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError('');
            }}
            className="text-indigo-500 hover:underline font-medium cursor-pointer"
          >
            {mode === 'login' ? t('login.signUpLink') : t('login.signInLink')}
          </button>
        </p>
      </div>
    </div>
  );
};

function getErrorMessage(err: unknown, t: (key: string) => string): string {
  if (!(err instanceof Error)) return 'An unknown error occurred.';
  const msg = err.message;
  // Firebase auth error codes are embedded in the message
  if (msg.includes('auth/user-not-found')) return t('login.errNotFound');
  if (msg.includes('auth/wrong-password')) return t('login.errPassword');
  if (msg.includes('auth/invalid-email')) return t('login.errEmail');
  if (msg.includes('auth/email-already-in-use')) return t('login.errEmailUsed');
  if (msg.includes('auth/weak-password')) return t('login.errWeakPw');
  if (msg.includes('auth/invalid-credential')) return t('login.errCredential');
  if (msg.includes('auth/popup-closed-by-user')) return t('login.errCancelled');
  if (msg.includes('auth/too-many-requests')) return t('login.errTooMany');
  // Return cleaned message
  return msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim() || t('login.errFailed');
}

export default LoginPage;
