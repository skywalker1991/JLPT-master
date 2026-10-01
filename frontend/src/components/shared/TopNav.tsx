import { NavLink } from 'react-router-dom'
import { FileText, BookMarked, BookOpen, Brain, Settings, SlidersHorizontal, UserRound } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import clsx from 'clsx'
import Logo from './Logo'

export const NAV = [
  { to: '/',            end: true,  icon: FileText,   label: '语料分析', mobile: true },
  { to: '/jlpt',        end: false, icon: BookMarked, label: 'JLPT专题', mobile: true },
  // 实时视频 is hidden until subtitles can be fetched reliably and a video
  // plays without them — pages/VideoPage and api/video.py are kept as they are.
  // To restore: this entry (icon: Video), its <Keep> in Layout, its route in App.
  { to: '/kb',          end: false, icon: BookOpen,   label: '知识库',   mobile: true },
  { to: '/internalize', end: false, icon: Brain,      label: '内化学习', mobile: true },
  { to: '/admin/ingest', end: false, icon: Settings,  label: '管理',     mobile: false, admin: true },  // desktop only
]

export default function TopNav() {
  const { user, isAdmin } = useAuth()

  return (
    // Desktop only — phones use BottomNav
    <header className="hidden md:flex sticky top-0 z-50 bg-surface shadow-topbar h-14 items-center px-6 gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <Logo className="w-7 h-7 text-fg shrink-0" />
        <span className="font-semibold text-fg text-sm tracking-[-0.02em] hidden sm:block">日本語 Master</span>
      </div>

      {/* Tab nav */}
      <nav className="flex items-center gap-0.5 ml-1 md:ml-2">
        {NAV.filter(n => !('admin' in n) || isAdmin).map(({ to, end, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-1.5 rounded-lg transition-colors duration-150 cursor-pointer',
                'px-2.5 py-2 md:px-3.5',
                'text-sm font-semibold whitespace-nowrap',
                isActive
                  ? 'bg-accent-light text-accent-fg'
                  : 'text-fg-muted hover:text-fg hover:bg-gray-100',
              )
            }
          >
            <Icon className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
            <span className="hidden md:inline">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex-1" />

      <NavLink
        to="/settings"
        title="设置"
        aria-label="设置"
        className={({ isActive }) => clsx(
          'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 transition-colors',
          isActive ? 'bg-accent-light text-accent-fg' : 'text-fg-muted hover:text-fg hover:bg-gray-100',
        )}
      >
        <SlidersHorizontal className="w-4 h-4" />
      </NavLink>

      <NavLink
        to="/account"
        title={user?.email}
        className={({ isActive }) => clsx(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold shrink-0 transition-colors',
          isActive ? 'bg-accent-light text-accent-fg' : 'text-fg-muted hover:text-fg hover:bg-gray-100',
        )}
      >
        <UserRound className="w-4 h-4" />
        <span className="max-w-32 truncate">{user?.display_name || user?.email?.split('@')[0]}</span>
      </NavLink>
    </header>
  )
}
