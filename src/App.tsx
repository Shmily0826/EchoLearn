import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import StudyPage from './pages/StudyPage'
import VocabularyPage from './pages/VocabularyPage'
import SentencesPage from './pages/SentencesPage'
import ReviewPage from './pages/ReviewPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="vocabulary" element={<VocabularyPage />} />
          <Route path="sentences" element={<SentencesPage />} />
          <Route path="review" element={<ReviewPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
