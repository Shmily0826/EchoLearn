import { useState, useCallback } from 'react';

const ACCESS_PASSWORD = ((import.meta.env.VITE_ACCESS_PASSWORD as string | undefined) || '').trim();

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Simple client-side password gate.
 * If VITE_ACCESS_PASSWORD is not set or empty, the guard is bypassed.
 * Auth state is held in memory — refreshing the page requires re-entry.
 */
const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (input.trim() === ACCESS_PASSWORD) {
        setAuthenticated(true);
        setError(false);
      } else {
        setError(true);
        setShaking(true);
        setTimeout(() => setShaking(false), 500);
        setInput('');
      }
    },
    [input],
  );

  // No password configured → skip the gate entirely
  if (!ACCESS_PASSWORD || authenticated) {
    return <>{children}</>;
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-sm rounded-2xl p-8 shadow-lg border transition-transform ${
          shaking ? 'animate-shake' : ''
        }`}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
        }}
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950 mb-4">
            <svg className="w-7 h-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-indigo-500 tracking-tight">EchoLearn</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Please enter the access password to continue
          </p>
        </div>

        {/* Password input */}
        <div className="space-y-4">
          <div>
            <input
              type="password"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(false);
              }}
              placeholder="Access password"
              autoFocus
              className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors focus:ring-2 focus:ring-indigo-500/30"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                borderColor: error ? '#ef4444' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            />
            {error && (
              <p className="text-red-500 text-xs mt-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                Incorrect password, please try again
              </p>
            )}
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 transition-colors cursor-pointer"
          >
            Enter
          </button>
        </div>

        {/* Contact hint */}
        <p className="text-center text-xs mt-6" style={{ color: 'var(--color-text-muted)' }}>
          Need access? Contact{' '}
          <a href="mailto:1014755473@qq.com" className="text-indigo-500 hover:underline">
            1014755473@qq.com
          </a>
        </p>
      </form>
    </div>
  );
};

export default AuthGuard;
