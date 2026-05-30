import { NavLink } from 'react-router-dom'
import { FileText, BookMarked, Video, BookOpen, Brain, Settings } from 'lucide-react'
import clsx from 'clsx'
import { useSettings } from '../../context/SettingsContext'

const ALL_LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']

const LEVEL_ACTIVE: Record<string, string> = {
  N1: 'bg-red-100 text-red-700 ring-red-300',
  N2: 'bg-orange-100 text-orange-700 ring-orange-300',
  N3: 'bg-yellow-100 text-yellow-700 ring-yellow-300',
  N4: 'bg-emerald-100 text-emerald-700 ring-emerald-300',
  N5: 'bg-blue-100 text-blue-700 ring-blue-300',
}

const MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
]

const NAV = [
  { to: '/',            end: true,  icon: FileText,   label: '语料分析' },
  { to: '/jlpt',        end: false, icon: BookMarked, label: 'JLPT专题' },
  { to: '/video',       end: false, icon: Video,      label: '实时视频' },
  { to: '/kb',          end: false, icon: BookOpen,   label: '知识库' },
  { to: '/internalize', end: false, icon: Brain,      label: '内化学习' },
  { to: '/admin/ingest', end: false, icon: Settings,  label: '管理' },
]

export default function TopNav() {
  const { settings, updateSettings, toggleLevel } = useSettings()

  return (
    <header className="sticky top-0 z-50 bg-surface shadow-topbar h-14 flex items-center px-3 md:px-6 gap-2 md:gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <img src="/image.png" alt="日本語 Master" className="w-9 h-9 md:w-11 md:h-11 object-contain rounded-xl" />
        <span className="font-semibold text-fg text-sm tracking-tight hidden sm:block">日本語 Master</span>
      </div>

      {/* Tab nav */}
      <nav className="flex items-center gap-0.5 ml-1 md:ml-2">
        {NAV.map(({ to, end, icon: Icon, label }) => (
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

      {/* Level filter toggles — desktop only */}
      <div className="hidden md:flex items-center gap-1 shrink-0">
        {ALL_LEVELS.map(level => {
          const isActive = settings.levelFilter.includes(level)
          return (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={clsx(
                'text-xs font-semibold px-2 py-1 rounded-full ring-1 transition-all duration-150 cursor-pointer',
                isActive
                  ? LEVEL_ACTIVE[level]
                  : 'bg-gray-50 text-fg-subtle ring-border hover:ring-gray-300 hover:text-fg-muted',
              )}
            >
              {level}
            </button>
          )
        })}
      </div>

      {/* Model selector — desktop only */}
      <select
        value={settings.model}
        onChange={e => updateSettings({ model: e.target.value })}
        className="hidden md:block text-xs border border-border rounded-lg px-2 py-1.5 bg-surface text-fg
                   hover:border-accent/50 focus:border-accent focus:ring-2 focus:ring-accent/20
                   focus:outline-none transition-all cursor-pointer max-w-40 shrink-0"
      >
        {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
    </header>
  )
}
