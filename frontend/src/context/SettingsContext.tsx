import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** 紙 (light), 夜 (dark), 藍 and 苔 (optional light themes); 'system' = 紙 by day, 夜 by night */
export type Theme = 'system' | 'kami' | 'yoru' | 'ai' | 'koke'
export type MarkLevel = 'N1' | 'N2' | 'N3' | 'N4' | 'all'
export type JpSize = 'sm' | 'md' | 'lg'
/** How a blanked-out review card is answered: in your head, by typing, or out loud */
export type ClozeAnswer = 'self' | 'type' | 'speak'

export interface Settings {
  theme: Theme
  /** Size of the Japanese text: passages, sentences, cards */
  jpSize: JpSize
  /** Reader: mark words at this level and harder as gaps ('all' = every level) */
  markLevel: MarkLevel
  hideFurigana: boolean
  /** Reader: show each sentence's translation under it */
  showTranslations: boolean
  clozeAnswer: ClozeAnswer
  /** 背诵: start with the kana hint on */
  reciteKana: boolean
  // Kept for older screens still reading them
  levelFilter: string[]
  hideJa: boolean
  hideZh: boolean
}

interface SettingsCtx {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

const DEFAULTS: Settings = {
  theme: 'system', jpSize: 'md', markLevel: 'N3', hideFurigana: true, showTranslations: false,
  clozeAnswer: 'self', reciteKana: false, levelFilter: [], hideJa: false, hideZh: false,
}

/** Settings saved by earlier versions, read into today's shape. */
function migrate(stored: Record<string, unknown>): Settings {
  const theme = stored.theme === 'light' ? 'kami' : stored.theme === 'dark' ? 'yoru' : stored.theme
  return {
    ...DEFAULTS, ...stored,
    theme: (['system', 'kami', 'yoru', 'ai', 'koke'] as const).includes(theme as Theme) ? (theme as Theme) : 'system',
    levelFilter: Array.isArray(stored.levelFilter) ? stored.levelFilter as string[] : [],
  } as Settings
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      return migrate(JSON.parse(localStorage.getItem('jlpt-settings') ?? '{}'))
    } catch {
      return DEFAULTS
    }
  })

  // The theme as a `dark` class (夜) or a data-theme (藍 / 苔) on <html>, and
  // the Japanese text size as data-jp. index.html does the same before first
  // paint to avoid a flash of the wrong theme.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const root = document.documentElement
      const dark = settings.theme === 'yoru' || (settings.theme === 'system' && mq.matches)
      root.classList.toggle('dark', dark)
      if (settings.theme === 'ai' || settings.theme === 'koke') root.dataset.theme = settings.theme
      else delete root.dataset.theme
      root.dataset.jp = settings.jpSize
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme, settings.jpSize])

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem('jlpt-settings', JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }

  return (
    <Ctx.Provider value={{ settings, updateSettings }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
