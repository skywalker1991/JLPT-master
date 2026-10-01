import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import Layout from './components/shared/Layout'
import AtomDetailPage from './pages/AtomDetailPage'
import LoginPage from './pages/LoginPage'
import { useAuth } from './context/AuthContext'

export default function App() {
  const { status, isAdmin } = useAuth()

  if (status === 'loading') {
    return (
      <div className="h-dvh bg-bg flex items-center justify-center text-fg-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }
  // Nothing of the app is mounted until someone is signed in, so no page
  // starts fetching personal data on behalf of nobody.
  if (status === 'signed-out') return <LoginPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={null} />
        <Route path="kb" element={null} />
        <Route path="kb/:id" element={<AtomDetailPage />} />
        <Route path="jlpt" element={null} />
        <Route path="internalize" element={null} />
        <Route path="account" element={null} />
        {isAdmin && <Route path="admin/ingest" element={null} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
