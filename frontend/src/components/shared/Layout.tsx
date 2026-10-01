import { Outlet, useLocation } from 'react-router-dom'
import TopNav from './TopNav'
import BottomNav from './BottomNav'
import AnalysisPage from '../../pages/AnalysisPage'
import KnowledgeBasePage from '../../pages/KnowledgeBasePage'
import JlptPage from '../../pages/JlptPage'
import InternalizePage from '../../pages/InternalizePage'
import AdminIngestPage from '../../pages/AdminIngestPage'
import SettingsPage from '../../pages/SettingsPage'
import AccountPage from '../../pages/AccountPage'
import { useAuth } from '../../context/AuthContext'

function Keep({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={['flex-1 flex flex-col min-h-0 overflow-hidden', active ? '' : 'hidden'].join(' ')}>
      {children}
    </div>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  const { isAdmin } = useAuth()
  const isKbDetail = /^\/kb\/.+/.test(pathname)

  return (
    <div className="h-dvh bg-bg flex flex-col overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <TopNav />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Keep active={pathname === '/'}><AnalysisPage /></Keep>
        <Keep active={pathname.startsWith('/kb') && !isKbDetail}><KnowledgeBasePage /></Keep>
        <Keep active={pathname === '/jlpt'}><JlptPage /></Keep>
        <Keep active={pathname === '/internalize'}><InternalizePage /></Keep>
        {/* Admin pages exist only for admins — mounted for anyone else they
            would call admin endpoints on load and collect a screen of 403s. */}
        {isAdmin && <Keep active={pathname === '/admin/ingest'}><AdminIngestPage /></Keep>}
        {/* Mounted only while open, so the account list is fresh each visit. */}
        {pathname === '/account' && <div className="flex-1 flex flex-col min-h-0 overflow-hidden"><AccountPage /></div>}
        {pathname === '/settings' && <div className="flex-1 flex flex-col min-h-0 overflow-hidden"><SettingsPage /></div>}
        {/* /kb/:id needs useParams — rendered via Outlet */}
        {isKbDetail && <div className="flex-1 flex flex-col min-h-0 overflow-hidden"><Outlet /></div>}
      </main>
      <BottomNav />
    </div>
  )
}
