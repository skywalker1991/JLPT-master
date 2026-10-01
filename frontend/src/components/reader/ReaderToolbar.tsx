import { useSettings, type MarkLevel } from '../../context/SettingsContext'

const LEVELS: { value: MarkLevel; label: string }[] = [
  { value: 'N1', label: 'N1' },
  { value: 'N2', label: 'N2 以上' },
  { value: 'N3', label: 'N3 以上' },
  { value: 'N4', label: 'N4 以上' },
  { value: 'all', label: '全部' },
]

/** The reader's controls: which level counts as a gap, the legend, furigana, translations. */
export default function ReaderToolbar() {
  const { settings, updateSettings } = useSettings()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl md:bg-accent-light md:px-3 md:py-2 text-sm">
      <label className="relative inline-flex items-center gap-2 h-9 pl-3 pr-8 rounded-lg border border-border bg-surface text-fg">
        <span aria-hidden="true" className="w-4 h-[3px] rounded-full bg-fg" />
        <span className="hidden md:inline text-fg-muted">生词</span>
        <span className="sr-only">把这个等级以上的词标成生词</span>
        <select
          value={settings.markLevel}
          onChange={e => updateSettings({ markLevel: e.target.value as MarkLevel })}
          className="absolute inset-0 opacity-0 cursor-pointer"
        >
          {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <span>{LEVELS.find(l => l.value === settings.markLevel)?.label}</span>
        <span aria-hidden="true" className="absolute right-3 text-[0.6rem] text-fg-subtle">▼</span>
      </label>
      <span className="flex items-center gap-1.5 text-fg-muted text-xs md:text-sm">
        <span aria-hidden="true" className="w-4 border-t border-fg-subtle" />已在库
      </span>
      <span className="flex items-center gap-1.5 text-fg-muted text-xs md:text-sm">
        <span aria-hidden="true" className="w-4 border-t border-dashed border-fg-muted" />语法
      </span>
      <label className="ml-auto flex items-center gap-1.5 text-fg-muted cursor-pointer">
        <input type="checkbox" checked={!settings.hideFurigana} className="accent-fg w-4 h-4"
               onChange={e => updateSettings({ hideFurigana: !e.target.checked })} />振假名
      </label>
      <label className="hidden md:flex items-center gap-1.5 text-fg-muted cursor-pointer">
        <input type="checkbox" checked={settings.showTranslations} className="accent-fg w-4 h-4"
               onChange={e => updateSettings({ showTranslations: e.target.checked })} />逐句译文
      </label>
    </div>
  )
}
