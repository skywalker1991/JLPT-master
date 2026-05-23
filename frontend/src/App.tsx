import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/shared/Layout'
import AtomDetailPage from './pages/AtomDetailPage'
import AdminIngestPage from './pages/AdminIngestPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={null} />
        <Route path="video" element={null} />
        <Route path="kb" element={null} />
        <Route path="kb/:id" element={<AtomDetailPage />} />
        <Route path="jlpt" element={null} />
        <Route path="internalize" element={null} />
        <Route path="admin/ingest" element={<AdminIngestPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
