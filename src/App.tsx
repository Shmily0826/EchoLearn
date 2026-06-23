import { BrowserRouter, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import StudyPage from './pages/StudyPage'
import VocabularyPage from './pages/VocabularyPage'
import SentencesPage from './pages/SentencesPage'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'

/**
 * All pages are always mounted (never unmounted on route change).
 * Only the active route is visible. This preserves component state
 * (video player, scroll position, form inputs) when switching tabs.
 */
function AppContent() {
  const { pathname } = useLocation();

  return (
    <Layout>
      <div style={{ display: pathname === '/' ? undefined : 'none' }}>
        <DashboardPage />
      </div>
      <div style={{ display: pathname === '/study' ? undefined : 'none' }}>
        <StudyPage />
      </div>
      <div style={{ display: pathname === '/vocabulary' ? undefined : 'none' }}>
        <VocabularyPage />
      </div>
      <div style={{ display: pathname === '/sentences' ? undefined : 'none' }}>
        <SentencesPage />
      </div>
      <div style={{ display: pathname === '/review' ? undefined : 'none' }}>
        <ReviewPage />
      </div>
      <div style={{ display: pathname === '/settings' ? undefined : 'none' }}>
        <SettingsPage />
      </div>
    </Layout>
  );
}

/**
 * Auth gate — shows login page if not authenticated, otherwise renders the app.
 * The old VITE_ACCESS_PASSWORD gate is deprecated in favour of Firebase Auth.
 */
function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    // Initial auth state check — show a minimal loader
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-bg)' }}
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
          <span className="text-sm text-gray-400 dark:text-gray-500">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <AppContent />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
