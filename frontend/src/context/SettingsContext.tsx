import { createContext, useContext, useState, type ReactNode } from 'react'

export interface Settings {
  levelFilter: string[]   // selected JLPT levels; empty = show all
  model: string
}

interface SettingsCtx {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  toggleLevel: (level: string) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

const DEFAULTS: Settings = { levelFilter: [], model: 'gemini-2.5-flash' }

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
