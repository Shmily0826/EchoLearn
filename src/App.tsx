import { BrowserRouter, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import AuthGuard from './components/AuthGuard'
import DashboardPage from './pages/DashboardPage'
import StudyPage from './pages/StudyPage'
import VocabularyPage from './pages/VocabularyPage'
import SentencesPage from './pages/SentencesPage'
import ReviewPage from './pages/ReviewPage'

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
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthGuard>
        <AppContent />
      </AuthGuard>
    </BrowserRouter>
  );
}

export default App;
