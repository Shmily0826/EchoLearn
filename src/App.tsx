import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isCapacitor } from './utils/platform';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { useAntiTranslate } from './hooks/useAntiTranslate';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import FirstTimeTour from './components/FirstTimeTour';
import LanguageChooser from './components/LanguageChooser';
import LoginPage from './pages/LoginPage';

// Pages are loaded on their first visit. Once mounted, they remain mounted so
// the original app behaviour (video position, scroll position and form state)
// is preserved while avoiding downloading every page on the initial visit.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const StudyPage = lazy(() => import('./pages/StudyPage'));
const VocabularyPage = lazy(() => import('./pages/VocabularyPage'));
const SentencesPage = lazy(() => import('./pages/SentencesPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const APP_ROUTES = ['/', '/study', '/vocabulary', '/sentences', '/review', '/settings'] as const;
type AppRoute = (typeof APP_ROUTES)[number];

function isAppRoute(pathname: string): pathname is AppRoute {
  return APP_ROUTES.includes(pathname as AppRoute);
}

function PageLoader() {
  return (
    <div className="min-h-[12rem] flex items-center justify-center" aria-label="Loading page">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-500" />
    </div>
  );
}

/**
 * All pages are always mounted (never unmounted on route change).
 * Only the active route is visible. This preserves component state
 * (video player, scroll position, form inputs) when switching tabs.
 */
function AppContent({ onLoginRequest }: { onLoginRequest?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { translateDetected, dismissWarning } = useAntiTranslate();
  const { t } = useI18n();
  const [visitedRoutes, setVisitedRoutes] = useState<Set<AppRoute>>(() =>
    new Set(isAppRoute(pathname) ? [pathname] : ['/']),
  );
  useEffect(() => {
    if (!isAppRoute(pathname)) return;
    // The route change is an external state transition. Record the page after
    // it commits so it stays mounted on subsequent navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisitedRoutes((routes) => {
      if (routes.has(pathname)) return routes;
      return new Set(routes).add(pathname);
    });
  }, [pathname]);

  // Handle Android back button and status bar in Capacitor
  useEffect(() => {
    if (!isCapacitor()) return;

    // Prevent status bar from overlapping app content
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});

    const handler = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (pathname !== '/') {
        navigate('/');
      } else if (canGoBack) {
        window.history.back();
      } else {
        CapApp.minimizeApp();
      }
    });
    return () => { handler.then(h => h.remove()); };
  }, [pathname, navigate]);

  return (
    <Layout>
      {/* First-ever-visit language picker (renders nothing once chosen) */}
      <LanguageChooser />

      {/* Google Translate detection banner */}
      {translateDetected && (
        <div
          className="fixed top-0 left-0 right-0 z-[9999] px-4 py-2.5 text-sm text-center"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', borderBottom: '1px solid #fcd34d' }}
          translate="no"
        >
          <span>
            {t('banner.translateWarn')}
          </span>
          <button
            onClick={dismissWarning}
            className="ml-3 font-semibold underline cursor-pointer"
          >
            {t('banner.dismiss')}
          </button>
        </div>
      )}

      <Suspense fallback={<PageLoader />}>
        {visitedRoutes.has('/') && (
          <div style={{ display: pathname === '/' ? undefined : 'none' }}>
            <DashboardPage />
          </div>
        )}
        {visitedRoutes.has('/study') && (
          <div style={{ display: pathname === '/study' ? undefined : 'none' }}>
            <StudyPage />
          </div>
        )}
        {visitedRoutes.has('/vocabulary') && (
          <div style={{ display: pathname === '/vocabulary' ? undefined : 'none' }}>
            <VocabularyPage />
          </div>
        )}
        {visitedRoutes.has('/sentences') && (
          <div style={{ display: pathname === '/sentences' ? undefined : 'none' }}>
            <SentencesPage />
          </div>
        )}
        {visitedRoutes.has('/review') && (
          <div style={{ display: pathname === '/review' ? undefined : 'none' }}>
            <ReviewPage />
          </div>
        )}
        {visitedRoutes.has('/settings') && (
          <div style={{ display: pathname === '/settings' ? undefined : 'none' }}>
            <SettingsPage onLoginRequest={onLoginRequest} />
          </div>
        )}
      </Suspense>

      {/* First-time bubble tour — only active on Dashboard and only once per device */}
      <FirstTimeTour />
    </Layout>
  );
}

/**
 * Auth gate — supports guest mode.
 * First visit shows LoginPage with a "try as guest" option.
 * Guests can browse videos/subtitles; saving & AI analysis require login.
 * After login, guest localStorage data auto-merges via syncWithCloud.
 */
function AuthGate() {
  const { user, loading } = useAuth();
  const [guestMode, setGuestMode] = useState(() => {
    try {
      return localStorage.getItem('echolearn_guest_mode') === 'true';
    } catch {
      return false;
    }
  });

  const handleGuest = useCallback(() => {
    setGuestMode(true);
    try { localStorage.setItem('echolearn_guest_mode', 'true'); } catch { /* noop */ }
  }, []);
  const handleLoginRequest = useCallback(() => {
    setGuestMode(false);
    try { localStorage.removeItem('echolearn_guest_mode'); } catch { /* noop */ }
  }, []);

  if (loading) {
    // Initial auth state check — show a minimal loader
    // NOTE: intentionally no useI18n here because this may render
    // before I18nProvider's children are fully initialised.
    return (
      <div
        className="min-h-screen flex items-center justify-center notranslate"
        style={{ backgroundColor: 'var(--color-bg)' }}
        translate="no"
      >
        <div className="flex flex-col items-center gap-3">
          <svg
            className="animate-spin h-8 w-8 text-indigo-500"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm text-gray-400 dark:text-gray-500">Loading…</span>
        </div>
      </div>
    );
  }

  if (!user && !guestMode) {
    return <LoginPage onGuest={handleGuest} />;
  }

  return <AppContent onLoginRequest={!user ? handleLoginRequest : undefined} />;
}

function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <ErrorBoundary>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </ErrorBoundary>
      </I18nProvider>
    </BrowserRouter>
  );
}

export default App;
