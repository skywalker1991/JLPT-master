import { Monitor, Sun, Moon } from 'lucide-react'
import { useSettings, type Theme } from '../../context/SettingsContext'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const META: Record<Theme, { icon: typeof Sun; label: string }> = {
  system: { icon: Monitor, label: '跟随系统' },
  light:  { icon: Sun,     label: '浅色' },
  dark:   { icon: Moon,    label: '深色' },
}

/** Cycles 跟随系统 → 浅色 → 深色. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { settings, updateSettings } = useSettings()
  const { icon: Icon, label } = META[settings.theme]
  return (
    <button
      type="button"
      onClick={() => updateSettings({ theme: NEXT[settings.theme] })}
      className={`btn-ghost p-2 rounded-lg ${className}`}
      title={`外观：${label}（点击切换）`}
      aria-label={`外观：${label}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
