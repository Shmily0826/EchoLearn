import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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

    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: 'var(--color-bg, #fff)' }}
      >
        <div className="max-w-md w-full text-center">
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
          <div className="flex flex-col gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-colors cursor-pointer"
            >
              Reload Page
            </button>
            <button
              onClick={() => {
                // Clear all app data and reload
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
