import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  levelFilter: string[]   // selected JLPT levels; empty = show all
  model: string
  theme: Theme            // 'system' follows the OS light/dark setting
  hideJa: boolean         // sentence card: hide Japanese (recall practice)
  hideFurigana: boolean   // sentence card: hide the kana readings
  hideZh: boolean         // sentence card: hide the translation
}

interface SettingsCtx {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  toggleLevel: (level: string) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

const DEFAULTS: Settings = {
  levelFilter: [], model: 'gemini-2.5-flash', theme: 'system',
  hideJa: false, hideFurigana: false, hideZh: false,
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('jlpt-settings') ?? '{}')
      // migrate legacy targetLevel → empty levelFilter
      return { ...DEFAULTS, ...stored, levelFilter: stored.levelFilter ?? [] }
    } catch {
      return DEFAULTS
    }
  })

  // Apply the theme as a `dark` class on <html> (index.html does the same
  // before first paint to avoid a light flash).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    localStorage.setItem('jlpt-settings', JSON.stringify(next))
  }

  const toggleLevel = (level: string) => {
    const current = settings.levelFilter
    const next = current.includes(level)
      ? current.filter(l => l !== level)
      : [...current, level]
    updateSettings({ levelFilter: next })
  }

  return (
    <Ctx.Provider value={{ settings, updateSettings, toggleLevel }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
