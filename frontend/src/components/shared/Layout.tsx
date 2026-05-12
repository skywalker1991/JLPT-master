import { Outlet, useLocation } from 'react-router-dom'
import TopNav from './TopNav'
import AnalysisPage from '../../pages/AnalysisPage'
import VideoPage from '../../pages/VideoPage'
import KnowledgeBasePage from '../../pages/KnowledgeBasePage'
import JlptPage from '../../pages/JlptPage'
import InternalizePage from '../../pages/InternalizePage'

function Keep({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={['flex-1 flex flex-col min-h-0 overflow-hidden', active ? '' : 'hidden'].join(' ')}>
      {children}
    </div>
  )
}

export default function Layout() {
  const { pathname } = useLocation()
  const isKbDetail = /^\/kb\/.+/.test(pathname)

  return (
    <div className="h-dvh bg-bg flex flex-col overflow-hidden">
      <TopNav />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Keep active={pathname === '/'}><AnalysisPage /></Keep>
        <Keep active={pathname === '/video'}><VideoPage /></Keep>
        <Keep active={pathname.startsWith('/kb') && !isKbDetail}><KnowledgeBasePage /></Keep>
        <Keep active={pathname === '/jlpt'}><JlptPage /></Keep>
        <Keep active={pathname === '/internalize'}><InternalizePage /></Keep>
        {/* /kb/:id needs useParams — rendered via Outlet */}
        {isKbDetail && <div className="flex-1 flex flex-col min-h-0 overflow-hidden"><Outlet /></div>}
      </main>
    </div>
  )
}
