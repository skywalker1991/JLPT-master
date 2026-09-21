import { Monitor, Sun, Moon } from 'lucide-react'
import { useSettings, type Theme } from '../../context/SettingsContext'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const META: Record<Theme, { icon: typeof Sun; label: string }> = {
  system: { icon: Monitor, label: '跟随系统' },
  light:  { icon: Sun,     label: '浅色' },
  dark:   { icon: Moon,    label: '深色' },
}

/**
 * Cycles 跟随系统 → 浅色 → 深色.
 * `variant="tab"` matches the phone tab bar (icon above its current label).
 */
export default function ThemeToggle({ className = '', variant = 'icon' }: {
  className?: string
  variant?: 'icon' | 'tab'
}) {
  const { settings, updateSettings } = useSettings()
  const { icon: Icon, label } = META[settings.theme]
  const cycle = () => updateSettings({ theme: NEXT[settings.theme] })

  if (variant === 'tab') {
    return (
      <button
        type="button"
        onClick={cycle}
        className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium text-fg-subtle ${className}`}
        title={`外观：${label}（点击切换）`}
        aria-label={`外观：${label}，点击切换`}
      >
        <Icon className="w-5 h-5" />
        {label}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className={`btn-ghost p-2 rounded-lg ${className}`}
      title={`外观：${label}（点击切换）`}
      aria-label={`外观：${label}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
