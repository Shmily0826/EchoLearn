import { Component, createRef } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { useI18n } from '../i18n/I18nContext';

interface Props {
  children: ReactNode;
  t?: (key: string) => string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  confirmingClear: boolean;
  /** The React render path that threw — the only clue for a crash inside a map. */
  componentStack: string | null;
  copied: boolean;
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
  private clearingRef = false;
  private cancelButtonRef = createRef<HTMLButtonElement>();
  private diagnosticsRef = createRef<HTMLPreElement>();

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, confirmingClear: false, componentStack: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true, error, confirmingClear: false, componentStack: null, copied: false,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ componentStack: info.componentStack || null });
  }

  /**
   * Everything needed to place a report without the learner describing it.
   * Deliberately excludes stored learning data, account details and query
   * strings: the build, the route, and what actually threw are enough to
   * reproduce, and this text is copied out by hand into an issue.
   */
  private diagnostics(): string {
    const { error, componentStack } = this.state;
    const cap = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
    const lines = [
      `EchoLearn build ${typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown'}`,
      `${new Date().toISOString()}  route=${window.location.pathname}  viewport=${window.innerWidth}x${window.innerHeight}  online=${navigator.onLine}`,
      `UA: ${cap(navigator.userAgent, 160)}`,
      '',
      `${error?.name ?? 'Error'}: ${error?.message ?? ''}`,
      cap(error?.stack ?? '(no stack)', 4000),
    ];
    if (componentStack) lines.push('', 'Rendered by:', cap(componentStack, 1500));
    return lines.join('\n');
  }

  private async copyDiagnostics() {
    const text = this.diagnostics();
    let copied = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Insecure context or denied permission: select the text instead, which
      // still leaves Ctrl+C one keystroke away.
      copied = false;
    }
    this.setState({ copied });
    if (!copied) {
      const node = this.diagnosticsRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = this.props.t || ((key: string) => key);
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
                {t('error.translateTitle')}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                {t('error.translateDesc')}
              </p>
              <div
                className="text-left text-xs rounded-xl p-4 mb-5"
                style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
              >
                <p className="font-semibold mb-2">{t('error.fixTitle')}</p>
                <p className="mb-1" dangerouslySetInnerHTML={{ __html: '&bull; ' + t('error.fixChrome1').replace(/^(.*?):/, '<strong>$1:</strong>') }} />
                <p className="mb-1" dangerouslySetInnerHTML={{ __html: '&bull; ' + t('error.fixChrome2').replace(/^(.*?):/, '<strong>$1:</strong>') }} />
                <p>&bull; {t('error.fixReload')}</p>
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
                {t('error.somethingWrong')}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {this.state.error?.message || t('error.somethingWrong')}
              </p>
            </>
          )}

          {this.state.confirmingClear ? (
            <div
              role="alertdialog"
              aria-modal="false"
              aria-label={t('error.clearConfirmTitle')}
              className="mt-2 text-left rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4"
              onKeyDown={(e) => {
                if (e.key === 'Escape') this.setState({ confirmingClear: false });
              }}
            >
              <h2 className="text-sm font-bold text-red-700 dark:text-red-300 mb-2">
                {t('error.clearConfirmTitle')}
              </h2>
              <p className="text-xs text-red-600 dark:text-red-300 mb-3 whitespace-pre-line">
                {t('error.clearConfirmBody')}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  ref={this.cancelButtonRef}
                  autoFocus
                  onClick={() => this.setState({ confirmingClear: false })}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  {t('error.clearConfirmCancel')}
                </button>
                <button
                  onClick={() => {
                    // Guard against duplicate destructive execution through repeated clicks.
                    if (this.clearingRef) return;
                    this.clearingRef = true;
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                      const key = localStorage.key(i);
                      if (key && key.startsWith('echolearn_')) localStorage.removeItem(key);
                    }
                    window.location.reload();
                  }}
                  data-testid="error-confirm-clear"
                  className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
                >
                  {t('error.clearConfirmConfirm')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-colors cursor-pointer"
              >
                {t('error.reload')}
              </button>
              <button
                onClick={() => this.setState({ confirmingClear: true })}
                data-testid="error-clear-reload"
                className="px-6 py-2.5 text-sm text-red-500 border border-red-200 dark:border-red-800 rounded-xl hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
              >
                {t('error.clearReload')}
              </button>
            </div>
          )}
          <div className="mt-6 text-left">
            <button
              onClick={() => { void this.copyDiagnostics(); }}
              data-testid="error-copy-diagnostics"
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {this.state.copied ? t('error.diagnosticsCopied') : t('error.copyDiagnostics')}
            </button>
            <pre
              ref={this.diagnosticsRef}
              data-testid="error-diagnostics"
              className="mt-2 max-h-40 overflow-auto text-[10px] leading-snug text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2 whitespace-pre-wrap break-all"
            >
              {this.diagnostics()}
            </pre>
          </div>
        </div>
      </div>
    );
  }
}

function ErrorBoundaryWithI18n({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return <ErrorBoundary t={t}>{children}</ErrorBoundary>;
}

export default ErrorBoundaryWithI18n;
