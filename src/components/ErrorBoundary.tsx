import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Detect whether the error is likely caused by Google Translate
 * modifying the DOM (insertBefore / removeChild / NotFoundError).
 */
function isTranslateError(error: Error | null): boolean {
  if (!error) return false;
  const msg = error.message || '';
  const stack = error.stack || '';
  const combined = msg + stack;
  return (
    combined.includes('insertBefore') ||
    combined.includes('removeChild') ||
    combined.includes('NotFoundError') ||
    combined.includes('not a child of this node') ||
    combined.includes('was not found')
  );
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const translateRelated = isTranslateError(this.state.error);

    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: 'var(--color-bg, #fff)' }}
        translate="no"
      >
        <div className="max-w-md w-full text-center">
          {translateRelated ? (
            <>
              {/* Translate-specific error UI */}
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950 mb-4">
                <svg
                  className="w-7 h-7 text-amber-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">
                Auto-Translate Conflict
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Your browser's auto-translate feature modified the page structure, which conflicts with how this app works.
              </p>
              <div
                className="text-left text-xs rounded-xl p-4 mb-5"
                style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
              >
                <p className="font-semibold mb-2">How to fix:</p>
                <p className="mb-1">• <strong>Chrome mobile:</strong> Tap the address bar → tap the translate icon → tap the three dots → select "Show original"</p>
                <p className="mb-1">• <strong>Chrome desktop:</strong> Right-click the page → uncheck "Translate to [language]"</p>
                <p>• Then tap <strong>Reload Page</strong> below</p>
              </div>
            </>
          ) : (
            <>
              {/* Generic error UI */}
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950 mb-4">
                <svg
                  className="w-7 h-7 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">
                Something went wrong
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {this.state.error?.message || 'An unexpected error occurred.'}
              </p>
            </>
          )}

          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-colors cursor-pointer"
            >
              Reload Page
            </button>
            <button
              onClick={() => {
                const keys = Object.keys(localStorage).filter((k) => k.startsWith('echolearn_'));
                keys.forEach((k) => localStorage.removeItem(k));
                window.location.reload();
              }}
              className="px-6 py-2.5 text-sm text-red-500 border border-red-200 dark:border-red-800 rounded-xl hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
            >
              Clear Data &amp; Reload
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-6 break-all">
            {this.state.error?.stack?.slice(0, 300)}
          </p>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
